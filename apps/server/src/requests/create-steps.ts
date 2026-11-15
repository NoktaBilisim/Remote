// Talep oluşturma TX öncesi adımları (PT-K9: service.ts `createCore` içinden mekanik çıkarım; kova/await sırası aynı).
// Sıra (G-E9-10, P14a AC-209, P18, P19): ön bakış → [kapı] → ip/önek/net48 kovaları → zod → sürüm → kaynak (ref/kayıt) →
// engel → mesai → kanal → onay metni → bilinen kaynak → tenant kovası (okuma) → TX (create-tx.ts) → commit sonrası
// (create-after.ts). Kapı (`gated`) ve kapı öncesi kilit ön kontrolü service.ts `createCore`'da kalır.
import { CHAT_MIN_CLIENT_VERSION, REQUEST_BUSY_MESSAGE } from "@remote/contracts/api/requests";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { bindingInvalid, resolveUsable } from "../bindings/service.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { cidrListMatcher, ipKey, isIPv6Key, netKey, prefixKey } from "../lib/ip.ts";
import { compareVersions, isOutdated } from "../lib/version.ts";
import { outdated } from "../sessions/public.ts";
import type { RequestSource } from "@remote/contracts/api/requests";
import { outsideHoursMessage } from "./calendar.ts";
import { insertWithRetry, type Created, type CreatePlan } from "./create-tx.ts";
import { openState, type TenantCalendar } from "./hours.ts";
import { rateLimited, RATE_BLOCK_SEC, TENANT_KNOWN_PER_HOUR, TENANT_UNKNOWN_PER_HOUR, TENANT_WEB_PER_HOUR } from "./limits.ts";
import * as repo from "./repo.ts";
import { CUSTOMER, tenantActive, type CreateCoreInput, type RequestService } from "./service.ts";

/** S-P18-T7: `request.created fail {reason:"outside_hours"}` audit'i tenant başına bu pencerede en çok 1 satır. */
const OUTSIDE_AUDIT_WINDOW_MS = 60_000;

/** Ön bakış (kovalardan önce; yalnız güvenilen CIDR ve kapı anahtarı için). */
interface Peek {
  ip: string;
  prefix: string;
  net: string;
  web: boolean;
  peekObj: { ref?: unknown; bindingKey?: unknown };
  peekedRef: Awaited<ReturnType<RequestService["resolveRef"]>>;
  peekedBinding: Awaited<ReturnType<typeof resolveUsable>>;
  peeked: repo.SettingsRow | null;
  trusted: boolean;
}

/** TX'e kadar geçen talep + TX sonucu (commit sonrası adımlar için). */
export type Admitted = CreatePlan & { created: Created };

export async function peekCreate(svc: RequestService, ctx: AuditContext, body: unknown, source: RequestSource): Promise<Peek> {
  const ip = ipKey(ctx.ip);
  const prefix = prefixKey(ctx.ip);
  const net = netKey(ctx.ip);
  svc.assertRefNotBlocked(ip);
  const web = source === "WEB";
  // P8c: `ref` (Genel/müşteri) ya da `bindingKey` (kayıt). Çözümleme kovalardan önce yalnız güvenilen CIDR için bakılır.
  const peekObj = typeof body === "object" && body !== null ? (body as { ref?: unknown; bindingKey?: unknown }) : {};
  const peekedRef = peekObj.bindingKey === undefined ? await svc.resolveRef(peekObj.ref) : null;
  const peekedBinding = peekObj.bindingKey !== undefined ? await resolveUsable(svc, peekObj.bindingKey) : null;
  const bs = peekedBinding ? await repo.settingsByTenant(svc.d.db, peekedBinding.row.tenantId) : null;
  // P19 (§8c.2 m.2, S-P19-2): geçersiz ref, pasif müşteri, form kapalı → aynı 404 (aynı gövde, kova/TX'e varılmaz).
  if (web && (!peekedRef || !peekedRef.s.webFormEnabled)) throw svc.refInvalid(ip);
  const peeked = peekedRef?.s ?? (bs && tenantActive(bs.tenant) ? bs : null);
  const trusted = peeked ? cidrListMatcher(repo.jsonStrings(peeked.trustedCidrs))(ctx.ip) : false;
  return { ip, prefix, net, web, peekObj, peekedRef, peekedBinding, peeked, trusted };
}

