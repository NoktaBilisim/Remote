// POST /sessions/:id/send-link, GET /sessions/:id/send-link/options (P19 J3, mimari-e11 §8c.3; AC-260; S-P19-7).
// `sessions/email.ts` kalıbı: yalnız oturumun kendi teknisyeni, PENDING ve süresi dolmamış; `link` oturumun kendi bağlantısı
// (SHA-256(token) = token_hash) → başka adres gönderilemez. Şablon sabit (serbest metin yok).
//  - 20/sa/kullanıcı (SMS + WA toplam): TX + `users FOR UPDATE` + son 1 sa `session.link_sent {phase:"reserved"}` sayımı;
//    rezervasyon gönderimden ÖNCE aynı TX'te; sonuç ayrı satır `{phase:"result"}` (yeniden başlatmaya dayanıklı).
//  - Bellek kovaları (kullanıcı tavanından sonra; S-P19-K3): firma × alıcı 5/sa (taciz), tenant 200/sa (maliyet) → 429.
//  - Kanal kullanılamaz → 409 CHANNEL_UNAVAILABLE; servis hatası → 502 UPSTREAM sabit mesaj + `fields.reason` (timeout →
//    unreachable). Numara loga yazılmaz; audit `maskPhone`.
import {
  SEND_FAILED_MESSAGES,
  SEND_LINK_PER_HOUR,
  SEND_LINK_RECIPIENT_PER_HOUR,
  SEND_LINK_TENANT_PER_HOUR,
  SMS_TR_ONLY_MESSAGE,
  toSmsPhone,
  type SendLinkOptions,
} from "@remote/contracts/api/notify";
import { sessionTokenSchema } from "@remote/contracts/api/sessions";
import { CUSTOMER_AUDIT, NOTIFY_AUDIT, UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { SecretBox } from "../lib/crypto.ts";
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { safeEqual, sha256Hex } from "../lib/ids.ts";
import { publicReason } from "../lib/outbound.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import type { Metrics } from "../ops/metrics.ts";
import { recipientHash } from "../notify/outbox.ts";
import { SmsClient } from "../notify/sms.ts";
import { renderFor } from "../notify/customer-templates.ts";
import { agentLinkFor, type AgentLinkDeps } from "../public/agent.ts";
import type { WhatsappNotifier } from "../notify/whatsapp.ts";
import { lockTechnician } from "./repo.ts";

const HOUR_MS = 3_600_000;

export interface SendLinkDeps {
  db: Db;
  sms: SmsClient;
  whatsapp: WhatsappNotifier;
  secrets: SecretBox;
  metrics: Metrics;
  publicBaseUrl: string;
  limits: SendLinkLimits;
  /** LG §5.1: K1 metnindeki doğrudan indirme bağlantısı. */
  agent: AgentLinkDeps;
}

/**
 * LG §7 (AC-420, 423): kullanıcı başına 20/sa bağlantı havuzu — K1 SMS/WA, K2 ve K3 aynı sayaç (`phase:"reserved"` satırları).
 */
export const LINK_POOL_ACTIONS = [NOTIFY_AUDIT.LINK_SENT, UNATTENDED_AUDIT.CODE_SENT, CUSTOMER_AUDIT.LINK_SENT] as const;

/** TX içinde (kullanıcı satırı kilitliyken) havuz sayımı; dolu → 429 + Retry-After. */
export async function assertLinkPool(tx: Prisma.TransactionClient, tenantId: string, userId: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - HOUR_MS);
  const rows = await tx.$queryRaw<{ created_at: Date }[]>`SELECT created_at FROM audit_logs
    WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND action IN (${Prisma.join([...LINK_POOL_ACTIONS])}) AND created_at >= ${since}
      AND JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.phase')) = 'reserved'
    ORDER BY created_at LIMIT ${SEND_LINK_PER_HOUR}`;
  if (rows.length >= SEND_LINK_PER_HOUR) {
    const oldest = rows[0]?.created_at.getTime() ?? now.getTime();
    throw new AppError("RATE_LIMITED", { retryAfterSec: Math.max(1, Math.ceil((oldest + HOUR_MS - now.getTime()) / 1000)) });
  }
}

/** S-P19-K3: bellek kovaları (alıcı firma kapsamlı 5/sa, firma 200/sa) — kullanıcı tavanından SONRA, rezervasyondan önce. */
export function hitSendBuckets(limits: SendLinkLimits, tenantId: string, recipientKey: string): void {
  const buckets = [
    [limits.recipient, `${tenantId}|${recipientKey}`],
    [limits.tenant, tenantId],
  ] as const;
  for (const [counter, key] of buckets) {
    const wait = counter.blockedFor(key);
    if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
  }
  for (const [counter, key] of buckets) if (counter.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: 3600 });
}

export interface SendLinkLimits {
  recipient: FixedWindowCounter;
  tenant: FixedWindowCounter;
}

/** `limit` = izinli + 1 (FixedWindowCounter: limit'inci olay kilitler). */
export function createSendLinkLimits(): SendLinkLimits {
  return {
    recipient: new FixedWindowCounter(SEND_LINK_RECIPIENT_PER_HOUR + 1, HOUR_MS, HOUR_MS),
    tenant: new FixedWindowCounter(SEND_LINK_TENANT_PER_HOUR + 1, HOUR_MS, HOUR_MS),
  };
}

