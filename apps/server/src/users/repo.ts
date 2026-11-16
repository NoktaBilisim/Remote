// Kullanıcı yönetimi veri erişimi (P9). Her fonksiyon tenant kapsamını zorunlu parametre alır (mimari §5.1, AC-69);
// SUPER_ADMIN hesapları (tenant_id NULL) hiçbir kapsamda görünmez.
import type { ListUsersQuery } from "@remote/contracts/api/users";
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

export interface TenantScope {
  tenantId: string;
}

const userSelect = {
  id: true,
  tenantId: true,
  email: true,
  username: true,
  fullName: true,
  role: true,
  status: true,
  mustChangePassword: true,
  totpEnabled: true,
  avatarPath: true,
  createdAt: true,
  version: true,
  permissions: { select: { permKey: true, granted: true } },
  authSessions: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
} as const;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const scoped = (scope: TenantScope): Prisma.UserWhereInput => ({
  tenantId: scope.tenantId,
  deletedAt: null,
  role: { in: ["ADMIN", "USER"] },
});

function listWhere(scope: TenantScope, q: ListUsersQuery): Prisma.UserWhereInput {
  return {
    ...scoped(scope),
    ...(q.role === "all" ? {} : { role: q.role }),
    ...(q.status === "all" ? {} : { status: q.status === "active" ? "ACTIVE" : "PASSIVE" }),
    ...(q.q ? { OR: [{ fullName: { contains: q.q } }, { email: { contains: q.q.toLowerCase() } }] } : {}),
  };
}

export async function listUsers(db: DbOrTx, scope: TenantScope, q: ListUsersQuery): Promise<{ rows: UserRow[]; total: number }> {
  const where = listWhere(scope, q);
  const orderBy: Prisma.UserOrderByWithRelationInput[] =
    q.sort === "createdAt:desc" ? [{ createdAt: "desc" }, { id: "desc" }] : [{ fullName: "asc" }, { id: "asc" }];
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, select: userSelect, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.user.count({ where }),
  ]);
  return { rows, total };
}

export function findUser(db: DbOrTx, scope: TenantScope, id: string): Promise<UserRow | null> {
  return db.user.findFirst({ where: { ...scoped(scope), id }, select: userSelect });
}

/**
 * P14a (AC-202, ADR-0023): aktör ve hedef satırları TX başında id sırasıyla `FOR UPDATE` (kilitlenme önlemi — iki
 * yönetici birbirini düzenlese de kilit sırası aynı). Kapsam burada süzülmez: hedef kapsamı `findUser` ile (404) bakılır.
 */
export async function lockUsers(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
}

/** İşlemi yapanın TX içindeki güncel rol/durum/yetki satırları (oturumdaki kopya bayat olabilir — AC-202). */
export function readActor(tx: Prisma.TransactionClient, id: string) {
  return tx.user.findUnique({
    where: { id },
    select: { role: true, status: true, deletedAt: true, tenantId: true, permissions: { select: { permKey: true, granted: true } } },
  });
}

/** Koşullu sürüm artışı (ADR-0023): satır beklenen sürümde değilse 0 → çağıran 409 `STALE_WRITE`. */
export async function bumpVersion(tx: Prisma.TransactionClient, id: string, expected: number): Promise<number> {
  const r = await tx.user.updateMany({ where: { id, version: expected }, data: { version: { increment: 1 } } });
  return r.count;
}

