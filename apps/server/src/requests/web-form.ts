// P19 web talep formu (§8c.2; AC-259) — PT-K9: service.ts `webFormInfo` / `webFormRejected` / `createWeb` gövdelerinin
// mekanik taşınması. Sınıf yöntemleri (`RequestService.webFormInfo`, `createWeb`) bu işlevleri çağırır; sıra aynı.
import type { WebFormInfo, WebRequestData } from "@remote/contracts/api/requests";
import { WEB_FORM_FAST_MESSAGE, WEB_FORM_MIN_DELAY_MS, webRequestInputSchema } from "@remote/contracts/api/requests";
import { WEB_REQUEST_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { ipKey, isIPv6Key, netKey, prefixKey } from "../lib/ip.ts";
import { blocked, rateLimited } from "./limits.ts";
import type { SettingsRow } from "./repo.ts";
import { CUSTOMER, type CreateCoreInput, type RequestService } from "./service.ts";

/** GET /public/web-requests/form?ref= — geçersiz ref, pasif müşteri, form kapalı → aynı 404 (S-P19-2). */
export async function webFormInfoOf(svc: RequestService, ctx: AuditContext, ref: unknown): Promise<WebFormInfo> {
  const ip = ipKey(ctx.ip);
  svc.assertRefNotBlocked(ip);
  const r = await svc.resolveRef(ref);
  if (!r || !r.s.webFormEnabled) throw svc.refInvalid(ip);
  await svc.limit(ctx, r.s.tenantId, "info", "req.info", "ip", ip);
  // S-P19-K1: token veren uca IPv6 /56 ve /48 kovaları — /64 döndürmeyle nonce kümesi doldurulamaz. IPv4'te yalnız /32
  // (`info`): adres döndürme pahalı; /24 kovası CGNAT/kurum NAT'ında meşru ziyaretçiyi keserdi.
  const net = netKey(ctx.ip);
  if (isIPv6Key(net)) {
    await svc.limit(ctx, r.s.tenantId, "webFormPrefix", "req.web_form.prefix", "prefix", prefixKey(ctx.ip));
    await svc.limit(ctx, r.s.tenantId, "webFormNet48", "req.web_form.net48", "net48", net);
  }
  return {
    ...(await requestFormInfo(svc, r.s)),
    formToken: svc.formTokens.issue(ref as string, r.s.tenantId), // resolveRef biçimi doğruladı; token bu ref'e + firma bölmesine bağlı
    minDelayMs: WEB_FORM_MIN_DELAY_MS,
  };
}

/**
 * Form bilgisinin token'sız ortak parçası (P21 K-P21-2): `/r/` web formu ve portal talep sayfası aynı gövdeyi alır
 * (firma, KVKK metni, sohbet saklama süresi, açık kanallar, mesai). Form token'ı ve `web_form_enabled` denetimi çağıranda.
 */
export async function requestFormInfo(svc: RequestService, s: SettingsRow): Promise<Omit<WebFormInfo, "formToken" | "minDelayMs">> {
  const tenantId = s.tenantId;
  const [info, ts, avail] = await Promise.all([
    svc.requestInfo(tenantId, s.tenant, s.waitMinutes),
    svc.d.db.tenantSettings.findUnique({ where: { tenantId }, select: { retentionDays: true } }),
    svc.channelAvailability(tenantId),
  ]);
  if (!ts || !info.businessHours) throw new Error("tenant_settings satırı yok");
  return {
    tenant: info.tenant,
    consentText: info.consentText,
    chatRetentionDays: ts.retentionDays,
    channels: svc.channelsOf(s, avail),
    businessHours: info.businessHours,
  };
}

/** Bot kapısı reddi: metrik her seferinde, audit ipKey başına dakikada 1 (AC-144 kalıbı); token/ref/ipKey yazılmaz. */
async function webFormRejected(
  svc: RequestService,
  ctx: AuditContext,
  reason: "fast" | "token" | "honeypot" | "token_store_full",
): Promise<void> {
  svc.d.metrics.inc("rs_web_form_rejected_total", { reason });
  svc.d.metrics.inc("rs_web_requests_total", { result: "rejected" });
  if (reason === "token_store_full") svc.d.log.warn({ alarm: "web_form_token_store_full" }, "web formu nonce kümesi dolu");
  const k = `webform|${ipKey(ctx.ip)}`;
  if (svc.d.limits.rateAudit.blockedFor(k) > 0 || svc.d.limits.rateAudit.hit(k)) return;
  await writeAudit(svc.d.db, ctx, {
    tenantId: null,
    ...CUSTOMER,
    action: WEB_REQUEST_AUDIT.WEB_FORM_REJECTED,
    entity: "support_requests",
    result: "fail",
    newValue: { reason },
  });
}

/**
 * POST /public/web-requests ilk yarısı (§8c.2 m.2–3): zod → bot kapısı (gizli alan, token HMAC + ref + yaş, SENKRON tüketim)
 * → ortak çekirdek girdisi. Tüketim ref/mesai/kova/TX'ten ÖNCE: sonraki red alan token da harcanmıştır.
 */
export async function webFormCoreInput(svc: RequestService, ctx: AuditContext, body: unknown): Promise<CreateCoreInput> {
  const input: WebRequestData = parseInput(webRequestInputSchema, body);
  if (input.website !== "") {
    await webFormRejected(svc, ctx, "honeypot");
    throw new AppError("VALIDATION");
  }
  const check = svc.formTokens.verify(input.formToken, input.ref);
  if (!check.ok && check.reason === "fast") {
    await webFormRejected(svc, ctx, "fast");
    throw new AppError("RATE_LIMITED", { retryAfterSec: Math.ceil(check.retryAfterMs / 1000), message: WEB_FORM_FAST_MESSAGE });
  }
  // S-P19-K1: ipKey kovası zaten kilitliyse token TÜKETİLMEDEN 429 (sayımsız, senkron; kilitli istemci nonce kümesini
  // şişiremez). Önek/net48 burada bakılmaz: güvenilen CIDR muafiyeti DB gerektirir (createCore'da S14-1 ön kontrolü).
  const ipWait = blocked(svc.d.limits.createIp, ipKey(ctx.ip));
  // İlk await'ten önce: doğrulama + tüketim aynı senkron adımda (aynı token'la 10 paralel → tam 1 geçer).
  const consumed = ipWait > 0 ? "blocked" : check.ok ? svc.formTokens.nonces.consume(check.part, check.nonce, check.expiresAt) : "used";
  if (consumed === "blocked") {
    await svc.rateAudit(ctx, null, "req.create.ip", "ip", ipKey(ctx.ip));
    throw rateLimited(ipWait);
  }
  if (consumed !== "ok") {
    await webFormRejected(svc, ctx, consumed === "full" ? "token_store_full" : "token");
    throw new AppError("FORM_TOKEN_INVALID");
  }
  return {
    ref: input.ref,
    clientInstanceId: input.clientInstanceId,
    customerName: input.customerName,
    phone: input.phone,
    ...(input.email !== undefined ? { email: input.email } : {}),
    description: input.description,
    consentTextId: input.consentTextId,
    consentAccepted: input.consentAccepted,
    notify: input.notify,
    source: "WEB",
    clientVersion: null,
  };
}
