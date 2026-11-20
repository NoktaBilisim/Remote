// Talep oluşturma TX'i (PT-K9: service.ts `createCore` içinden mekanik çıkarım; davranış aynı). Kilit/sorgu sırası (G-E9-10,
// S14-4, B-P8c-1, S-P19-T12): ayar FOR UPDATE (ilk ifade) → tenant FOR SHARE → müşteri FOR SHARE → kayıt koşullu UPDATE →
// bekleyen anlık görüntüsü → politika → INSERT → audit. Tüm adımlar aynı TX nesnesini (`tx`) alır; kendi `db`'leri yoktur.
import type { NotifyChoice } from "@remote/contracts/api/requests";
import {
  compareQueue,
  notifyEmailKey,
  REQUEST_BUSY_MESSAGE,
  REQUEST_QUEUE_KNOWN_ONLY_FROM,
  REQUEST_QUEUE_MAX,
} from "@remote/contracts/api/requests";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { bindingInvalid } from "../bindings/service.ts";
import * as brepo from "../bindings/repo.ts";
import * as crepo from "../customers/repo.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { REQUEST_TX_OPTIONS } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newRequestCode, sha256Hex } from "../lib/ids.ts";
import { addBusinessMinutes } from "./calendar.ts";
import type { openState, TenantCalendar } from "./hours.ts";
import { PORTAL_PENDING_PER_CUSTOMER_MAX } from "@remote/contracts/api/portal";
import { WEB_PENDING_MAX } from "./limits.ts";
import * as repo from "./repo.ts";
import { CUSTOMER, type CreateCoreInput, type RequestService } from "./service.ts";

const PENDING_CODE_INDEX = "support_requests_pending_code_uq";
const CODE_ATTEMPTS = 5;
const PENDING_PER_IP = 3;
const PENDING_PER_NET = 10;

interface PrismaLikeError {
  code?: unknown;
  meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } };
}
const isUniqueConflict = (err: unknown, index: string): boolean => {
  const e = err as PrismaLikeError | null;
  return typeof e === "object" && e !== null && e.code === "P2002" && e.meta?.driverAdapterError?.cause?.constraint?.index === index;
};

/**
 * P21 (K-P21-2, r2 S-P21-1/S-P21-4): portal talebi seçeneği. `web_form_enabled` denetimi atlanır; çözülen firma/müşteri
 * beklenenle eşit olmazsa talep yazılmaz (fail-closed 500); TX'te müşterinin bekleyen talepleri sınırlanır; audit'e eklenir.
 */
export interface PortalCreateOptions {
  via: "portal";
  portalUserId: string;
  expectedTenantId: string;
  expectedCustomerId: string;
}

/** TX öncesi adımların (create-steps.ts) ürettiği, TX'e ve commit sonrasına giden değerler. */
export interface CreatePlan {
  ctx: AuditContext;
  web: boolean;
  ip: string;
  net: string;
  trusted: boolean;
  privileged: boolean;
  s: repo.SettingsRow;
  tenantId: string;
  customerId: string | null;
  binding: { id: string; keyHash: string } | null;
  via: "binding" | "ref";
  input: CreateCoreInput;
  deviceHash: string | null;
  consent: { id: string; sha256: string };
  tc: TenantCalendar;
  hours: ReturnType<typeof openState>;
  networkMatch: "TRUSTED" | "IP" | "PREFIX" | "NONE";
  knownDevice: boolean;
  now: Date;
  secret: string;
  id: string;
  expiresAt: Date;
  /** P21: portal yolu (yoksa null — AGENT/WEB davranışı değişmez). */
  portal: PortalCreateOptions | null;
}

export interface Created {
  code: string;
  position: number;
  priority: string;
  slaDueAt: Date | null;
  afterHours: boolean;
  suppressed: boolean;
}

/** Hangi bekleyen sınırı aştı (audit kovası/anahtar türü ayrımı): IP başına 3 ya da önek (net_key) başına 10. */
type PendingHit = { bucket: string; keyType: "ip" | "prefix" | "tenant" | "customer"; key: string };
type Snapshot = Awaited<ReturnType<typeof repo.pendingSnapshot>>;

/** Kod çakışmasında (UQ bekleyen kod) en çok 5 deneme; bekleyen sınırı reddinde `request.rate_limited` audit'i. */
export async function insertWithRetry(svc: RequestService, p: CreatePlan): Promise<Created> {
  let created: Created | undefined;
  const hit: { pending?: PendingHit } = {};
  for (let attempt = 1; !created; attempt++) {
    try {
      created = await svc.d.db.$transaction((tx) => createTx(svc, tx, p, hit), REQUEST_TX_OPTIONS);
    } catch (err) {
      if (attempt < CODE_ATTEMPTS && isUniqueConflict(err, PENDING_CODE_INDEX)) continue;
      if (err instanceof AppError && hit.pending)
        await svc.rateAudit(p.ctx, p.tenantId, hit.pending.bucket, hit.pending.keyType, hit.pending.key);
      throw err;
    }
  }
  return created;
}

