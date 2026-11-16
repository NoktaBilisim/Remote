// auth veri erişimi. Kullanıcı/oturum tablolarının tenant'tan bağımsız (kimlik) sorguları burada;
// tenant verisi sorguları her pakette `tenantScope` parametresiyle yazılır (mimari §5.1).
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

const tenantRef = { select: { id: true, name: true, slug: true, status: true, deletedAt: true, logoPath: true } } as const;

const userSelect = {
  id: true,
  tenantId: true,
  email: true,
  username: true,
  fullName: true,
  role: true,
  passwordHash: true,
  mustChangePassword: true,
  failedLoginCount: true,
  failedWindowAt: true,
  lockedUntil: true,
  theme: true,
  avatarPath: true,
  status: true,
  deletedAt: true,
  totpEnabled: true,
  tenant: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      deletedAt: true,
      logoPath: true,
      settings: { select: { requireTech2fa: true, mfaRememberDevice: true } },
    },
  },
} as const;

export type LoginUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/**
 * '@' içeren girdi yalnız e-posta, içermeyen yalnız kullanıcı adı ile aranır (belirsizlik yok, S1-8).
 * P16 (S16-7, ADR-0030 m.4): mezar taşı (`DELETED`) hiç bulunmaz → "olmayan hesap" yolu (bellek kovası); kilitli satıra
 * sayaç UPDATE'i gitmez, `@invalid`'e posta denenmez. Giriş ve parola sıfırlama isteği bu fonksiyonu kullanır.
 */
export function findUserByLogin(db: DbOrTx, login: string): Promise<LoginUser | null> {
  const where = login.includes("@") ? { email: login.toLowerCase() } : { username: login };
  return db.user.findFirst({ where: { ...where, status: { not: "DELETED" } }, select: userSelect });
}

/**
 * Hesap geneli hatalı deneme sayacı — TX DIŞINDA (S8b-6: başka yazmaların TX'i düşse de sayaç artar).
 * 1) Artış tek atomik UPDATE (pencere 1 sa; dolmuşsa 1'den başlar). 2) Kilit ayrı koşullu UPDATE: eşik aşılmışsa ve
 * pencere açıksa `locked_until` yazılır, pencere NULL'lanır (sonraki hata 1'den başlar). Eşzamanlı isteklerden yalnız
 * biri 2. ifadede satır değiştirir → dönen `true` kilidi BU isteğin başlattığını gösterir (kilit audit'i bir kez, S2-3).
 */
export async function bumpAccountFailures(db: DbOrTx, userId: string, limit: number, lockMinutes: number): Promise<boolean> {
  await db.$executeRaw`
    UPDATE users SET
      failed_login_count = IF(failed_window_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, failed_login_count + 1, 1),
      failed_window_at = IF(failed_window_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, failed_window_at, UTC_TIMESTAMP(3))
    WHERE id = ${userId}`;
  const locked = await db.$executeRaw`
    UPDATE users SET locked_until = UTC_TIMESTAMP(3) + INTERVAL ${lockMinutes} MINUTE, failed_window_at = NULL
    WHERE id = ${userId} AND failed_window_at IS NOT NULL AND failed_login_count >= ${limit}`;
  return locked > 0;
}

export function findUserById(db: DbOrTx, id: string): Promise<LoginUser | null> {
  return db.user.findUnique({ where: { id }, select: userSelect });
}

/** D-P27a-K3: login TX'inde kararı veren alanlar (kilitli current read). */
export interface LockedLoginRow {
  passwordHash: string;
  totpEnabled: boolean;
  status: string;
  deletedAt: Date | null;
}

/**
 * D-P27a-K3: login TX'inin İLK ifadesi. `FOR UPDATE` (FOR SHARE değil): aynı TX `clearFailures` ile satırı yazabilir;
 * S→X yükseltmesi eşzamanlı iki girişte kilitlenme (1213) üretirdi. Kilit sırası users → trusted_devices → auth_sessions;
 * `enableTx`, şifre değişimi/sıfırlama, Admin 2FA sıfırlama ve `createTrustedDevice` de önce kullanıcı satırını X kilitler
 * → iki yön serileşir (biri commit etmeden diğeri karar vermez).
 */
export async function lockUserForLogin(tx: Prisma.TransactionClient, userId: string): Promise<LockedLoginRow | null> {
  const rows = await tx.$queryRaw<{ password_hash: string; totp_enabled: unknown; status: string; deleted_at: Date | null }[]>`
    SELECT password_hash, totp_enabled, status, deleted_at FROM users WHERE id = ${userId} FOR UPDATE`;
  const r = rows[0];
  if (!r) return null;
  return { passwordHash: r.password_hash, totpEnabled: Number(r.totp_enabled) === 1, status: r.status, deletedAt: r.deleted_at };
}

export async function clearFailures(db: DbOrTx, userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, failedWindowAt: null, lockedUntil: null } });
}

export async function updatePassword(db: DbOrTx, userId: string, passwordHash: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
}

export async function createSession(db: DbOrTx, data: Prisma.AuthSessionUncheckedCreateInput): Promise<void> {
  await db.authSession.create({ data });
}

const sessionInclude = {
  user: { select: { ...userSelect, permissions: { select: { permKey: true, granted: true } } } },
  actingTenant: tenantRef,
} as const;

type SessionWithUser = Prisma.AuthSessionGetPayload<{ include: typeof sessionInclude }>;

export function findSessionByHash(db: DbOrTx, tokenHash: string): Promise<SessionWithUser | null> {
  return db.authSession.findUnique({ where: { tokenHash }, include: sessionInclude });
}

export function findSessionById(db: DbOrTx, id: string): Promise<SessionWithUser | null> {
  return db.authSession.findUnique({ where: { id }, include: sessionInclude });
}

export async function touchSession(db: DbOrTx, id: string, at: Date): Promise<void> {
  await db.authSession.update({ where: { id }, data: { lastSeenAt: at } });
}

export async function revokeSession(db: DbOrTx, id: string, at: Date): Promise<void> {
  await db.authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
}

/** Aynı tarayıcıdan gelen eski oturum çerezi (yeni girişte, S1-10). */
export async function revokeSessionByHash(db: DbOrTx, tokenHash: string, at: Date): Promise<void> {
  await db.authSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: at } });
}

/** Kullanıcının tüm açık oturumları — mevcut dahil (şifre değişimi, S1-3/S2-2). */
export async function revokeUserSessions(db: DbOrTx, userId: string, at: Date): Promise<number> {
  const r = await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
  return r.count;
}
