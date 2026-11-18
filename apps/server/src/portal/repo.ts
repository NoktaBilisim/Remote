// P21 müşteri portalı veri erişimi (mimari-p21 §3, §5.3; db-notlari "P21" sorgu desenleri).
// İki tür sorgu: (1) kimlik — portal_users / portal_sessions (tenant kapsamı girişte firma kısa adından, oturumda satırdan);
// (2) kapsamlı veri — HER fonksiyon ilk parametre olarak `PortalScope` alır ve `where`'i `{ tenantId, customerId, … }` ile
// kurar (IDOR kuralı §5.3). Seçim listeleri dar ve sabit (K-P21-7): açıklama, not, sohbet, IP, cihaz, dosya yok.
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

/** Oturumdan türetilen tek kapsam (§5.3): istekte `tenantId`/`customerId` alanı yoktur. */
export interface PortalScope {
  tenantId: string;
  customerId: string;
  portalUserId: string;
}

// ------------------------------------------------------------------ kimlik

const tenantSelect = { id: true, name: true, slug: true, status: true, deletedAt: true, logoPath: true } as const;
const customerSelect = { id: true, name: true, status: true, anonymizedAt: true, fileLabel: true, requestRef: true } as const;

export const portalUserSelect = {
  id: true,
  tenantId: true,
  customerId: true,
  email: true,
  fullName: true,
  passwordHash: true,
  mustChangePassword: true,
  failedLoginCount: true,
  failedWindowAt: true,
  lockedUntil: true,
  totpEnabled: true,
  theme: true,
  status: true,
  tempPasswordExpiresAt: true,
  tenant: { select: tenantSelect },
  customer: { select: customerSelect },
} as const;
export type PortalUserRow = Prisma.PortalUserGetPayload<{ select: typeof portalUserSelect }>;

/** r2 S-P21-3: giriş adresi firmaya bağlı — kısa ad → firma (durum çağıranda değerlendirilir). */
export function findTenantBySlug(db: DbOrTx, slug: string): Promise<{ id: string; status: string; deletedAt: Date | null } | null> {
  return db.tenant.findUnique({ where: { slug }, select: { id: true, status: true, deletedAt: true } });
}

/** Giriş araması `UQ(tenant_id, email)`. */
export function findPortalUser(db: DbOrTx, tenantId: string, email: string): Promise<PortalUserRow | null> {
  return db.portalUser.findUnique({ where: { tenantId_email: { tenantId, email } }, select: portalUserSelect });
}

export function findPortalUserById(db: DbOrTx, id: string): Promise<PortalUserRow | null> {
  return db.portalUser.findUnique({ where: { id }, select: portalUserSelect });
}

/**
 * Hesap geneli hatalı deneme sayacı — TX DIŞINDA, atomik (panel `bumpAccountFailures` kalıbı, S1-2/S2-3). Dönen `true` kilidi
 * BU isteğin başlattığını gösterir (kilit audit'i bir kez).
 */
export async function bumpPortalFailures(db: DbOrTx, id: string, limit: number, lockMinutes: number): Promise<boolean> {
  await db.$executeRaw`
    UPDATE portal_users SET
      failed_login_count = IF(failed_window_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, failed_login_count + 1, 1),
      failed_window_at = IF(failed_window_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, failed_window_at, UTC_TIMESTAMP(3)),
      updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id}`;
  const locked = await db.$executeRaw`
    UPDATE portal_users SET locked_until = UTC_TIMESTAMP(3) + INTERVAL ${lockMinutes} MINUTE, failed_window_at = NULL,
      updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND failed_window_at IS NOT NULL AND failed_login_count >= ${limit}`;
  return locked > 0;
}

/** Giriş TX'inin ilk ifadesi (D-P27a-K3 kalıbı): kararı veren alanlar kilitli güncel satırdan. */
export async function lockPortalUser(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ passwordHash: string; status: string; totpEnabled: boolean } | null> {
  const rows = await tx.$queryRaw<{ password_hash: string; status: string; totp_enabled: unknown }[]>`
    SELECT password_hash, status, totp_enabled FROM portal_users WHERE id = ${id} FOR UPDATE`;
  const r = rows[0];
  return r ? { passwordHash: r.password_hash, status: r.status, totpEnabled: Number(r.totp_enabled) === 1 } : null;
}

const sessionInclude = { portalUser: { select: portalUserSelect } } as const;
export type PortalSessionRow = Prisma.PortalSessionGetPayload<{ include: typeof sessionInclude }>;

/** Oturum çözümü: istek başına tek sorgu (oturum + hesap + müşteri + firma). Yalnız `portal_sessions` aranır (K-P21-1). */
export function findPortalSessionByHash(db: DbOrTx, tokenHash: string): Promise<PortalSessionRow | null> {
  return db.portalSession.findUnique({ where: { tokenHash }, include: sessionInclude });
}

export async function touchPortalSession(db: DbOrTx, id: string, at: Date): Promise<void> {
  await db.portalSession.updateMany({ where: { id, revokedAt: null }, data: { lastSeenAt: at } });
}

