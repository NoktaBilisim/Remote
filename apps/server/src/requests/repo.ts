// support_requests / tenant_request_settings erişimi (db-notlari P8b-1 "Backend-dev için"). Panel sorguları her zaman
// tenant kapsamlı (AC-69, AC-148). Durum geçişleri tek koşullu UPDATE (count=1 kazanır, mimari-e9 §3.4); her geçiş aynı
// UPDATE'te CHECK'lerin istediği alanları yazar (closed_at, cancel_reason, rejected_*).
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;
const DAY_MS = 86_400_000;
export const KNOWN_WINDOW_DAYS = 90;

// ---------------- Ayarlar ----------------

const settingsSelect = {
  tenantId: true,
  requestRef: true,
  refRotatedAt: true,
  fileLabel: true,
  waitMinutes: true,
  waEnabled: true,
  waRecipients: true,
  emailEnabled: true,
  emailRecipients: true,
  trustedCidrs: true,
  requireAcceptCode: true, // P15 (AC-239)
  tenant: { select: { id: true, name: true, status: true, deletedAt: true, logoPath: true } },
} as const;
export type SettingsRow = Prisma.TenantRequestSettingsGetPayload<{ select: typeof settingsSelect }>;

export function settingsByTenant(db: DbOrTx, tenantId: string): Promise<SettingsRow | null> {
  return db.tenantRequestSettings.findUnique({ where: { tenantId }, select: settingsSelect });
}

export function settingsByRef(db: DbOrTx, requestRef: string): Promise<SettingsRow | null> {
  return db.tenantRequestSettings.findUnique({ where: { requestRef }, select: settingsSelect });
}

/**
 * P8c müşteri ref'i çözümlemesi (mimari-e10 §3.6, §5.2): Genel sorgu (`settingsByRef`) ile **paralel** çalışır; tenant ve
 * ayar aynı sorguda gelir (ek gidiş-dönüş yok → Genel/müşteri ayrımı süreden sızmaz).
 */
const customerRefSelect = {
  id: true,
  tenantId: true,
  name: true,
  status: true,
  fileLabel: true,
  requestRef: true,
  tenant: { select: { requestSettings: { select: settingsSelect } } },
} as const;
export type CustomerRefRow = Prisma.CustomerGetPayload<{ select: typeof customerRefSelect }>;

export function customerByRef(db: DbOrTx, requestRef: string): Promise<CustomerRefRow | null> {
  return db.customer.findUnique({ where: { requestRef }, select: customerRefSelect });
}

/** P8c tek ref ad alanı (ADR-0006 r5): append-only; PK çakışması (P2002 `PRIMARY`) → çağıran yeni ref ile yeniden dener. */
export async function insertRequestRef(
  db: DbOrTx,
  data: { ref: string; tenantId: string; customerId: string | null; createdAt: Date },
): Promise<void> {
  await db.requestRef.create({ data, select: { ref: true } });
}

export async function insertSettings(db: DbOrTx, tenantId: string, requestRef: string, fileLabel: string): Promise<void> {
  await db.tenantRequestSettings.create({
    data: { tenantId, requestRef, fileLabel, waRecipients: [], emailRecipients: [], trustedCidrs: [] },
    select: { tenantId: true },
  });
}

export async function updateSettings(db: DbOrTx, tenantId: string, data: Prisma.TenantRequestSettingsUpdateInput): Promise<void> {
  await db.tenantRequestSettings.update({ where: { tenantId }, data, select: { tenantId: true } });
}