/** P14b (AC-225): filtre seçeneği — kapsamdaki ADMIN/USER (pasifler dahil), ad sırası, üst sınır. `onlyId`: USER kendisi. */
export function listUserOptions(db: DbOrTx, scope: TenantScope, take: number, onlyId?: string) {
  return db.user.findMany({
    where: { ...scoped(scope), ...(onlyId ? { id: onlyId } : {}) },
    select: { id: true, fullName: true, status: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take,
  });
}

/**
 * P18 (AC-256): atanabilir aday listesi — kapsam + ACTIVE; etkin yetki (view + accept) çağıranda süzülür (ezme satırları
 * ile birlikte tek sorgu, ≤ take).
 */
export function listAssignableCandidates(db: DbOrTx, scope: TenantScope, take: number, onlyId?: string) {
  return db.user.findMany({
    where: { ...scoped(scope), status: "ACTIVE", ...(onlyId ? { id: onlyId } : {}) },
    select: { id: true, fullName: true, status: true, role: true, permissions: { select: { permKey: true, granted: true } } },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take,
  });
}

export async function insertUser(tx: Prisma.TransactionClient, data: Prisma.UserUncheckedCreateInput): Promise<void> {
  await tx.user.create({ data, select: { id: true } });
}

export async function updateUser(tx: Prisma.TransactionClient, id: string, data: Prisma.UserUncheckedUpdateInput): Promise<void> {
  await tx.user.update({ where: { id }, data, select: { id: true } });
}

/**
 * Ezme satırlarını verilen kümeyle değiştirir (tanım dışı eski anahtarlar da temizlenir). P16 düzeltme 2 (QA AC-206 503):
 * `DELETE … WHERE user_id = ?` + `INSERT` REPEATABLE READ'de aralık (next-key/gap) kilidi alır; ULID'ler monoton olduğundan
 * en yeni kullanıcıların aralığı dizin sonundaki aynı boşluğu paylaşır → iki eşzamanlı TX (farklı firma bile) 1213
 * deadlock → 503. Bu yüzden yalnız fark yazılır: var olan satırlar tam birincil anahtarla silinir/güncellenir (kayıt
 * kilidi), yeniler eklenir. Okuma kilitsiz: çağıran `users` satırını TX başında `FOR UPDATE` tutar (lockUsers / yeni
 * satır), bu kullanıcının ezmelerine eşzamanlı yazan yoktur.
 */
export async function replacePermissions(
  tx: Prisma.TransactionClient,
  userId: string,
  rows: readonly { permKey: string; granted: boolean }[],
): Promise<void> {
  const have = new Map(
    (await tx.userPermission.findMany({ where: { userId }, select: { permKey: true, granted: true } })).map((r) => [r.permKey, r.granted]),
  );
  const want = new Map(rows.map((r) => [r.permKey, r.granted]));
  const removed = [...have.keys()].filter((k) => !want.has(k));
  const flipped = rows.filter((r) => have.has(r.permKey) && have.get(r.permKey) !== r.granted);
  const added = rows.filter((r) => !have.has(r.permKey));
  if (removed.length > 0) await tx.userPermission.deleteMany({ where: { userId, permKey: { in: removed } } });
  for (const granted of [true, false]) {
    const keys = flipped.filter((r) => r.granted === granted).map((r) => r.permKey);
    if (keys.length > 0) await tx.userPermission.updateMany({ where: { userId, permKey: { in: keys } }, data: { granted } });
  }
  if (added.length > 0)
    await tx.userPermission.createMany({ data: added.map((r) => ({ userId, permKey: r.permKey, granted: r.granted })) });
}

export async function revokeUserSessions(tx: Prisma.TransactionClient, userId: string, at: Date): Promise<number> {
  const r = await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
  return r.count;
}

/**
 * Pasife alınan teknisyenin bekleyen KOD oturumları → CANCELLED(auth_revoked). Talep oturumları (request_id dolu)
 * hariç: onları admit kontrolü (teknisyen pasif → CANCELLED + CONNECT_FAILED) ve talep süpürücüsü kapatır.
 */
export async function cancelPendingOfTechnician(
  tx: Prisma.TransactionClient,
  scope: TenantScope,
  technicianId: string,
  at: Date,
): Promise<number> {
  const r = await tx.supportSession.updateMany({
    where: { tenantId: scope.tenantId, technicianId, status: "PENDING", requestId: null },
    data: { status: "CANCELLED", activeCode: null, endedAt: at, endedBy: "SYSTEM", endReason: "auth_revoked" },
  });
  return r.count;
}

/** P16: teknisyenin açık (PENDING/ACTIVE) destek oturumu sayısı (kalıcı silmede 409). */
export function countOpenSessions(tx: Prisma.TransactionClient, scope: TenantScope, technicianId: string): Promise<number> {
  return tx.supportSession.count({ where: { tenantId: scope.tenantId, technicianId, status: { in: ["PENDING", "ACTIVE"] } } });
}

/**
 * P16 (ADR-0030 m.4; db-notlari "P16"): mezar taşı TEK UPDATE — koşul `id`, `version`, `status = 'PASSIVE'` (ACTIVE→DELETED'i
 * DB engellemez; uygulama WHERE'de zorlar). Sonrasında satır tetikleyiciyle kilitlidir. 0 → çağıran 409.
 */
export async function tombstone(tx: Prisma.TransactionClient, id: string, version: number, label: string, at: Date): Promise<number> {
  const r = await tx.user.updateMany({
    where: { id, version, status: "PASSIVE", deletedAt: null },
    data: {
      status: "DELETED",
      deletedAt: at,
      email: `deleted+${id}@invalid`,
      username: null,
      fullName: label,
      passwordHash: "!deleted",
      avatarPath: null,
      totpSecretEnc: null,
      totpEnabled: false,
      totpLastStep: null,
      failedLoginCount: 0,
      failedWindowAt: null,
      lockedUntil: null,
      version: { increment: 1 },
    },
  });
  return r.count;
}

/** Mezar taşı alt tabloları (ADR-0030 m.4): yetki ezmeleri, kurtarma kodları, sıfırlama bağlantıları, giriş oturumları. */
export async function deleteUserChildren(tx: Prisma.TransactionClient, userId: string) {
  const permissions = await tx.userPermission.deleteMany({ where: { userId } });
  const recoveryCodes = await tx.recoveryCode.deleteMany({ where: { userId } });
  const resetTokens = await tx.passwordResetToken.deleteMany({ where: { userId } });
  const authSessions = await tx.authSession.deleteMany({ where: { userId } });
  const deviceGrants = await tx.unattendedDeviceGrant.deleteMany({ where: { userId } }); // P27 (mimari-p27 §3.6)
  // P28u (mimari-p28u §3.1/§3.3): izinsiz politika aydınlatma izinin "kim" alanı NULL; an (ack_at) ve politika kalır.
  await tx.tenantSettings.updateMany({ where: { unattendedSilentAckBy: userId }, data: { unattendedSilentAckBy: null } });
  return {
    deletedPermissions: permissions.count,
    // Anahtar adları mask.ts kara listesine (`code|token`) takılmasın diye nötr (yalnız sayı).
    deletedMfaBackups: recoveryCodes.count,
    deletedResetLinks: resetTokens.count,
    deletedAuthSessions: authSessions.count,
    deletedDeviceGrants: deviceGrants.count,
  };
}

/** P16 (AC-241): `GET /users/options?includeDeleted=1` — kapsamdaki mezar taşları (ad = etiket). */
export function listDeletedOptions(db: DbOrTx, scope: TenantScope, take: number) {
  return db.user.findMany({
    where: { tenantId: scope.tenantId, status: "DELETED", role: { in: ["ADMIN", "USER"] } },
    select: { id: true, fullName: true, status: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    take,
  });
}