async function createTx(svc: RequestService, tx: Prisma.TransactionClient, p: CreatePlan, hit: { pending?: PendingHit }) {
  await lockAndRecheck(svc, tx, p);
  const c = await repo.pendingSnapshot(tx, p.tenantId, {
    clientInstance: p.input.clientInstanceId,
    ipKey: p.ip,
    netKey: p.net,
    customerId: p.portal ? p.customerId : null,
  });
  checkPending(p, c, hit);
  const { notify, suppressed } = notifyFlags(p.input, c);
  // P18 (AC-257, §8b.2): öncelik/SLA müşteri ?? firma varsayılanı (kilitli ayar satırıyla); değerler dondurulur.
  const policy = await repo.requestPolicy(tx, p.tenantId, p.customerId);
  const afterHours = !p.hours.openNow;
  const slaDueAt = slaDue(svc, p.tenantId, p.tc, p.now.getTime(), p.hours.next, afterHours, policy.slaMinutes);
  const taken = c.codes;
  let code = newRequestCode();
  while (taken.has(code)) code = newRequestCode();
  await repo.insertRequest(
    tx,
    requestRow(p, { code, notify, priority: policy.priority, slaMinutes: policy.slaMinutes, slaDueAt, afterHours }),
  );
  // S8b-3: IP yalnız audit `ip_address` sütununda. P8c §5.7: via + customerId (ref/anahtar değeri asla).
  await writeAudit(tx, p.ctx, {
    tenantId: p.tenantId,
    ...CUSTOMER,
    action: "request.created",
    entity: "support_requests",
    entityId: p.id,
    result: "success",
    newValue: {
      clientVersion: p.input.clientVersion,
      // P31 (K-P31-4): beyan varsa (Windows/eski istemci gövdesi alansız → audit satırı bugünkü gibi).
      ...(p.input.source === "AGENT" && p.input.clientOs ? { clientOs: p.input.clientOs } : {}),
      via: p.portal ? p.portal.via : p.via,
      ...(p.portal ? { portalUserId: p.portal.portalUserId } : {}),
      customerId: p.customerId,
      source: p.input.source,
      notify,
      ...(suppressed ? { notifySuppressed: true } : {}),
    },
  });
  // Sıra (AC-257): aynı ya da yüksek öncelikli bekleyenler önde (hepsi daha önce oluşturuldu).
  const me = { priority: policy.priority, createdAt: p.now, id: p.id };
  const ahead = c.priorities.filter((pr) => compareQueue({ priority: pr, createdAt: new Date(0), id: "" }, me) < 0).length;
  return { code, position: ahead + 1, priority: policy.priority, slaDueAt, afterHours, suppressed };
}

async function lockAndRecheck(svc: RequestService, tx: Prisma.TransactionClient, p: CreatePlan): Promise<void> {
  await repo.lockSettings(tx, p.tenantId); // ilk ifade (G-E9-10)
  // S14-4: ön bakış ile kilit arasında pasife alma commit olduysa talep yazılmaz (tek 404). Sıra settings → tenants;
  // pasife alma tenants'ı tutar, settings'i istemez → kilit döngüsü yok.
  if (!(await repo.shareTenantActive(tx, p.tenantId))) throw p.binding ? bindingInvalid(svc, p.ip) : svc.refInvalid(p.ip);
  // B-P8c-1: müşteri TX içinde FOR SHARE ile yeniden doğrulanır; peek ile INSERT arasında pasife alma commit
  // olduysa talep yazılmaz (tek 404). Pasife alma bu TX'i beklerse bekleyeni kendi TX'inde iptal eder.
  if (p.customerId && (await crepo.shareStatus(tx, p.tenantId, p.customerId)) !== "ACTIVE")
    throw p.binding ? bindingInvalid(svc, p.ip) : svc.refInvalid(p.ip);
  if (p.binding) {
    // §3.4 Kullanım: koşullu UPDATE (count 0 → BINDING_INVALID, ROLLBACK); kayıt başına 1 bekleyen.
    if ((await brepo.touchForRequest(tx, p.binding.id, p.binding.keyHash, p.now)) === 0) throw new AppError("BINDING_INVALID");
    if ((await brepo.countPendingOfBinding(tx, p.tenantId, p.binding.id)) >= 1) throw new AppError("REQUEST_PENDING");
  }
}