/** Kapı içi (eski `admit` kapanışı): kovalar → zod → sürüm → kaynak → engel/mesai/kanal/onay → tenant kovası → TX. */
export async function admitCreate(
  svc: RequestService,
  ctx: AuditContext,
  body: unknown,
  parse: (b: unknown) => CreateCoreInput,
  p: Peek,
): Promise<Admitted> {
  if (!p.trusted) await hitCreateKeys(svc, ctx, p);
  // B-P8c-5 (§5.2): biçim dışı / yok / geçersiz anahtar aynı 404 BINDING_INVALID + `req.ref_invalid` kovası (400 değil).
  if (p.peekObj.bindingKey !== undefined && !p.peekedBinding) throw bindingInvalid(svc, p.ip);
  const input = parse(body);
  // S-P19-13: sürüm kapısı yalnız AGENT dalında (WEB 426 almaz).
  if (input.source === "AGENT" && isOutdated(input.clientVersion, svc.d.env.MIN_AGENT_VERSION)) throw outdated(svc.d.env.MIN_AGENT_VERSION);
  const src = await resolveSource(svc, ctx, p, input);
  const gates = await checkGates(svc, ctx, p, src, input);
  const now = new Date(svc.d.clock.now());
  const known = await knownSource(svc, p, src, now);
  // S8b-5: kovalar + TX süreç içi kapıdan geçer (tenant başına 2, toplam 4); bekleyen bağlantı tutmaz.
  const secret = newSecretToken();
  const id = newId();
  const expiresAt = new Date(now.getTime() + src.s.waitMinutes * 60_000);
  await checkTenantBucket(svc, ctx, src.tenantId, p.web, known.privileged);
  const plan: CreatePlan = {
    ctx,
    web: p.web,
    ip: p.ip,
    net: p.net,
    trusted: p.trusted,
    input,
    now,
    secret,
    id,
    expiresAt,
    ...src,
    ...gates,
    ...known,
  };
  return { ...plan, created: await insertWithRetry(svc, plan) };
}

async function hitCreateKeys(svc: RequestService, ctx: AuditContext, p: Peek): Promise<void> {
  const tid = p.peeked?.tenantId ?? null;
  await svc.limit(ctx, tid, "createIp", "req.create.ip", "ip", p.ip);
  await svc.limit(ctx, tid, "createPrefix", "req.create.prefix", "prefix", p.prefix);
  if (isIPv6Key(p.net)) await svc.limit(ctx, tid, "createNet48", "req.create.net48", "net48", p.net);
}

type Source = Pick<CreatePlan, "s" | "tenantId" | "customerId" | "binding" | "via" | "deviceHash">;

async function resolveSource(svc: RequestService, ctx: AuditContext, p: Peek, input: CreateCoreInput): Promise<Source> {
  let s: repo.SettingsRow;
  let customerId: string | null;
  let binding: { id: string; keyHash: string } | null = null;
  if (input.bindingKey !== undefined) {
    if (!p.peekedBinding || !p.peeked || p.peekedBinding.keyHash !== sha256Hex(input.bindingKey)) throw bindingInvalid(svc, p.ip);
    s = p.peeked;
    customerId = p.peekedBinding.row.customerId;
    binding = { id: p.peekedBinding.row.id, keyHash: p.peekedBinding.keyHash };
    // §5.3: kayıt başına 6/sa (E9 ip/önek/net48 ve tenant kovalarına EK — K20, muaf değil).
    await svc.limit(ctx, s.tenantId, "createBinding", "req.create.binding", "binding", binding.id);
  } else {
    if (!p.peekedRef) throw svc.refInvalid(p.ip); // peek aynı gövdenin ref'iyle yapıldı
    s = p.peekedRef.s;
    customerId = p.peekedRef.customer?.id ?? null;
  }
  const tenantId = s.tenantId;
  const via = binding ? "binding" : "ref";
  const deviceHash = input.deviceKey ? sha256Hex(`${tenantId}${input.deviceKey}`) : null;
  return { s, tenantId, customerId, binding, via, deviceHash };
}

