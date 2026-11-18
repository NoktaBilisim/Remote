// support_requests / tenant_request_settings erişimi (db-notlari P8b-1 "Backend-dev için"). Panel sorguları her zaman
// tenant kapsamlı (AC-69, AC-148). Durum geçişleri tek koşullu UPDATE (count=1 kazanır, mimari-e9 §3.4); her geçiş aynı
// UPDATE'te CHECK'lerin istediği alanları yazar (closed_at, cancel_reason, rejected_*).
import { compareQueue } from "@remote/contracts/api/requests";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;
// PT-K9: panel liste/atama sorguları `repo-panel.ts`, süpürücü/anonimleştirme sorguları `repo-sweep.ts`'de; adlar buradan
// yeniden dışa verilir (çağıranlar ve testlerin `vi.mock("…/requests/repo.ts")` yolu değişmez).
export * from "./repo-panel.ts";
export * from "./repo-sweep.ts";

const DAY_MS = 86_400_000;
const KNOWN_WINDOW_DAYS = 90;

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
  defaultPriority: true, // P18 (AC-257)
  defaultSlaMinutes: true,
  webFormEnabled: true, // P19 (AC-259)
  notifySmsEnabled: true,
  notifyWhatsappEnabled: true,
  notifyEmailEnabled: true,
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
type CustomerRefRow = Prisma.CustomerGetPayload<{ select: typeof customerRefSelect }>;

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
export async function pendingSnapshot(
  tx: DbOrTx,
  tenantId: string,
  k: { clientInstance: string; ipKey: string; netKey: string; customerId?: string | null },
) {
  const rows = await tx.supportRequest.findMany({
    where: { tenantId, status: "PENDING" },
    select: {
      clientInstance: true,
      ipKey: true,
      netKey: true,
      requestCode: true,
      priority: true,
      source: true,
      customerPhone: true,
      customerEmail: true,
      customerId: true,
    },
  });
  const web = rows.filter((r) => r.source === "WEB");
  return {
    instance: rows.filter((r) => r.clientInstance === k.clientInstance).length,
    ip: rows.filter((r) => r.ipKey === k.ipKey).length,
    net: rows.filter((r) => r.netKey === k.netKey).length,
    tenant: rows.length,
    codes: new Set(rows.map((r) => r.requestCode)),
    /** P18 (AC-257): bekleyenlerin öncelikleri — yeni talebin sırası `compareQueue` ile (aynı/yüksek öncelik önde). */
    priorities: rows.map((r) => r.priority),
    /** P19 (S-P19-15): WEB bekleyen sayısı (alt tavan 30). */
    web: web.length,
    /** P19 (S-P19-12): bekleyen WEB taleplerinin alıcıları (≤ 30; bildirim bastırma karşılaştırması). */
    webContacts: web.map((r) => ({ phone: r.customerPhone, email: r.customerEmail })),
    /** P21 (r2 S-P21-4): müşterinin bekleyen talepleri (kaynak fark etmez; yalnız portal yolunda sınır). */
    customer: k.customerId ? rows.filter((r) => r.customerId === k.customerId).length : 0,
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
  source: true, // P19 (S-P19-3, 13): tür ↔ kaynak ve sürüm kapısı
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

/**
 * Kuyruk (sıra hesabı, AC-139; P18 AC-257): bekleyenler `compareQueue` sırasıyla (öncelik → created_at → id). Prisma
 * `orderBy` CASE ifade edemez; kuyruk ≤ 50 olduğundan sıralama uygulamada (mimari-e11 §8b.3), sorgu ≤ 200 satır.
 */
export async function pendingQueue(db: DbOrTx, tenantId: string) {
  const rows = await db.supportRequest.findMany({
    where: { tenantId, status: "PENDING" },
    select: { id: true, requestCode: true, createdAt: true, expiresAt: true, priority: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
  });
  return rows.sort(compareQueue);
}

export function countPending(db: DbOrTx, tenantId: string): Promise<number> {
  return db.supportRequest.count({ where: { tenantId, status: "PENDING" } });
}

// ---------------- P18 öncelik / SLA (mimari-e11 §8b.2) ----------------

/** Oluşturma TX'inde (ayar kilidi altında) öncelik/SLA varsayılanları: müşteri ?? firma. */
export async function requestPolicy(tx: DbOrTx, tenantId: string, customerId: string | null) {
  const [s, c] = await Promise.all([
    tx.tenantRequestSettings.findUnique({ where: { tenantId }, select: { defaultPriority: true, defaultSlaMinutes: true } }),
    customerId
      ? tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { defaultPriority: true, slaMinutes: true } })
      : Promise.resolve(null),
  ]);
  return { priority: c?.defaultPriority ?? s?.defaultPriority ?? "NORMAL", slaMinutes: c?.slaMinutes ?? s?.defaultSlaMinutes ?? null };
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