/** Bekleyen sınırları (kilit altında): örnek 1, IP 3, önek 10, tenant 50 / bilinmeyen 40, WEB 30. */
function checkPending(p: CreatePlan, c: Snapshot, hit: { pending?: PendingHit }): void {
  if (c.instance >= 1) throw new AppError("REQUEST_PENDING");
  // P21 (r2 S-P21-4): portal yolunda müşteri başına en çok 3 bekleyen (kaynak fark etmez) → 429 QUEUE_FULL (errors.ts durumu).
  if (p.portal && c.customer >= PORTAL_PENDING_PER_CUSTOMER_MAX) {
    hit.pending = { bucket: "pending.portal_customer", keyType: "customer", key: p.portal.expectedCustomerId };
    throw new AppError("QUEUE_FULL", { message: REQUEST_BUSY_MESSAGE });
  }
  if (!p.trusted && c.ip >= PENDING_PER_IP) {
    hit.pending = { bucket: "pending.ip", keyType: "ip", key: p.ip };
    throw new AppError("RATE_LIMITED", { message: REQUEST_BUSY_MESSAGE, retryAfterSec: 60 });
  }
  if (!p.trusted && c.net >= PENDING_PER_NET) {
    hit.pending = { bucket: "pending.prefix", keyType: "prefix", key: p.net };
    throw new AppError("RATE_LIMITED", { message: REQUEST_BUSY_MESSAGE, retryAfterSec: 60 });
  }
  if (c.tenant >= REQUEST_QUEUE_MAX || (c.tenant >= REQUEST_QUEUE_KNOWN_ONLY_FROM && !p.privileged)) {
    hit.pending = { bucket: "pending.tenant", keyType: "tenant", key: p.tenantId };
    throw new AppError("QUEUE_FULL");
  }
  // P19 (S-P19-15): WEB bekleyen alt tavanı 30 (toplam 50 aynı) → form spam'i AGENT'a en az 20 yer bırakır.
  if (p.web && c.web >= WEB_PENDING_MAX) {
    hit.pending = { bucket: "pending.tenant_web", keyType: "tenant", key: p.tenantId };
    throw new AppError("QUEUE_FULL");
  }
}

/**
 * P19 (S-P19-12, T10/T11): aynı tenant'ta aynı numara/e-postayla bekleyen WEB talebi varsa yeni talep açılır ama o kanalın
 * bildirim bayrağı 0 yazılır; yanıt bunu belirtmez (başka kişinin talebi hakkında oracle yok).
 */
function notifyFlags(input: CreateCoreInput, c: Snapshot): { notify: NotifyChoice; suppressed: boolean } {
  const emailKey = input.email ? notifyEmailKey(input.email) : null;
  const phoneDup = c.webContacts.some((w) => w.phone === input.phone);
  const emailDup = emailKey !== null && c.webContacts.some((w) => w.email !== null && notifyEmailKey(w.email) === emailKey);
  const notify = {
    sms: input.notify.sms && !phoneDup,
    whatsapp: input.notify.whatsapp && !phoneDup,
    email: input.notify.email && !emailDup,
  };
  const suppressed = notify.sms !== input.notify.sms || notify.whatsapp !== input.notify.whatsapp || notify.email !== input.notify.email;
  return { notify, suppressed };
}

/**
 * SLA hedefi (§8b.2): dakika yoksa NULL; mesai dışında (ACCEPT) sayaç sonraki açılıştan başlar, takvimde açık an yoksa NULL;
 * takvim bozuksa (T12) NULL. Hesap hatası (RangeError) → NULL + geri düşüş metriği.
 */
function slaDue(
  svc: RequestService,
  tenantId: string,
  tc: TenantCalendar,
  now: number,
  next: number | null,
  afterHours: boolean,
  minutes: number | null,
) {
  if (minutes === null || tc.broken) return null;
  const start = afterHours ? next : now;
  if (start === null) return null;
  try {
    const due = addBusinessMinutes(tc.cal, Math.max(now, start), minutes);
    return due === null ? null : new Date(due);
  } catch {
    svc.calendars.fallback(tenantId, "range_error");
    return null;
  }
}

type RowExtra = {
  code: string;
  notify: NotifyChoice;
  priority: string;
  slaMinutes: number | null;
  slaDueAt: Date | null;
  afterHours: boolean;
};

function requestRow(p: CreatePlan, x: RowExtra): Prisma.SupportRequestUncheckedCreateInput {
  const { input, now } = p;
  return {
    id: p.id,
    tenantId: p.tenantId,
    status: "PENDING",
    requestCode: x.code,
    secretHash: sha256Hex(p.secret),
    clientInstance: input.clientInstanceId,
    clientVersion: input.clientVersion,
    // P31 (AC-511): yalnız AGENT beyanı; WEB her zaman NULL (CHECK source_client_os_chk). Yoksa NULL = windows.
    clientOs: input.source === "AGENT" ? (input.clientOs ?? null) : null,
    customerName: input.customerName,
    customerPhone: input.phone,
    customerEmail: input.email ?? null,
    description: input.description,
    consentTextId: p.consent.id,
    consentSha256: p.consent.sha256,
    consentedAt: now,
    ip: p.ctx.ip.slice(0, 45),
    ipKey: p.ip,
    netKey: p.net,
    deviceHash: p.deviceHash,
    networkMatch: p.networkMatch,
    knownDevice: p.knownDevice,
    expiresAt: p.expiresAt,
    createdAt: now,
    customerId: p.customerId,
    bindingId: p.binding?.id ?? null,
    priority: x.priority,
    slaMinutes: x.slaMinutes,
    slaDueAt: x.slaDueAt,
    afterHours: x.afterHours,
    source: input.source,
    notifySms: x.notify.sms,
    notifyWhatsapp: x.notify.whatsapp,
    notifyEmail: x.notify.email,
  };
}