/** Oluşturma TX'inin ilk ifadesi (G-E9-10): tenant satırı kilidi → bekleyen sayımları yarışla aşılamaz. */
export async function lockSettings(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT tenant_id FROM tenant_request_settings WHERE tenant_id = ${tenantId} FOR UPDATE`;
}

/** S14-4: kilit altında tenant durumu (FOR SHARE) — pasife alma commit'iyle yarışta pasif tenant'a PENDING yazılmaz. */
export async function shareTenantActive(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { status: string; deleted_at: Date | null }[]
  >`SELECT status, deleted_at FROM tenants WHERE id = ${tenantId} FOR SHARE`;
  const t = rows[0];
  return t !== undefined && t.status === "ACTIVE" && t.deleted_at === null;
}

export const jsonStrings = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ---------------- Oluşturma ----------------

/**
 * Kilitli TX içinde tenant'ın bekleyen taleplerinin tek sorguluk anlık görüntüsü (≤ 50 satır, `(tenant_id, status, …)`
 * indeksi): örnek/IP/önek/tenant sayıları + kullanılan kodlar. QA-P8b-1: ayar kilidi altında 5 ayrı sorgu (4 sayım +
 * kodlar) yerine 1 gidiş-dönüş — seri kuyrukta TX süresini ve havuz beklemesini kısaltır.
 */
export async function pendingSnapshot(tx: DbOrTx, tenantId: string, k: { clientInstance: string; ipKey: string; netKey: string }) {
  const rows = await tx.supportRequest.findMany({
    where: { tenantId, status: "PENDING" },
    select: { clientInstance: true, ipKey: true, netKey: true, requestCode: true },
  });
  return {
    instance: rows.filter((r) => r.clientInstance === k.clientInstance).length,
    ip: rows.filter((r) => r.ipKey === k.ipKey).length,
    net: rows.filter((r) => r.netKey === k.netKey).length,
    tenant: rows.length,
    codes: new Set(rows.map((r) => r.requestCode)),
  };
}

export async function insertRequest(tx: DbOrTx, data: Prisma.SupportRequestUncheckedCreateInput): Promise<void> {
  await tx.supportRequest.create({ data, select: { id: true } });
}

/** Bilinen ağ (G-E9-15): tam ipKey → IP, yoksa ağ öneki → PREFIX; son 90 günde admit edilmiş oturum. */
export async function networkSeen(
  db: DbOrTx,
  tenantId: string,
  ipKey: string,
  netKey: string,
  now: Date,
): Promise<"IP" | "PREFIX" | "NONE"> {
  const since = new Date(now.getTime() - KNOWN_WINDOW_DAYS * DAY_MS);
  if (await db.supportSession.findFirst({ where: { tenantId, guestIpKey: ipKey, consumedAt: { gte: since } }, select: { id: true } }))
    return "IP";
  if (await db.supportSession.findFirst({ where: { tenantId, guestNetKey: netKey, consumedAt: { gte: since } }, select: { id: true } }))
    return "PREFIX";
  return "NONE";
}

/** known_device (G-E9-17): aynı device_hash'li talep son 90 günde oturuma bağlanmış. */
export async function deviceSeen(db: DbOrTx, tenantId: string, deviceHash: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - KNOWN_WINDOW_DAYS * DAY_MS);
  const r = await db.supportRequest.findFirst({
    where: { tenantId, deviceHash, session: { is: { consumedAt: { gte: since } } } },
    select: { id: true },
  });
  return r !== null;
}

// ---------------- Okuma ----------------

const secretSelect = {
  id: true,
  tenantId: true,
  status: true,
  requestCode: true,
  clientVersion: true,
  createdAt: true,
  expiresAt: true,
  acceptedBy: true,
  customerName: true,
  customerEmail: true,
  customerId: true,
  bindingId: true,
  consentTextId: true,
  consentSha256: true,
  consentText: { select: { version: true } },
  session: { select: { id: true, status: true, expiresAt: true, techVerifyCode: true, technician: { select: { fullName: true } } } },
} as const;
export type SecretRow = Prisma.SupportRequestGetPayload<{ select: typeof secretSelect }>;

export function findBySecretHash(db: DbOrTx, secretHash: string): Promise<SecretRow | null> {
  return db.supportRequest.findUnique({ where: { secretHash }, select: secretSelect });
}

export function findById(db: DbOrTx, id: string): Promise<SecretRow | null> {
  return db.supportRequest.findUnique({ where: { id }, select: secretSelect });
}

/** Kuyruk (sıra hesabı, AC-139): bekleyenler created_at, id artan (≤ 50). */
export function pendingQueue(db: DbOrTx, tenantId: string) {
  return db.supportRequest.findMany({
    where: { tenantId, status: "PENDING" },
    select: { id: true, requestCode: true, createdAt: true, expiresAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
}

export function countPending(db: DbOrTx, tenantId: string): Promise<number> {
  return db.supportRequest.count({ where: { tenantId, status: "PENDING" } });
}

const itemSelect = {
  id: true,
  requestCode: true,
  networkMatch: true,
  knownDevice: true,
  status: true,
  cancelReason: true,
  createdAt: true,
  closedAt: true,
  acceptedAt: true,
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  description: true,
  clientVersion: true,
  rejectMessage: true,
  acceptor: { select: { id: true, fullName: true } },
  session: { select: { id: true } },
  // P8c (AC-176, §15.1): müşteri firma + kayıt durumu (tek ek IN sorgusu; N+1 yok)
  bindingId: true,
  binding: { select: { revokedAt: true } },
  customer: { select: { id: true, name: true, status: true, refRotatedAt: true } },
} as const;
export type ItemRow = Prisma.SupportRequestGetPayload<{ select: typeof itemSelect }>;

/** P8c müşteri filtresi: `general` → customer_id IS NULL; ULID → o müşteri (tenant ile birlikte → IX(tenant_id, customer_id, …)). */
const customerWhere = (customer: string | undefined): Prisma.SupportRequestWhereInput =>
  customer === undefined ? {} : { customerId: customer === "general" ? null : customer };

export async function listPending(db: DbOrTx, tenantId: string, customer?: string): Promise<{ rows: ItemRow[]; total: number }> {
  const where: Prisma.SupportRequestWhereInput = { tenantId, status: "PENDING", ...customerWhere(customer) };
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({ where, select: itemSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200 }),
    db.supportRequest.count({ where }),
  ]);
  return { rows, total };
}

export async function listHistory(
  db: DbOrTx,
  tenantId: string,
  since: Date,
  status: string | undefined,
  page: { skip: number; take: number },
  customer?: string,
) {
  const where: Prisma.SupportRequestWhereInput = {
    tenantId,
    closedAt: { gte: since },
    ...(status ? { status } : {}),
    ...customerWhere(customer),
  };
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({ where, select: itemSelect, orderBy: [{ closedAt: "desc" }, { id: "desc" }], ...page }),
    db.supportRequest.count({ where }),
  ]);
  return { rows, total };
}

/** P8c müşteri detayı "Talepler" sekmesi (AC-178): tüm durumlar, yeniden eskiye; IX(tenant_id, customer_id, created_at). */
export async function listByCustomer(db: DbOrTx, tenantId: string, customerId: string, page: { skip: number; take: number }) {
  const where: Prisma.SupportRequestWhereInput = { tenantId, customerId };
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({ where, select: itemSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...page }),
    db.supportRequest.count({ where }),
  ]);
  return { rows, total };
}

export function findItem(db: DbOrTx, tenantId: string, id: string): Promise<ItemRow | null> {
  return db.supportRequest.findFirst({ where: { id, tenantId }, select: itemSelect });
}

export function findStatusInTenant(db: DbOrTx, tenantId: string, id: string) {
  return db.supportRequest.findFirst({
    where: { id, tenantId },
    select: { status: true, acceptedBy: true, customerId: true, clientVersion: true },
  });
}

// ---------------- Geçişler (§3.4) ----------------

export async function acceptPending(tx: DbOrTx, tenantId: string, id: string, userId: string, now: Date): Promise<number> {
  const r = await tx.supportRequest.updateMany({
    where: { id, tenantId, status: "PENDING", expiresAt: { gt: now } },
    data: { status: "ACCEPTED", acceptedBy: userId, acceptedAt: now, closedAt: now },
  });
  return r.count;
}

export async function rejectPending(tx: DbOrTx, tenantId: string, id: string, userId: string, message: string, now: Date): Promise<number> {
  const r = await tx.supportRequest.updateMany({
    where: { id, tenantId, status: "PENDING", expiresAt: { gt: now } },
    data: { status: "REJECTED", rejectedBy: userId, rejectMessage: message, closedAt: now },
  });
  return r.count;
}

export type SystemCancelReason = "DISCONNECTED" | "TENANT_PASSIVE" | "CUSTOMER_PASSIVE" | "BINDING_REVOKED";

export async function cancelPending(tx: DbOrTx, id: string, reason: "CUSTOMER" | SystemCancelReason, now: Date): Promise<number> {
  const r = await tx.supportRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "CANCELLED", cancelReason: reason, closedAt: now },
  });
  return r.count;
}

export async function cancelAccepted(tx: DbOrTx, id: string): Promise<number> {
  const r = await tx.supportRequest.updateMany({
    where: { id, status: "ACCEPTED" },
    data: { status: "CANCELLED", cancelReason: "CUSTOMER" },
  });
  return r.count;
}

export async function connectFailed(tx: DbOrTx, id: string): Promise<number> {
  const r = await tx.supportRequest.updateMany({ where: { id, status: "ACCEPTED" }, data: { status: "CONNECT_FAILED" } });
  return r.count;
}

export async function expireOne(tx: DbOrTx, id: string, now: Date): Promise<number> {
  const r = await tx.supportRequest.updateMany({
    where: { id, status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED", closedAt: now },
  });
  return r.count;
}

// --- talep oturumu (support_sessions.request_id) ---

/** Oturum PENDING → CANCELLED (müşteri vazgeçti / bağlanamadı / yetki); talep oturumunda kod yoktur (CHECK). */
export async function cancelRequestSession(
  tx: DbOrTx,
  requestId: string,
  now: Date,
  endedBy: "CUSTOMER" | "SYSTEM",
  endReason: string,
): Promise<number> {
  const r = await tx.supportSession.updateMany({
    where: { requestId, status: "PENDING", consumedAt: null },
    data: { status: "CANCELLED", endedAt: now, endedBy, endReason },
  });
  return r.count;
}

// ---------------- Süpürücü ----------------

export function findExpired(db: DbOrTx, now: Date, take: number) {
  return db.supportRequest.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, tenantId: true },
    orderBy: { expiresAt: "asc" },
    take,
  });
}

/** Kabul edilmiş ama bağlanmamış: oturum PENDING ve süresi dolmuş ya da tüketilmeden kapanmış (teknisyen iptali vb.). */
export function findConnectDue(db: DbOrTx, now: Date, take: number) {
  return db.supportRequest.findMany({
    where: {
      status: "ACCEPTED",
      session: {
        is: { consumedAt: null, OR: [{ status: "PENDING", expiresAt: { lte: now } }, { status: { in: ["CANCELLED", "EXPIRED"] } }] },
      },
    },
    select: { id: true, tenantId: true },
    take,
  });
}

/** Pasif/silinmiş tenant'ın bekleyenleri (AC-145). */
export function findPassivePending(db: DbOrTx, take: number) {
  return db.supportRequest.findMany({
    where: { status: "PENDING", tenant: { is: { OR: [{ status: { not: "ACTIVE" } }, { deletedAt: { not: null } }] } } },
    select: { id: true, tenantId: true },
    take,
  });
}

/** P8c (AC-171): pasif müşterinin bekleyenleri (süpürücü yedek yolu; servis yolu deactivate sonrası). */
export function findCustomerPassivePending(db: DbOrTx, take: number) {
  return db.supportRequest.findMany({
    where: { status: "PENDING", customer: { is: { status: "PASSIVE" } } },
    select: { id: true, tenantId: true },
    take,
  });
}

export function findPendingOfCustomer(db: DbOrTx, tenantId: string, customerId: string) {
  return db.supportRequest.findMany({ where: { tenantId, customerId, status: "PENDING" }, select: { id: true, tenantId: true } });
}

export function findAllPending(db: DbOrTx, take: number) {
  return db.supportRequest.findMany({ where: { status: "PENDING" }, select: { id: true, tenantId: true }, take });
}

export function countAllPending(db: DbOrTx): Promise<number> {
  return db.supportRequest.count({ where: { status: "PENDING" } });
}

// ---------------- Anonimleştirme (AC-159) ----------------

export async function anonymizeBatch(db: DbOrTx, tenantId: string, cutoff: Date, now: Date, limit: number): Promise<number> {
  const r = await db.supportRequest.updateMany({
    where: { tenantId, anonymizedAt: null, createdAt: { lt: cutoff } },
    data: {
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      description: null,
      ip: null,
      ipKey: null,
      netKey: null,
      deviceHash: null,
      anonymizedAt: now,
    },
    limit,
  });
  return r.count;
}

export function retentionTenants(db: DbOrTx) {
  return db.tenantSettings.findMany({ select: { tenantId: true, retentionDays: true } });
}
