// Talep durum bildirimi kuyruğa alma (P19 J3; S-P19-12, T11/T12/T13) — `notify/outbox.ts`'ten taşındı (mimari-p27 §7.1
// "dokunan böler"; davranış aynı). Talep TX'inde (`lockSettings` ilk ifade — T12), seçilmiş VE firmanın açtığı kanal başına
// bir satır (UQ → INSERT IGNORE); alıcı şifreli (AAD satıra bağlı). Tavanlar (`NOTIFY_LIMITS`) DB sayımıyla aynı TX'te; aşımda
// satır `FAILED rate_limited` (gönderilmez) + audit + metrik. P27 türleri (`unattended/notify.ts`, `contacts.ts`) tavansızdır.
import { NOTIFY_LIMITS, type NotifyChannel, type NotifyKind, type NotifyRateScope } from "@remote/contracts/api/notify";
import { notifyEmailKey } from "@remote/contracts/api/requests";
import { NOTIFY_AUDIT } from "@remote/contracts/audit";
import { maskEmail, maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, NOTIFY_RECIPIENT_KEY_VERSION, type SecretBox } from "../lib/crypto.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const OUTBOX_CTX: AuditContext = { ip: "", userAgent: "notify-outbox", requestId: "" };

const CHANNEL_FLAGS = [
  ["SMS", "notifySms", "notifySmsEnabled"],
  ["WHATSAPP", "notifyWhatsapp", "notifyWhatsappEnabled"],
  ["EMAIL", "notifyEmail", "notifyEmailEnabled"],
] as const;

/** S-P19-T11/T13: normalize alıcı (telefon E.164, e-posta `notifyEmailKey`) → sabit anahtar sürümüyle HMAC. */
export function recipientHash(secrets: SecretBox, channel: NotifyChannel, recipient: string): string {
  const norm = channel === "EMAIL" ? notifyEmailKey(recipient) : recipient;
  return secrets.macAt(NOTIFY_RECIPIENT_KEY_VERSION, "notify-recipient", norm);
}

const notRateLimited = { OR: [{ lastReason: null }, { lastReason: { not: "rate_limited" } }] };

/**
 * S-P19-12: firma içi alıcı 3/24 sa, sistem geneli alıcı 5/24 sa, firma × kanal saatlik tavan. Firma içi sayımlar
 * `lockSettings` ile kesin; sistem geneli sayım firmalar arası kilitsiz anlık görüntü → YAKLAŞIK tavan (S-P19-K2; N firmada
 * eşzamanlı geçişte en çok 4 + N). Alıcı kilidi bilinçli eklenmedi: RR anlık görüntüsü kilitten önce kurulduğu için kesinlik
 * kilitleyici okuma (gap kilidi → firmalar arası 1213) ya da TX içinde ikinci havuz bağlantısı gerektirir (runbook §26.5 m.6).
 */
async function overLimit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  channel: NotifyChannel,
  hash: string,
  now: Date,
): Promise<NotifyRateScope | null> {
  const day = new Date(now.getTime() - DAY_MS);
  const hour = new Date(now.getTime() - HOUR_MS);
  const [recTenant, recGlobal, perTenant] = await Promise.all([
    tx.notificationOutbox.count({ where: { tenantId, recipientHash: hash, channel, createdAt: { gt: day }, ...notRateLimited } }),
    tx.notificationOutbox.count({ where: { recipientHash: hash, channel, createdAt: { gt: day }, ...notRateLimited } }),
    tx.notificationOutbox.count({ where: { tenantId, channel, createdAt: { gt: hour }, ...notRateLimited } }),
  ]);
  if (recTenant >= NOTIFY_LIMITS.recipientTenantPerDay) return "recipient_tenant";
  if (recGlobal >= NOTIFY_LIMITS.recipientGlobalPerDay) return "recipient_global";
  if (perTenant >= NOTIFY_LIMITS.tenantPerHour[channel]) return "tenant_channel";
  return null;
}

export interface EnqueueDeps {
  secrets: SecretBox;
  metrics: Metrics;
  now: () => number;
}

async function rateLimitedAudit(tx: Prisma.TransactionClient, o: { tenantId: string; requestId: string; kind: NotifyKind }, v: object) {
  await writeAudit(tx, OUTBOX_CTX, {
    tenantId: o.tenantId,
    username: "system",
    action: NOTIFY_AUDIT.CUSTOMER_NOTIFY,
    entity: "support_requests",
    entityId: o.requestId,
    result: "fail",
    newValue: { kind: o.kind, result: "fail", attempts: 0, reason: "rate_limited", ...v },
  });
}

/**
 * Durum geçişinin TX'inde çağrılır. Talebin seçtiği (bastırma sonrası) VE firmanın açtığı kanallara satır yazar. Kanal
 * yapılandırılmamış olsa da yazılır (işçi FAILED yapar).
 */
export async function enqueueRequest(
  d: EnqueueDeps,
  tx: Prisma.TransactionClient,
  o: { tenantId: string; requestId: string; kind: NotifyKind },
): Promise<void> {
  const { tenantId, requestId, kind } = o;
  const [r, s] = await Promise.all([
    tx.supportRequest.findFirst({
      where: { id: requestId, tenantId },
      select: { notifySms: true, notifyWhatsapp: true, notifyEmail: true, customerPhone: true, customerEmail: true },
    }),
    tx.tenantRequestSettings.findUnique({
      where: { tenantId },
      select: { notifySmsEnabled: true, notifyWhatsappEnabled: true, notifyEmailEnabled: true },
    }),
  ]);
  if (!r || !s) return;
  const now = new Date(d.now());
  for (const [channel, pick, enabled] of CHANNEL_FLAGS) {
    if (!r[pick] || !s[enabled]) continue;
    const to = channel === "EMAIL" ? r.customerEmail : r.customerPhone;
    if (!to) continue;
    const hash = recipientHash(d.secrets, channel, to);
    const mask = channel === "EMAIL" ? maskEmail(to) : maskPhone(to);
    const scope = await overLimit(tx, tenantId, channel, hash, now);
    const id = newId();
    const base = { id, tenantId, requestId, kind, channel, recipientMask: mask, recipientHash: hash, createdAt: now, nextAt: now };
    const data = scope
      ? { ...base, state: "FAILED", recipientEnc: null, attempts: 0, lastReason: "rate_limited" }
      : { ...base, state: "PENDING", recipientEnc: Buffer.from(d.secrets.encrypt(to, aadFor.outboxRecipient(tenantId, id))) };
    const { count } = await tx.notificationOutbox.createMany({ data: [data], skipDuplicates: true });
    if (count === 0 || !scope) continue;
    d.metrics.inc("rs_notify_rate_limited_total", { scope, channel });
    await rateLimitedAudit(tx, o, { channel, recipient: mask, scope });
  }
}