export async function revokePortalSession(db: DbOrTx, id: string, at: Date): Promise<void> {
  await db.portalSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
}

export async function revokePortalSessionByHash(db: DbOrTx, tokenHash: string, at: Date): Promise<void> {
  await db.portalSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: at } });
}

/** Hesabın tüm açık oturumları (mevcut dahil) — `IX(portal_user_id, tenant_id, revoked_at)`. */
export async function revokePortalUserSessions(db: DbOrTx, tenantId: string, portalUserId: string, at: Date): Promise<number> {
  const r = await db.portalSession.updateMany({ where: { portalUserId, tenantId, revokedAt: null }, data: { revokedAt: at } });
  return r.count;
}

/**
 * Hesabın mevcut oturum DIŞINDAKİ açık oturumları (S-P21-K-1, TOTP etkinleştirme). Panel `auth/account.ts` kalıbı: kilitsiz okuma +
 * PK ile güncelleme yalnız kayıt kilidi alır (aralık UPDATE'inin boşluk kilidi eşzamanlı giriş INSERT'üyle kilitlenmesin).
 */
export async function revokeOtherPortalSessions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  portalUserId: string,
  keepSessionId: string,
  at: Date,
): Promise<number> {
  const others = await tx.portalSession.findMany({
    where: { portalUserId, tenantId, revokedAt: null, id: { not: keepSessionId } },
    select: { id: true },
  });
  if (others.length === 0) return 0;
  const r = await tx.portalSession.updateMany({ where: { id: { in: others.map((o) => o.id) }, revokedAt: null }, data: { revokedAt: at } });
  return r.count;
}

// ------------------------------------------------------------------ kapsamlı veri (K-P21-7 dar seçimler)

export const requestItemSelect = {
  id: true,
  requestCode: true,
  status: true,
  source: true,
  priority: true,
  customerName: true,
  anonymizedAt: true,
  createdAt: true,
  closedAt: true,
  session: { select: { id: true } },
} as const;
export type PortalRequestRow = Prisma.SupportRequestGetPayload<{ select: typeof requestItemSelect }>;

export const sessionItemSelect = {
  id: true,
  status: true,
  mode: true,
  customerName: true,
  ticketNo: true,
  anonymizedAt: true,
  createdAt: true,
  consumedAt: true,
  endedAt: true,
  technician: { select: { fullName: true } },
} as const;
export type PortalSessionItemRow = Prisma.SupportSessionGetPayload<{ select: typeof sessionItemSelect }>;

const scopeWhere = (s: PortalScope) => ({ tenantId: s.tenantId, customerId: s.customerId });
const newestFirst = [{ createdAt: "desc" as const }, { id: "desc" as const }];

export async function listRequests(db: Db, s: PortalScope, page: number, pageSize: number) {
  const where = scopeWhere(s);
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({ where, select: requestItemSelect, orderBy: newestFirst, skip: (page - 1) * pageSize, take: pageSize }),
    db.supportRequest.count({ where }),
  ]);
  return { rows, total };
}

/** Tekil kayıt: `(id, tenantId, customerId)`; başka müşterinin/firmanın kaydı ile olmayan kayıt aynı `null` (§5.3). */
export function findRequest(db: Db, s: PortalScope, id: string): Promise<PortalRequestRow | null> {
  return db.supportRequest.findFirst({ where: { id, ...scopeWhere(s) }, select: requestItemSelect });
}

export async function listSessions(db: Db, s: PortalScope, page: number, pageSize: number) {
  const where = scopeWhere(s);
  const [rows, total] = await Promise.all([
    db.supportSession.findMany({ where, select: sessionItemSelect, orderBy: newestFirst, skip: (page - 1) * pageSize, take: pageSize }),
    db.supportSession.count({ where }),
  ]);
  return { rows, total };
}

export function findSession(db: Db, s: PortalScope, id: string): Promise<PortalSessionItemRow | null> {
  return db.supportSession.findFirst({ where: { id, ...scopeWhere(s) }, select: sessionItemSelect });
}

// ------------------------------------------------------------------ panel (Admin) — hesap `(tenantId, customerId, id)` üçlüsüyle

export const accountSelect = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  totpEnabled: true,
  mustChangePassword: true,
  tempPasswordExpiresAt: true,
  lastLoginAt: true,
  createdAt: true,
  passiveAt: true,
} as const;
export type PortalAccountRow = Prisma.PortalUserGetPayload<{ select: typeof accountSelect }>;

export function listAccounts(db: DbOrTx, tenantId: string, customerId: string, take: number): Promise<PortalAccountRow[]> {
  return db.portalUser.findMany({
    where: { tenantId, customerId },
    select: accountSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
}

export function findAccount(db: DbOrTx, tenantId: string, customerId: string, id: string): Promise<PortalAccountRow | null> {
  return db.portalUser.findFirst({ where: { id, tenantId, customerId }, select: accountSelect });
}

export function countAccounts(db: DbOrTx, tenantId: string, customerId: string): Promise<number> {
  return db.portalUser.count({ where: { tenantId, customerId } });
}
