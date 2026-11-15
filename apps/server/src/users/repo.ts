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

export async function insertUser(tx: Prisma.TransactionClient, data: Prisma.UserUncheckedCreateInput): Promise<void> {
  await tx.user.create({ data, select: { id: true } });
}

export async function updateUser(tx: Prisma.TransactionClient, id: string, data: Prisma.UserUncheckedUpdateInput): Promise<void> {
  await tx.user.update({ where: { id }, data, select: { id: true } });
}

/** Ezme satırlarını verilen kümeyle değiştirir (tanım dışı eski anahtarlar da temizlenir). */
export async function replacePermissions(
  tx: Prisma.TransactionClient,
  userId: string,
  rows: readonly { permKey: string; granted: boolean }[],
): Promise<void> {
  await tx.userPermission.deleteMany({ where: { userId } });
  if (rows.length > 0) await tx.userPermission.createMany({ data: rows.map((r) => ({ userId, permKey: r.permKey, granted: r.granted })) });
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