export function closeSendLinkLimits(l: SendLinkLimits): void {
  l.recipient.close();
  l.tenant.close();
}

function tokenFromLink(publicBaseUrl: string, link: string): string | null {
  const prefix = `${publicBaseUrl.replace(/\/+$/, "")}/session/`;
  if (!link.startsWith(prefix)) return null;
  const t = sessionTokenSchema.safeParse(link.slice(prefix.length));
  return t.success ? t.data : null;
}

async function ownPending(db: Db, auth: AuthContext, tenantId: string, id: string) {
  const s = await db.supportSession.findFirst({
    where: { id, tenantId, technicianId: auth.user.id },
    select: {
      status: true,
      expiresAt: true,
      tokenHash: true,
      activeCode: true,
      tenant: { select: { name: true } },
    },
  });
  if (!s) throw new AppError("NOT_FOUND");
  if (s.status !== "PENDING" || s.expiresAt <= new Date() || !s.activeCode)
    throw new AppError("CONFLICT", { message: "Yalnız bekleyen oturumun bağlantısı gönderilebilir." });
  return s;
}

/** GET options: kanal kullanılabilirliği + (talepten doğan oturumda) talebin telefonu — yalnız kendi teknisyenine. */
export async function sendLinkOptions(d: SendLinkDeps, auth: AuthContext, tenantId: string, id: string): Promise<SendLinkOptions> {
  const s = await d.db.supportSession.findFirst({
    where: { id, tenantId, technicianId: auth.user.id },
    select: { request: { select: { customerPhone: true } } },
  });
  if (!s) throw new AppError("NOT_FOUND");
  return { sms: await d.sms.usableFor(tenantId), whatsapp: d.whatsapp.usable, suggestedPhone: s.request?.customerPhone ?? null };
}

export async function sendSessionLink(
  d: SendLinkDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  input: { channel: "SMS" | "WHATSAPP"; phone: string; link: string },
): Promise<void> {
  const s = await ownPending(d.db, auth, tenantId, id);
  const token = tokenFromLink(d.publicBaseUrl, input.link);
  if (!token || !safeEqual(sha256Hex(token), s.tokenHash))
    throw new AppError("VALIDATION", { fields: { link: "Bağlantı bu oturuma ait değil." } });
  if (input.channel === "SMS" && !toSmsPhone(input.phone)) throw new AppError("VALIDATION", { fields: { phone: SMS_TR_ONLY_MESSAGE } });
  const smsState = input.channel === "SMS" ? await d.sms.state(tenantId) : null;
  const available = smsState ? SmsClient.usable(smsState) : d.whatsapp.usable;
  if (!available) throw new AppError("CHANNEL_UNAVAILABLE");

  const hash = recipientHash(d.secrets, input.channel, input.phone);
  const who = { tenantId, userId: auth.user.id, username: auth.user.email };
  const recipient = maskPhone(input.phone);
  const now = new Date();
  await d.db.$transaction(async (tx) => {
    await lockTechnician(tx, auth.user.id);
    await assertLinkPool(tx, tenantId, auth.user.id, now);
    hitSendBuckets(d.limits, tenantId, hash);
    await writeAudit(tx, ctx, {
      ...who,
      action: NOTIFY_AUDIT.LINK_SENT,
      entity: "support_sessions",
      entityId: id,
      result: "success",
      newValue: { phase: "reserved", channel: input.channel, recipient },
    });
  });

  const message = renderFor(input.channel, {
    kind: "SESSION",
    firm: s.tenant.name,
    technician: auth.user.fullName,
    link: input.link,
    code: s.activeCode ?? "",
    expiresAt: s.expiresAt,
    agent: await agentLinkFor(d.agent, id),
  }).text;
  const raw =
    input.channel === "SMS"
      ? await d.sms.send(tenantId, input.phone, message, smsState ?? undefined)
      : await d.whatsapp.sendCustomer(tenantId, hash, input.phone, message);
  const reason =
    raw === "ok" ? null : raw === "invalid_phone" || raw === "unconfigured" || raw === "rate_limited" ? raw : publicReason(raw);
  d.metrics.inc("rs_link_send_total", { kind: "SESSION", channel: input.channel, result: raw });
  await writeAudit(d.db, ctx, {
    ...who,
    action: NOTIFY_AUDIT.LINK_SENT,
    entity: "support_sessions",
    entityId: id,
    result: reason ? "fail" : "success",
    newValue: { phase: "result", channel: input.channel, recipient, result: reason ? "fail" : "success", ...(reason ? { reason } : {}) },
  });
  if (!reason) return;
  if (reason === "unconfigured") throw new AppError("CHANNEL_UNAVAILABLE");
  if (reason === "rate_limited") throw new AppError("RATE_LIMITED", { retryAfterSec: 3600 });
  throw new AppError("UPSTREAM", { message: SEND_FAILED_MESSAGES[input.channel], fields: { reason } });
}