/**
 * G-E9-15: ayrıcalık yalnız TRUSTED veya known_device; P8c K20: etkin kayıt da "bilinen" (yalnız kuyruk ≥ 40 eşiği ve
 * bilinen tavanı 120/sa için — ip/önek/net48/tenant kovalarından muaf DEĞİL).
 * P19 (§8c.2 m.2): WEB'de cihaz yok → "bilinen kaynak" = güvenilen CIDR ya da daha önce bağlanmış ağ (IP/önek).
 */
async function knownSource(svc: RequestService, p: Peek, src: Source, now: Date) {
  const networkMatch = p.trusted ? ("TRUSTED" as const) : await repo.networkSeen(svc.d.db, src.tenantId, p.ip, p.net, now);
  const knownDevice = src.deviceHash ? await repo.deviceSeen(svc.d.db, src.tenantId, src.deviceHash, now) : false;
  const privileged = p.web ? p.trusted || networkMatch !== "NONE" : p.trusted || knownDevice || src.binding !== null;
  return { networkMatch, knownDevice, privileged };
}

/** Engel → mesai → (WEB) kanal → onay metni; hepsi kova/TX öncesi, sıra P18/P19 ile aynı. */
async function checkGates(svc: RequestService, ctx: AuditContext, p: Peek, src: Source, input: CreateCoreInput) {
  const tenantId = src.tenantId;
  // P15 (AC-235): engelli IP/önek ya da cihaz → diğer reddedilen taleplerle aynı tek tip yanıt (429 + "yoğunuz"
  // mesajı); talep yazılmaz, kuyruğa düşmez. Güvenilen CIDR muaf DEĞİL (açık engel kararı önceliklidir).
  const blockedBy = await svc.blocks.match(tenantId, ctx.ip, src.deviceHash);
  if (blockedBy) {
    await svc.rateAudit(ctx, tenantId, "blocked", blockedBy === "IP" ? "ip" : "device", blockedBy === "IP" ? p.ip : (src.deviceHash ?? ""));
    throw rateLimited(RATE_BLOCK_SEC, REQUEST_BUSY_MESSAGE);
  }
  const { tc, hours } = await checkHours(svc, ctx, tenantId, input);
  // P19 (§8c.6): firmanın kapalı/kullanılamaz kanalı seçilmişse 400 (form yalnız açık kanalları gösterir).
  if (p.web) {
    const ch = svc.channelsOf(src.s, await svc.channelAvailability(tenantId));
    const bad = (["sms", "whatsapp", "email"] as const).filter((k) => input.notify[k] && !ch[k]);
    if (bad.length > 0)
      throw new AppError("VALIDATION", {
        fields: Object.fromEntries(bad.map((k) => [`notify.${k}`, "Bu bildirim kanalı şu an kullanılamıyor"])),
      });
  }
  const consent = await svc.d.db.consentText.findFirst({
    where: { id: input.consentTextId, tenantId, isCurrent: true },
    select: { id: true, sha256: true },
  });
  if (!consent) {
    throw new AppError("VALIDATION", {
      message: "Aydınlatma metni güncel değil.",
      fields: { consentTextId: "Aydınlatma metni güncellendi; pencereyi yeniden açıp tekrar onaylayın." },
    });
  }
  return { tc, hours, consent };
}

/**
 * P18 (AC-258, S-P18-T6): mesai — ref VE bindingKey yollarında, güvenilen CIDR dahil aynı sırada; tenant kovası tüketilmez
 * (sayım commit sonrası). Takvim bozuksa (T12) mesai uygulanmaz.
 */
