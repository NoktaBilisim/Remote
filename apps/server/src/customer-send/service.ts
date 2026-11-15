// LG servis (mimari-link-gonderme §4.4, §5.4, §7, §8; AC-406..409, 413..425). `options()`: kanal matrisi + alıcılar +
// `renderFor` önizlemeleri (gönderim/sayaç/audit yok). `send()`: kanal 409 → alıcı 400 → K1 eski servis fonksiyonlarına
// delegasyon (tavan + audit aynen, AC-414) | K2/K3 tek TX (kullanıcı kilidi → 20/sa havuz → K2 koşullu sent_count → bellek
// kovaları → `phase:"reserved"` audit) → TX dışında aynı `renderFor` metni → dış gönderim → `phase:"result"` audit.
// Alıcı audit'e maskeli; kod, belirteç, bağlantı ve ref audit'e/loga yazılmaz. Başarısız gönderim K2 hakkını geri vermez.
import {
  CHANNELS_BY_KIND,
  UNATTENDED_CODE_SENDS_MAX,
  type ChannelBlock,
  type ChannelOption,
  type CustomerSendChannel,
  type CustomerSendInput,
  type CustomerSendOptions,
  type MessagePreview,
  type SendTarget,
} from "@remote/contracts/api/customer-send";
import { SEND_FAILED_MESSAGES, SMS_TR_ONLY_MESSAGE, toSmsPhone } from "@remote/contracts/api/notify";
import { notifyEmailKey } from "@remote/contracts/api/requests";
import { SMTP_SEND_FAILED_MESSAGE } from "@remote/contracts/api/tenants";
import { CUSTOMER_AUDIT, UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { maskEmail, maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { AppError } from "../lib/errors.ts";
import { publicReason } from "../lib/outbound.ts";
import type { MailService } from "../mail/service.ts";
import type { Metrics } from "../ops/metrics.ts";
import { mailOf, previewOf, renderFor } from "../notify/customer-templates.ts";
import { recipientHash } from "../notify/outbox.ts";
import { SmsClient } from "../notify/sms.ts";
import type { WhatsappNotifier } from "../notify/whatsapp.ts";
import type { AgentBinary } from "../public/agent-binary.ts";
import { emailSessionLink } from "../sessions/email.ts";
import { lockTechnician } from "../sessions/repo.ts";
import { assertLinkPool, hitSendBuckets, sendSessionLink, type SendLinkDeps } from "../sessions/send-link.ts";
import { resolveTarget, type Resolved, type TargetDeps } from "./targets.ts";

export interface CustomerSendDeps extends TargetDeps {
  mail: MailService;
  whatsapp: WhatsappNotifier;
  sms: SmsClient;
  metrics: Metrics;
  serviceBinary: AgentBinary;
  sendLink: SendLinkDeps;
}

const SETTINGS_HREF: Record<CustomerSendChannel, string> = {
  EMAIL: "/settings/smtp",
  SMS: "/settings/sms",
  WHATSAPP: "/admin/settings/whatsapp",
};

/** §5.4 kanal kullanılabilirliği (yetki `Resolved.allowed`'da). null = kullanılabilir. */
async function blockOf(d: CustomerSendDeps, r: Resolved, tenantId: string, channel: CustomerSendChannel): Promise<ChannelBlock | null> {
  if (channel === "EMAIL") {
    if (!(await d.mail.configFor(tenantId))) return "unconfigured";
    // KD-LG3: K2'de ikili kapısı kapalıysa indirme satırsız kurulum mesajı anlamsız → kanal yok.
    if (r.kind === "UNATTENDED_CODE" && (await d.serviceBinary.check()) !== "ok") return "unconfigured";
  } else if (channel === "WHATSAPP") {
    if (!d.whatsapp.usable) return "unconfigured";
    // O-LG-1: kalıcı yetki veren K2 içeriği yalnız şifreli taşımada (K13 bayrağından bağımsız).
    if (r.kind === "UNATTENDED_CODE" && !d.whatsapp.transportEncrypted) return "insecure_transport";
  } else if (!(await d.sms.usableFor(tenantId))) return "unconfigured";
  if (r.recipientsLocked && (channel === "EMAIL" ? r.recipients.email : r.recipients.phone).length === 0) return "no_recipient";
  return null;
}

function hrefFor(auth: AuthContext, channel: CustomerSendChannel): string | null {
  if (channel === "WHATSAPP") return auth.user.role === "SUPER_ADMIN" ? SETTINGS_HREF.WHATSAPP : null;
  return auth.permissions.has("settings.view") ? SETTINGS_HREF[channel] : null;
}

export async function customerSendOptions(
  d: CustomerSendDeps,
  auth: AuthContext,
  tenantId: string,
  target: SendTarget,
): Promise<CustomerSendOptions> {
  const r = await resolveTarget(d, auth, tenantId, target);
  const channels: ChannelOption[] = [];
  const previews: Partial<Record<CustomerSendChannel, MessagePreview>> = {};
  for (const channel of r.allowed) {
    const block = await blockOf(d, r, tenantId, channel);
    channels.push({ channel, available: block === null, block, settingsHref: hrefFor(auth, channel) });
    if (block === null) previews[channel] = previewOf(renderFor(channel, r.input));
  }
  return {
    kind: r.kind,
    channels,
    recipients: r.recipients,
    recipientsLocked: r.recipientsLocked,
    previews,
    remainingSends: r.remainingSends,
  };
}

/** AC-409/417: kanal–alıcı uyumu şemada; K2 alıcısı müşterinin bildirim adreslerinden; SMS yalnız +90 5…. */
function assertRecipient(r: Resolved, channel: CustomerSendChannel, to: string): void {
  if (channel === "SMS" && !toSmsPhone(to)) throw new AppError("VALIDATION", { fields: { to: SMS_TR_ONLY_MESSAGE } });
  if (!r.recipientsLocked) return;
  const ok =
    channel === "EMAIL"
      ? r.recipients.email.some((x) => notifyEmailKey(x.value) === notifyEmailKey(to))
      : r.recipients.phone.some((x) => x.value === to);
  if (!ok) throw new AppError("VALIDATION", { fields: { to: "Alıcı müşterinin kayıtlı bildirim adreslerinden seçilmelidir." } });
}

type Who = { tenantId: string; userId: string; username: string };

/** K2: koşullu UPDATE (`sent_count < 3`); 0 satır → yeniden okuma: tavan 429, diğer 409 (§4.4 m.5). */
async function bumpSentCount(
  tx: Parameters<Parameters<CustomerSendDeps["db"]["$transaction"]>[0]>[0],
  w: Who,
  codeId: string,
): Promise<void> {
  const n = await tx.$executeRaw`UPDATE unattended_registration_codes SET sent_count = sent_count + 1
    WHERE id = ${codeId} AND tenant_id = ${w.tenantId} AND created_by = ${w.userId} AND used_at IS NULL
      AND expires_at > NOW(3) AND sent_count < ${UNATTENDED_CODE_SENDS_MAX}`;
  if (n === 1) return;
  const row = await tx.unattendedRegistrationCode.findFirst({ where: { id: codeId, tenantId: w.tenantId }, select: { sentCount: true } });
  if (row && row.sentCount >= UNATTENDED_CODE_SENDS_MAX) throw new AppError("RATE_LIMITED", { retryAfterSec: 3600 });
  throw new AppError("CONFLICT", { message: "Kayıt kodu artık geçerli değil; yeni kod oluşturun." });
}

function auditFields(r: Resolved, channel: CustomerSendChannel, recipient: string) {
  const base = { channel, recipient };
  if (r.kind === "UNATTENDED_CODE") return { ...base, customerId: r.customerId ?? "" };
  const links =
    r.input.kind === "CUSTOMER" ? [...(r.input.downloadUrl ? ["download"] : []), ...(r.input.webFormUrl ? ["webform"] : [])] : [];
  return { ...base, links };
}

const actionOf = (r: Resolved): string => (r.kind === "UNATTENDED_CODE" ? UNATTENDED_AUDIT.CODE_SENT : CUSTOMER_AUDIT.LINK_SENT);

/** K2/K3 gönderimi (§4.4 m.5–7). */
async function sendOwn(
  d: CustomerSendDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  r: Resolved,
  channel: "EMAIL" | "WHATSAPP",
  to: string,
): Promise<void> {
  const w: Who = { tenantId, userId: auth.user.id, username: auth.user.email };
  const hash = recipientHash(d.secrets, channel, to);
  const recipient = channel === "EMAIL" ? maskEmail(to) : maskPhone(to);
  const fields = auditFields(r, channel, recipient);
  const action = actionOf(r);
  const audit = { ...w, action, entity: r.entity, entityId: r.entityId };
  const cfg = channel === "EMAIL" ? await d.mail.configFor(w.tenantId) : null;
  await d.db.$transaction(async (tx) => {
    await lockTechnician(tx, auth.user.id);
    await assertLinkPool(tx, w.tenantId, auth.user.id, new Date());
    if (r.kind === "UNATTENDED_CODE") await bumpSentCount(tx, w, r.entityId);
    hitSendBuckets(d.sendLink.limits, w.tenantId, hash);
    await writeAudit(tx, ctx, { ...audit, result: "success", newValue: { phase: "reserved", ...fields } });
  });

  const rendered = renderFor(channel, r.input); // AC-407: önizlemeyle aynı fonksiyon
  let reason: string | null;
  let metric: string;
  if (channel === "EMAIL") {
    const kind = r.kind === "UNATTENDED_CODE" ? "unattended_code" : "customer_link";
    const out = await d.mail.sendForTenant(ctx, { ...w, kind, entity: r.entity, entityId: r.entityId }, to, mailOf(rendered), cfg, {
      interactive: true,
    });
    reason = out.ok ? null : out.reason;
    metric = out.ok ? "ok" : out.reason;
  } else {
    const raw = await d.whatsapp.sendCustomer(w.tenantId, hash, to, rendered.text);
    reason = raw === "ok" ? null : raw === "unconfigured" || raw === "rate_limited" ? raw : publicReason(raw);
    metric = raw;
  }
  d.metrics.inc("rs_link_send_total", { kind: r.kind, channel, result: metric });
  const result = reason ? "fail" : "success";
  await writeAudit(d.db, ctx, { ...audit, result, newValue: { phase: "result", ...fields, result, ...(reason ? { reason } : {}) } });
  if (!reason) return;
  if (channel === "EMAIL") throw new AppError("UPSTREAM", { message: SMTP_SEND_FAILED_MESSAGE });
  if (reason === "unconfigured") throw new AppError("CHANNEL_UNAVAILABLE");
  if (reason === "rate_limited") throw new AppError("RATE_LIMITED", { retryAfterSec: 3600 });
  throw new AppError("UPSTREAM", { message: SEND_FAILED_MESSAGES.WHATSAPP, fields: { reason } });
}

export async function customerSend(
  d: CustomerSendDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: CustomerSendInput,
): Promise<void> {
  const r = await resolveTarget(d, auth, tenantId, input.target);
  const channel = input.channel;
  if (!(CHANNELS_BY_KIND[r.kind] as readonly string[]).includes(channel))
    throw new AppError("VALIDATION", { fields: { channel: "Bu gönderim için kanal desteklenmiyor." } });
  if (!r.allowed.includes(channel)) throw new AppError("FORBIDDEN");
  if ((await blockOf(d, r, tenantId, channel)) !== null) throw new AppError("CHANNEL_UNAVAILABLE");
  const to = input.to.trim();
  assertRecipient(r, channel, to);
  if (r.input.kind === "SESSION") {
    // AC-414: K1 eski servis fonksiyonları (tavan, audit `session.email` / `session.link_sent`, hata eşlemesi aynen).
    const link = r.input.link;
    if (channel === "EMAIL") await emailSessionLink(d.mail, d.publicBaseUrl, ctx, auth, tenantId, r.entityId, { to, link }, d.agent);
    else await sendSessionLink(d.sendLink, ctx, auth, tenantId, r.entityId, { channel, phone: to, link });
    return;
  }
  // K2/K3: CHANNELS_BY_KIND (şema + yukarıdaki kontrol) SMS'i zaten reddetti → kanal EMAIL | WHATSAPP.
  await sendOwn(d, ctx, auth, tenantId, r, channel as Exclude<CustomerSendChannel, "SMS">, to);
}
