// auth veri erişimi. Kullanıcı/oturum tablolarının tenant'tan bağımsız (kimlik) sorguları burada;
// tenant verisi sorguları her pakette `tenantScope` parametresiyle yazılır (mimari §5.1).
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

const tenantRef = { select: { id: true, name: true, slug: true, status: true, deletedAt: true } } as const;

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
  status: true,
  deletedAt: true,
  tenant: tenantRef,
} as const;

export type LoginUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** '@' içeren girdi yalnız e-posta, içermeyen yalnız kullanıcı adı ile aranır (belirsizlik yok, S1-8). */
export function findUserByLogin(db: DbOrTx, login: string): Promise<LoginUser | null> {
  const where = login.includes("@") ? { email: login.toLowerCase() } : { username: login };
  return db.user.findUnique({ where, select: userSelect });
}

/**
 * Hesap geneli hatalı deneme sayacını tek UPDATE ile atomik artırır (S1-2, S2-3). MySQL atamaları soldan
 * sağa ve güncellenmiş değerle değerlendirir: sayaç artar → eşikte kilit yazılır → eşikte pencere NULL'lanır
 * (sonraki hata sayacı 1'den başlatır). Dönen değer: bu artışla kilit başladı mı (aynı TX'te tek okuma).
 */
export async function bumpAccountFailures(tx: Prisma.TransactionClient, userId: string, limit: number, lockMinutes: number): Promise<boolean> {
  await tx.$executeRaw`
    UPDATE users SET
      failed_login_count = IF(failed_window_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, failed_login_count + 1, 1),
      locked_until = IF(failed_login_count >= ${limit}, UTC_TIMESTAMP(3) + INTERVAL ${lockMinutes} MINUTE, locked_until),
      failed_window_at = IF(failed_login_count >= ${limit}, NULL,
        IF(failed_window_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, failed_window_at, UTC_TIMESTAMP(3)))
    WHERE id = ${userId}`;
  const rows = await tx.$queryRaw<{ c: number }[]>`SELECT failed_login_count AS c FROM users WHERE id = ${userId}`;
  return Number(rows[0]?.c ?? 0) >= limit;
}

export function findUserById(db: DbOrTx, id: string): Promise<LoginUser | null> {
  return db.user.findUnique({ where: { id }, select: userSelect });
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

export type SessionWithUser = Prisma.AuthSessionGetPayload<{ include: typeof sessionInclude }>;

export function findSessionByHash(db: DbOrTx, tokenHash: string): Promise<SessionWithUser | null> {
  return db.authSession.findUnique({ where: { tokenHash }, include: sessionInclude });
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