async function checkHours(svc: RequestService, ctx: AuditContext, tenantId: string, input: CreateCoreInput) {
  const tc = await svc.calendars.get(tenantId);
  const hours = openState(tc, svc.d.clock.now(), () => svc.calendars.fallback(tenantId, "range_error"));
  // S-P19-13: eski istemci → QUEUE_FULL eşlemesi yalnız AGENT; WEB her zaman 409 OUTSIDE_HOURS.
  if (!hours.openNow && tc.cal.afterHoursMode === "REJECT")
    await rejectOutsideHours(
      svc,
      ctx,
      tenantId,
      tc,
      hours.next,
      input.source === "AGENT" && compareVersions(input.clientVersion, CHAT_MIN_CLIENT_VERSION) < 0,
    );
  return { tc, hours };
}

/**
 * P18 (AC-258, K-P18-7, S-P18-T6/T7): mesai dışı + REJECT → talep açılmaz. ≥ 0.12.0 → 409 `OUTSIDE_HOURS`
 * (`fields.nextOpeningAt`); eski istemci → 429 `QUEUE_FULL` aynı mesaj, `Retry-After` YOK; hız sınırı sayaç/alarmlarına
 * girmez (yalnız `rs_requests_outside_hours_total{mode,legacy}`). Audit tenant başına dakikada 1 satır (`count`).
 */
async function rejectOutsideHours(
  svc: RequestService,
  ctx: AuditContext,
  tenantId: string,
  tc: TenantCalendar,
  next: number | null,
  legacy: boolean,
) {
  svc.d.metrics.inc("rs_requests_outside_hours_total", { mode: "REJECT", legacy: String(legacy) });
  const now = svc.d.clock.now();
  const st = svc.outsideAudit.get(tenantId) ?? { at: Number.NEGATIVE_INFINITY, pending: 0 };
  st.pending++;
  if (now - st.at >= OUTSIDE_AUDIT_WINDOW_MS) {
    await writeAudit(svc.d.db, ctx, {
      tenantId,
      ...CUSTOMER,
      action: "request.created",
      entity: "support_requests",
      result: "fail",
      newValue: { reason: "outside_hours", count: st.pending, legacy },
    });
    st.at = now;
    st.pending = 0;
  }
  svc.outsideAudit.set(tenantId, st);
  const message = outsideHoursMessage(next, tc.cal.timeZone);
  if (legacy) throw new AppError("QUEUE_FULL", { message });
  throw new AppError("OUTSIDE_HOURS", { message, ...(next === null ? {} : { fields: { nextOpeningAt: new Date(next).toISOString() } }) });
}

/**
 * Tenant kovası (§13.6): kilitlenmez; 60/sa sonrası yalnız bilinmeyen kaynak reddi, bilinen tavanı 120/sa. Burada yalnız
 * okunur; sayım commit sonrası (AC-209: başarısız TX / 503 kovayı artırmaz).
 * P19 (S-P19-15): WEB yalnız kendi firma kovasını (60/sa) tüketir; AGENT kovalarına dokunmaz (ve tersi).
 */
async function checkTenantBucket(svc: RequestService, ctx: AuditContext, tenantId: string, web: boolean, privileged: boolean) {
  const { tenantAll, tenantKnown, tenantWebAll } = svc.d.limits;
  if (
    web
      ? tenantWebAll.count(tenantId) >= TENANT_WEB_PER_HOUR
      : (!privileged && tenantAll.count(tenantId) >= TENANT_UNKNOWN_PER_HOUR) ||
        (privileged && tenantKnown.count(tenantId) >= TENANT_KNOWN_PER_HOUR)
  ) {
    const until = (web ? tenantWebAll : tenantAll).windowEnds(tenantId);
    if (svc.alerted.get(tenantId) !== until) {
      svc.alerted.set(tenantId, until);
      svc.d.hub.publish(tenantId, { t: "queue.alert", kind: "rate_limited", until: new Date(until).toISOString() });
      svc.d.log.warn({ alarm: "request_tenant_rate", tenantId }, "tenant talep kovası aşıldı");
    }
    await svc.rateAudit(ctx, tenantId, web ? "tenant.web" : "tenant", "tenant", tenantId);
    throw rateLimited(RATE_BLOCK_SEC, REQUEST_BUSY_MESSAGE);
  }
}
