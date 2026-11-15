// Firma (tenant) yönetimi ve tenant ayarları veri erişimi (P9). `/admin/*` sistem uçlarıdır (Super Admin); tenant
// ayarları her zaman `tenantId` kapsamıyla okunur/yazılır.
import type { ListTenantsQuery } from "@remote/contracts/api/tenants";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  passiveAt: true, // P16 (AC-242)
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: { where: { status: "ACTIVE", deletedAt: null } } } },
} as const;

export type TenantRow = Prisma.TenantGetPayload<{ select: typeof tenantSelect }>;

const live: Prisma.TenantWhereInput = { deletedAt: null };

export async function listTenants(db: DbOrTx, q: ListTenantsQuery): Promise<{ rows: TenantRow[]; total: number }> {
  const where: Prisma.TenantWhereInput = {
    ...live,
    ...(q.status === "all" ? {} : { status: q.status === "active" ? "ACTIVE" : "PASSIVE" }),
    ...(q.q ? { OR: [{ name: { contains: q.q } }, { slug: { contains: q.q.toLowerCase() } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.tenant.findMany({
      where,
      select: tenantSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.tenant.count({ where }),
  ]);
  return { rows, total };
}

export function findTenant(db: DbOrTx, id: string): Promise<TenantRow | null> {
  return db.tenant.findFirst({ where: { ...live, id }, select: tenantSelect });
}

export async function lockTenant(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ id: string; name: string; slug: string; status: string } | null> {
  const rows = await tx.$queryRaw<{ id: string; name: string; slug: string; status: string }[]>`
    SELECT id, name, slug, status FROM tenants WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function insertTenant(tx: Prisma.TransactionClient, data: { id: string; name: string; slug: string }): Promise<void> {
  await tx.tenant.create({ data: { ...data, status: "ACTIVE", settings: { create: {} } }, select: { id: true } });
}

export async function updateTenant(tx: Prisma.TransactionClient, id: string, data: Prisma.TenantUpdateInput): Promise<void> {
  await tx.tenant.update({ where: { id }, data, select: { id: true } });
}

/** Tenant kullanıcılarının tüm açık oturumları (AC-70). Super Admin'in geçiş oturumu çözümlemede zaten düşer. */
export async function revokeTenantSessions(tx: Prisma.TransactionClient, tenantId: string, at: Date): Promise<number> {
  const r = await tx.authSession.updateMany({ where: { revokedAt: null, user: { is: { tenantId } } }, data: { revokedAt: at } });
  return r.count;
}

/** Bekleyen KOD oturumları → CANCELLED(tenant_passive). Talep oturumları talep/admit yoluyla kapanır. */
export async function cancelTenantPending(tx: Prisma.TransactionClient, tenantId: string, at: Date): Promise<number> {
  const r = await tx.supportSession.updateMany({
    where: { tenantId, status: "PENDING", requestId: null },
    data: { status: "CANCELLED", activeCode: null, endedAt: at, endedBy: "SYSTEM", endReason: "tenant_passive" },
  });
  return r.count;
}

/**
 * P14a (AC-205): bekleyen talepler → CANCELLED(TENANT_PASSIVE), pasife alma TX'inin İÇİNDE (kilitli tenant satırından
 * sonra). Dönen kimlikler commit sonrası müşteri/panel bildirimleri ve satır başı audit için.
 */
export async function cancelTenantRequests(tx: Prisma.TransactionClient, tenantId: string, at: Date): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM support_requests WHERE tenant_id = ${tenantId} AND status = 'PENDING' FOR UPDATE`;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  await tx.supportRequest.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "CANCELLED", cancelReason: "TENANT_PASSIVE", closedAt: at },
  });
  return ids;
}

/** P14b (AC-226): firma seçici — önek eşleşmesi önce, aktif önce, ada göre; harf duyarsızlığı unicode_ci harmanlamasından. */
export function tenantOptions(db: DbOrTx, q: string | undefined, limit: number) {
  const like = q === undefined ? null : q.replace(/[\\%_]/g, "\\$&");
  if (like === null)
    return db.$queryRaw<{ id: string; name: string; slug: string; status: string }[]>`
      SELECT id, name, slug, status FROM tenants WHERE deleted_at IS NULL
      ORDER BY (status = 'ACTIVE') DESC, name, id LIMIT ${limit}`;
  return db.$queryRaw<{ id: string; name: string; slug: string; status: string }[]>`
    SELECT id, name, slug, status FROM tenants
    WHERE deleted_at IS NULL AND name LIKE CONCAT('%', ${like}, '%')
    ORDER BY (name LIKE CONCAT(${like}, '%')) DESC, (status = 'ACTIVE') DESC, name, id LIMIT ${limit}`;
}

export async function setActingTenant(db: DbOrTx, sessionId: string, tenantId: string | null): Promise<void> {
  await db.authSession.update({ where: { id: sessionId }, data: { actingTenantId: tenantId }, select: { id: true } });
}

// --- tenant ayarları (AC-4) ---

const settingsSelect = {
  tenant: { select: { logoPath: true } }, // P12 (AC-81)
  sessionTtlMin: true,
  maxOpenSessions: true,
  maxActiveHours: true,
  maxFileMb: true,
  retentionDays: true,
  requireTech2fa: true,
  mfaRememberDevice: true, // P27a (AC-331)
  smtpHost: true,
  smtpPort: true,
  smtpSecurity: true,
  smtpUser: true,
  smtpPassEnc: true,
  smtpFromName: true,
  smtpFromEmail: true,
} as const;
export type SettingsRow = Prisma.TenantSettingsGetPayload<{ select: typeof settingsSelect }>;

/** Satır yoksa varsayılanlarla oluşturur (eski kurulum güvenliği; firma oluşturma zaten ekler). */
export function ensureSettings(db: DbOrTx, tenantId: string): Promise<SettingsRow> {
  return db.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {}, select: settingsSelect });
}

export async function lockSettings(tx: Prisma.TransactionClient, tenantId: string): Promise<SettingsRow> {
  await ensureSettings(tx, tenantId);
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT tenant_id AS id FROM tenant_settings WHERE tenant_id = ${tenantId} FOR UPDATE`;
  if (rows.length === 0) throw new Error("tenant_settings kilitlenemedi");
  return tx.tenantSettings.findUniqueOrThrow({ where: { tenantId }, select: settingsSelect });
}

export async function updateSettings(
  tx: Prisma.TransactionClient,
  tenantId: string,
  data: Prisma.TenantSettingsUpdateInput,
): Promise<SettingsRow> {
  return tx.tenantSettings.update({ where: { tenantId }, data, select: settingsSelect });
}
