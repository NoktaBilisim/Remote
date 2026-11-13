// Destek talebi servisi (P8b-1; mimari-e9 §2.3, §3.4, §5.4, §13; mimari-api "Destek talepleri (P8b)"; ADR-0016).
// Durum makinesi tek koşullu UPDATE'lerle (count=1 kazanır); çoklu yazma tek TX + audit; bellek (hub/rooms/WhatsApp) commit SONRASI.
// Kişisel veri (ad/telefon/açıklama) audit'e ve loga yazılmaz (AC-160); talep sırrı yalnız 201 yanıtında döner.
import type { CancelReason, CreateRequestData, CreateRequestResponse, TenantRequestInfo } from "@remote/contracts/api/requests";
import { REQUEST_BUSY_MESSAGE, REQUEST_QUEUE_KNOWN_ONLY_FROM, REQUEST_QUEUE_MAX } from "@remote/contracts/api/requests";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Env } from "../env.ts";
import { REQUEST_TX_OPTIONS, type Db } from "../lib/db.ts";
import { AppError, DB_BUSY_MESSAGE, DB_BUSY_RETRY_SEC } from "../lib/errors.ts";
import { ConcurrencyGate, GateBusyError, type GateOptions } from "../lib/gate.ts";
import { newId, newRequestCode, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { cidrListMatcher, ipKey, isIPv6Key, netKey, prefixKey } from "../lib/ip.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { isOutdated } from "../lib/version.ts";
import type { WhatsappNotifier } from "../notify/whatsapp.ts";
import type { Metrics } from "../ops/metrics.ts";
import { abuseEmail, currentConsentText } from "../public/consent.ts";
import { outdated } from "../sessions/public.ts";
import type { Rooms } from "../signaling/rooms.ts";
import type { Clock, Timing } from "../signaling/types.ts";
import type { RequestHub, RequestStatePayload } from "./hub.ts";
import { blocked, hitBlocked, rateLimited, RATE_BLOCK_SEC, TENANT_KNOWN_PER_HOUR, TENANT_UNKNOWN_PER_HOUR, type RequestLimits } from "./limits.ts";
import { bindingInvalid, issueBinding, resolveUsable } from "../bindings/service.ts";
import * as brepo from "../bindings/repo.ts";
import * as crepo from "../customers/repo.ts";
import { parseFirmDownloadUri, requestDownloadLocation } from "./ref.ts";
import { effectiveLogoUrl } from "../uploads/urls.ts";
import * as repo from "./repo.ts";
import { maskEmail } from "../audit/mask.ts";
import type { MailService } from "../mail/service.ts";
import { newRequestMail } from "../mail/templates.ts";
import { HourCounter } from "./limits.ts";

const EMAIL_TENANT_PER_HOUR = 30;

export const CUSTOMER = { username: "customer" } as const;
export const SYSTEM = { username: "system" } as const;
export const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "requests", requestId: "" };
type CounterKey = { [K in keyof RequestLimits]: RequestLimits[K] extends FixedWindowCounter ? K : never }[keyof RequestLimits];
const PENDING_CODE_INDEX = "support_requests_pending_code_uq";
const CODE_ATTEMPTS = 5;
const PENDING_PER_IP = 3;
const PENDING_PER_NET = 10;
/**
 * S8b-5: talep oluşturma TX'i için süreç içi kapı. Havuz 10 bağlantı; talepler en çok 4'ünü tutar (panel/giriş/WS
 * için en az 6 kalır). Bekleyenler bağlantı tutmaz; kuyruk doluysa hemen, 5 sn bekleme aşılırsa 503 NOT_READY.
 */
export const REQUEST_GATE: GateOptions = { perKey: 2, global: 4, maxWaitingPerKey: 16, maxWaiting: 64, waitMs: 5_000 };

export interface RequestServiceDeps {
  db: Db;
  env: Env;
  log: FastifyBaseLogger;
  rooms: Rooms;
  hub: RequestHub;
  limits: RequestLimits;
  notifier: WhatsappNotifier;
  /** P10 (AC-151): e-posta bildirim kanalı (tenant SMTP). */
  mail: MailService;
  metrics: Metrics;
  clock: Clock;
  timing: Timing;
  /** Test için kapı ayarı (varsayılan `REQUEST_GATE`). */
  gate?: GateOptions;
}

interface PrismaLikeError {
  code?: unknown;
  meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } };
}
const isUniqueConflict = (err: unknown, index: string): boolean => {
  const e = err as PrismaLikeError | null;
  return typeof e === "object" && e !== null && e.code === "P2002" && e.meta?.driverAdapterError?.cause?.constraint?.index === index;
};

const tenantActive = (t: { status: string; deletedAt: Date | null }): boolean => t.status === "ACTIVE" && t.deletedAt === null;

/** Tek 404 gövdesi (AC-131, 132, 145): biçim dışı / yok / yenilenmiş / pasif / ayarı yok ayırt edilmez. */
const refInvalidError = (): AppError => new AppError("REQUEST_REF_INVALID");

export class RequestService {
  readonly d: RequestServiceDeps;
  private readonly connectTimers = new Map<string, unknown>();
  private readonly emailHour = new HourCounter();
  /** Tenant kovası uyarısı pencere başına bir kez (§13.6 `queue.alert`). */
  private readonly alerted = new Map<string, number>();
  private readonly gate: ConcurrencyGate;
  private gateLoggedAt = Number.NEGATIVE_INFINITY;

  constructor(d: RequestServiceDeps) {
    this.d = d;
    this.gate = new ConcurrencyGate(d.gate ?? REQUEST_GATE);
    d.rooms.requestHooks = {
      admitted: (requestId) => this.clearConnectTimer(requestId),
      failed: (requestId) => void this.connectTimeout(requestId, "auth_revoked").catch((err: unknown) => this.logErr(err, "request_auth_revoked")),
    };
    // P8c (ADR-0017): admit edilmiş AGENT misafirin `binding.request`'i → verme TX'i (müşteri istemciden değil oturumdan).
    d.rooms.bindingIssuer = (room, guest, previousKey) =>
      issueBinding(this, guest.ctx ?? { ...SYSTEM_CTX, userAgent: "signaling" }, { sessionId: room.sessionId, clientVersion: guest.clientVersion ?? "0.0.0", previousKey });
  }

  /** P8c `rs_customers_active` (gauge, açılış + günlük iş + durum değişimi). */
  customersActive = 0;
  refreshCustomersGauge(): void {
    void this.d.db.customer
      .count({ where: { status: "ACTIVE" } })
      .then((n) => {
        this.customersActive = n;
      })
      .catch((err: unknown) => this.logErr(err, "customers_gauge"));
  }

  /** Kapı doluluğu (salt okunur; metrik/test gözlemi — QA-P8b-14). */
  get gateLoad(): { running: number; waiting: number } {
    return { running: this.gate.running, waiting: this.gate.waiting };
  }

  logErr(err: unknown, event: string): void {
    this.d.log.error({ err, event }, "talep işlemi hatası");
  }

  // ------------------------------------------------------------------ yardımcılar

  /** Talep TX'i kapısı (S8b-5): dolulukta 503 NOT_READY + Retry-After, metrik + alarm logu (PII yok). */
  private async gated<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.gate.run(tenantId, fn);
    } catch (err) {
      if (!(err instanceof GateBusyError)) throw err;
      this.d.metrics.inc("rs_request_gate_rejected_total", { reason: err.reason });
      const t = this.d.clock.now();
      if (t - this.gateLoggedAt >= 10_000) {
        this.gateLoggedAt = t; // log seli olmasın: 10 sn'de en çok 1
        this.d.log.warn({ alarm: "request_gate_busy", reason: err.reason, tenantId }, "talep kapısı dolu");
      }
      throw new AppError("NOT_READY", { message: DB_BUSY_MESSAGE, retryAfterSec: DB_BUSY_RETRY_SEC });
    }
  }

  /** `req.ref_invalid` (ipKey 10/dk, 15 dk blok) — tüm ref'li uçlarda ortak; kilitliyse 429. */
  assertRefNotBlocked(ip: string): void {
    const wait = blocked(this.d.limits.refInvalid, ip);
    if (wait > 0) throw rateLimited(wait);
  }

  /** Geçersiz ref sayımı + alarm metriği; kilit bu olayla başladıysa 429, değilse tek 404. */
  refInvalid(ip: string): AppError {
    this.d.metrics.inc("rs_request_ref_invalid_total");
    const wait = hitBlocked(this.d.limits.refInvalid, ip);
    return wait > 0 ? rateLimited(wait) : refInvalidError();
  }

  /**
   * Ref → aktif tenant'ın ayarı + (müşteri ref'iyse) aktif müşteri; değilse null (AC-131, 168, 191). Genel ve müşteri
   * sorguları PARALEL (mimari-e10 §5.2): biri boş döner, süre farkı yok. Yanıt şekli iki türde aynıdır.
   */
  async resolveRef(ref: unknown): Promise<{ s: repo.SettingsRow; customer: { id: string; name: string; fileLabel: string } | null } | null> {
    if (typeof ref !== "string" || !/^[a-z2-7]{16}$/.test(ref)) return null;
    const [general, c] = await Promise.all([repo.settingsByRef(this.d.db, ref), repo.customerByRef(this.d.db, ref)]);
    if (general) return tenantActive(general.tenant) ? { s: general, customer: null } : null;
    const s = c?.tenant.requestSettings;
    if (!c || c.status !== "ACTIVE" || !s || !tenantActive(s.tenant)) return null;
    return { s, customer: { id: c.id, name: c.name, fileLabel: c.fileLabel } };
  }

  /** Public bilgi gövdesi (`TenantRequestInfo`; P8c `bindings/status` aynı şekli genişletir). */
  async requestInfo(tenantId: string, tenant: { name: string; logoPath: string | null }, waitMinutes: number): Promise<TenantRequestInfo> {
    const [consentText, abuse, logoUrl] = await Promise.all([
      currentConsentText(this.d.db, tenantId),
      abuseEmail(this.d.db, { fromEnv: this.d.env.ABUSE_EMAIL, superAdminFallback: this.d.env.NODE_ENV !== "production" }),
      effectiveLogoUrl(this.d.db, tenant.logoPath), // P12 (AC-81)
    ]);
    return { tenant: { name: tenant.name, logoUrl }, consentText, waitMinutes, abuseEmail: abuse, minAgentVersion: this.d.env.MIN_AGENT_VERSION ?? null };
  }

  /** Aşım audit'i `request.rate_limited{bucket, keyType}` kaynak başına dakikada en çok 1 (AC-144) + metrik. */
  async rateAudit(ctx: AuditContext, tenantId: string | null, bucket: string, keyType: string, key: string): Promise<void> {
    this.d.metrics.inc("rs_request_rate_limited_total", { bucket });
    const k = `${bucket}|${key}`;
    if (this.d.limits.rateAudit.blockedFor(k) > 0 || this.d.limits.rateAudit.hit(k)) return;
    await writeAudit(this.d.db, ctx, { tenantId, ...CUSTOMER, action: "request.rate_limited", entity: "support_requests", result: "fail", newValue: { bucket, keyType } });
  }

  async limit(ctx: AuditContext, tenantId: string | null, counter: CounterKey, bucket: string, keyType: string, key: string): Promise<void> {
    const wait = hitBlocked(this.d.limits[counter], key);
    if (wait === 0) return;
    await this.rateAudit(ctx, tenantId, bucket, keyType, key);
    throw rateLimited(wait);
  }

  async publishCount(tenantId: string): Promise<void> {
    this.d.hub.publish(tenantId, { t: "queue.count", pending: await repo.countPending(this.d.db, tenantId) });
  }

  /** Kapanış sonrası ortak bellek adımları (commit sonrası). P8c tek kayıt iptali de kullanır. */
  async closedAfterCommit(tenantId: string, requestId: string, status: "CANCELLED" | "EXPIRED" | "REJECTED", extra: { reason?: CancelReason; message?: string } = {}): Promise<void> {
    this.d.hub.closeRequest(requestId, { t: "request.closed", status, ...extra });
    this.d.hub.publish(tenantId, { t: "request.removed", id: requestId, status });
    this.d.hub.queueChanged(tenantId);
    await this.publishCount(tenantId);
  }

  /** `/ws/request` sıra durumları (AC-139): tenant'ın bekleyenleri, yalnız kendi talebine ait alanlar. */
  async statesOf(tenantId: string): Promise<Map<string, RequestStatePayload>> {
    const q = await repo.pendingQueue(this.d.db, tenantId);
    return new Map(
      q.map((r, i) => [r.id, { status: "PENDING" as const, requestCode: r.requestCode, position: i + 1, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }]),
    );
  }

  // ------------------------------------------------------------------ public

  /** GET /public/requests/tenant?ref= (AC-133, 145). */
  async tenantInfo(ctx: AuditContext, ref: unknown): Promise<TenantRequestInfo> {
    const ip = ipKey(ctx.ip);
    this.assertRefNotBlocked(ip);
    const r = await this.resolveRef(ref);
    if (!r) throw this.refInvalid(ip);
    await this.limit(ctx, r.s.tenantId, "info", "req.info", "ip", ip);
    return this.requestInfo(r.s.tenantId, r.s.tenant, r.s.waitMinutes); // şekil müşteri ref'inde de aynı (AC-168)
  }

  /**
   * POST /public/requests (G-E9-10 sırası): Origin (route) → ipKey/önek/net48 kovaları (güvenilen CIDR muaf) → zod →
   * sürüm → ref → bilinen kaynak → tenant kovası → TX [kilit → bekleyen sayımları → kod → INSERT → audit] → hub/WhatsApp.
   */
  async create(ctx: AuditContext, body: unknown, parse: (b: unknown) => CreateRequestData): Promise<CreateRequestResponse> {
    const ip = ipKey(ctx.ip);
    const prefix = prefixKey(ctx.ip);
    const net = netKey(ctx.ip);
    this.assertRefNotBlocked(ip);
    // P8c: `ref` (Genel/müşteri) ya da `bindingKey` (kayıt). Çözümleme kovalardan önce yalnız güvenilen CIDR için bakılır.
    const peekObj = typeof body === "object" && body !== null ? (body as { ref?: unknown; bindingKey?: unknown }) : {};
    const peekedRef = peekObj.bindingKey === undefined ? await this.resolveRef(peekObj.ref) : null;
    const peekedBinding = peekObj.bindingKey !== undefined ? await resolveUsable(this, peekObj.bindingKey) : null;
    const bs = peekedBinding ? await repo.settingsByTenant(this.d.db, peekedBinding.row.tenantId) : null;
    const peeked = peekedRef?.s ?? (bs && tenantActive(bs.tenant) ? bs : null);
    const trusted = peeked ? cidrListMatcher(repo.jsonStrings(peeked.trustedCidrs))(ctx.ip) : false;
    if (!trusted) {
      const tid = peeked?.tenantId ?? null;
      await this.limit(ctx, tid, "createIp", "req.create.ip", "ip", ip);
      await this.limit(ctx, tid, "createPrefix", "req.create.prefix", "prefix", prefix);
      if (isIPv6Key(net)) await this.limit(ctx, tid, "createNet48", "req.create.net48", "net48", net);
    }
    // B-P8c-5 (§5.2): biçim dışı / yok / geçersiz anahtar aynı 404 BINDING_INVALID + `req.ref_invalid` kovası (400 değil).
    if (peekObj.bindingKey !== undefined && !peekedBinding) throw bindingInvalid(this, ip);
    const input = parse(body);
    if (isOutdated(input.clientVersion, this.d.env.MIN_AGENT_VERSION)) throw outdated(this.d.env.MIN_AGENT_VERSION);
    let s: repo.SettingsRow | null = null;
    let customerId: string | null = null;
    let binding: { id: string; keyHash: string } | null = null;
    if (input.bindingKey !== undefined) {
      if (!peekedBinding || !peeked || peekedBinding.keyHash !== sha256Hex(input.bindingKey)) throw bindingInvalid(this, ip);
      s = peeked;
      customerId = peekedBinding.row.customerId;
      binding = { id: peekedBinding.row.id, keyHash: peekedBinding.keyHash };
      // §5.3: kayıt başına 6/sa (E9 ip/önek/net48 ve tenant kovalarına EK — K20, muaf değil).
      await this.limit(ctx, s.tenantId, "createBinding", "req.create.binding", "binding", binding.id);
    } else {
      if (!peekedRef) throw this.refInvalid(ip); // peek aynı gövdenin ref'iyle yapıldı
      s = peekedRef.s;
      customerId = peekedRef.customer?.id ?? null;
    }
    const tenantId = s.tenantId;
    const via = binding ? "binding" : "ref";

    const consent = await this.d.db.consentText.findFirst({ where: { id: input.consentTextId, tenantId, isCurrent: true }, select: { id: true, sha256: true } });
    if (!consent) {
      throw new AppError("VALIDATION", { message: "Aydınlatma metni güncel değil.", fields: { consentTextId: "Aydınlatma metni güncellendi; pencereyi yeniden açıp tekrar onaylayın." } });
    }

    const now = new Date(this.d.clock.now());
    const networkMatch = trusted ? "TRUSTED" : await repo.networkSeen(this.d.db, tenantId, ip, net, now);
    const deviceHash = input.deviceKey ? sha256Hex(`${tenantId}${input.deviceKey}`) : null;
    const knownDevice = deviceHash ? await repo.deviceSeen(this.d.db, tenantId, deviceHash, now) : false;
    // G-E9-15: ayrıcalık yalnız TRUSTED veya known_device; P8c K20: etkin kayıt da "bilinen" (yalnız kuyruk ≥ 40 eşiği ve
    // bilinen tavanı 120/sa için — ip/önek/net48/tenant kovalarından muaf DEĞİL).
    const privileged = trusted || knownDevice || binding !== null;

    // S8b-5: kova + TX süreç içi kapıdan geçer (tenant başına 2, toplam 4); bekleyen bağlantı tutmaz. Kapı doluysa 503
    // NOT_READY + Retry-After ve tenant kovası tüketilmez (kova sayımı kapının içinde).
    const secret = newSecretToken();
    const id = newId();
    const expiresAt = new Date(now.getTime() + s.waitMinutes * 60_000);
    const created = await this.gated(tenantId, async () => {
      // Tenant kovası (§13.6): kilitlenmez; 60/sa sonrası yalnız bilinmeyen kaynak reddi, bilinen tavanı 120/sa.
      const { tenantAll, tenantKnown } = this.d.limits;
      if ((!privileged && tenantAll.count(tenantId) >= TENANT_UNKNOWN_PER_HOUR) || (privileged && tenantKnown.count(tenantId) >= TENANT_KNOWN_PER_HOUR)) {
        const until = tenantAll.windowEnds(tenantId);
        if (this.alerted.get(tenantId) !== until) {
          this.alerted.set(tenantId, until);
          this.d.hub.publish(tenantId, { t: "queue.alert", kind: "rate_limited", until: new Date(until).toISOString() });
          this.d.log.warn({ alarm: "request_tenant_rate", tenantId }, "tenant talep kovası aşıldı");
        }
        await this.rateAudit(ctx, tenantId, "tenant", "tenant", tenantId);
        throw rateLimited(RATE_BLOCK_SEC, REQUEST_BUSY_MESSAGE);
      }
      tenantAll.add(tenantId);
      if (privileged) tenantKnown.add(tenantId);

      let created: { code: string; position: number } | undefined;
      // Hangi bekleyen sınırı aştı (audit kovası/anahtar türü ayrımı): IP başına 3 ya da önek (net_key) başına 10.
      let pendingHit: { bucket: string; keyType: "ip" | "prefix" | "tenant"; key: string } | undefined;
      for (let attempt = 1; !created; attempt++) {
        try {
          created = await this.d.db.$transaction(async (tx) => {
            await repo.lockSettings(tx, tenantId); // ilk ifade (G-E9-10)
            // B-P8c-1: müşteri TX içinde FOR SHARE ile yeniden doğrulanır; peek ile INSERT arasında pasife alma commit
            // olduysa talep yazılmaz (tek 404). Pasife alma bu TX'i beklerse bekleyeni kendi TX'inde iptal eder.
            if (customerId && (await crepo.shareStatus(tx, tenantId, customerId)) !== "ACTIVE") throw binding ? bindingInvalid(this, ip) : this.refInvalid(ip);
            if (binding) {
              // §3.4 Kullanım: koşullu UPDATE (count 0 → BINDING_INVALID, ROLLBACK); kayıt başına 1 bekleyen.
              if ((await brepo.touchForRequest(tx, binding.id, binding.keyHash, now)) === 0) throw new AppError("BINDING_INVALID");
              if ((await brepo.countPendingOfBinding(tx, tenantId, binding.id)) >= 1) throw new AppError("REQUEST_PENDING");
            }
            const c = await repo.pendingSnapshot(tx, tenantId, { clientInstance: input.clientInstanceId, ipKey: ip, netKey: net });
            if (c.instance >= 1) throw new AppError("REQUEST_PENDING");
            if (!trusted && c.ip >= PENDING_PER_IP) {
              pendingHit = { bucket: "pending.ip", keyType: "ip", key: ip };
              throw new AppError("RATE_LIMITED", { message: REQUEST_BUSY_MESSAGE, retryAfterSec: 60 });
            }
            if (!trusted && c.net >= PENDING_PER_NET) {
              pendingHit = { bucket: "pending.prefix", keyType: "prefix", key: net };
              throw new AppError("RATE_LIMITED", { message: REQUEST_BUSY_MESSAGE, retryAfterSec: 60 });
            }
            if (c.tenant >= REQUEST_QUEUE_MAX || (c.tenant >= REQUEST_QUEUE_KNOWN_ONLY_FROM && !privileged)) {
              pendingHit = { bucket: "pending.tenant", keyType: "tenant", key: tenantId };
              throw new AppError("QUEUE_FULL");
            }
            const taken = c.codes;
            let code = newRequestCode();
            while (taken.has(code)) code = newRequestCode();
            await repo.insertRequest(tx, {
              id,
              tenantId,
              status: "PENDING",
              requestCode: code,
              secretHash: sha256Hex(secret),
              clientInstance: input.clientInstanceId,
              clientVersion: input.clientVersion,
              customerName: input.customerName,
              customerPhone: input.phone,
              customerEmail: input.email ?? null,
              description: input.description,
              consentTextId: consent.id,
              consentSha256: consent.sha256,
              consentedAt: now,
              ip: ctx.ip.slice(0, 45),
              ipKey: ip,
              netKey: net,
              deviceHash,
              networkMatch,
              knownDevice,
              expiresAt,
              createdAt: now,
              customerId,
              bindingId: binding?.id ?? null,
            });
            // S8b-3: IP yalnız audit `ip_address` sütununda. P8c §5.7: via + customerId (ref/anahtar değeri asla).
            await writeAudit(tx, ctx, { tenantId, ...CUSTOMER, action: "request.created", entity: "support_requests", entityId: id, result: "success", newValue: { clientVersion: input.clientVersion, via, customerId } });
            return { code, position: c.tenant + 1 };
          }, REQUEST_TX_OPTIONS);
        } catch (err) {
          if (attempt < CODE_ATTEMPTS && isUniqueConflict(err, PENDING_CODE_INDEX)) continue;
          if (err instanceof AppError && pendingHit) await this.rateAudit(ctx, tenantId, pendingHit.bucket, pendingHit.keyType, pendingHit.key);
          throw err;
        }
      }
      return created;
    });

    // commit sonrası
    this.d.metrics.inc("rs_requests_created_total", { via });
    const firm = customerId ? await this.d.db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } }) : null;
    this.d.hub.publish(tenantId, {
      t: "request.new",
      id,
      requestCode: created.code,
      customerName: input.customerName,
      preview: [...input.description].slice(0, 100).join(""),
      networkMatch,
      knownDevice,
      createdAt: now.toISOString(),
      customerFirm: firm,
      viaBinding: binding !== null,
      bindingRevoked: false,
      staleSource: false,
    });
    this.d.hub.queueChanged(tenantId);
    await this.publishCount(tenantId);
    // İstemci /ws/request'e hiç bağlanmazsa 120 sn sonra DISCONNECTED (AC-141); bağlanınca iptal edilir.
    this.d.hub.setDisconnect(id, () => void this.cancelSystem(id, "DISCONNECTED").catch((e: unknown) => this.logErr(e, "request_disconnect")), this.d.timing.requestDisconnectMs);
    if (s.waEnabled) this.d.notifier.notifyNewRequest(tenantId, s.tenant.name, repo.jsonStrings(s.waRecipients), created.code);
    if (s.emailEnabled) this.notifyEmail(tenantId, s.tenant.name, repo.jsonStrings(s.emailRecipients), created.code);
    return { requestId: id, requestSecret: secret, requestCode: created.code, expiresAt: expiresAt.toISOString(), position: created.position };
  }

  /**
   * AC-151: e-posta kanalı — WhatsApp ile aynı kişisel verisiz içerik, alıcı başına ayrı ileti, beklenmez (10 sn zaman
   * aşımı + 1 yeniden deneme mail/service.ts'de; ≤ 60 sn). Tenant saatlik 30 ileti sınırı (WhatsApp tenant sınırıyla aynı);
   * aşım bastırılır + metrik. Sonuç alıcı başına audit `mail.sent` + `request.notify{channel:"email"}`.
   */
  private notifyEmail(tenantId: string, firm: string, recipients: readonly string[], requestCode: string): void {
    const content = newRequestMail({ publicBaseUrl: this.d.env.PUBLIC_BASE_URL, firm, requestCode });
    const ctx = { ip: "", userAgent: "notify", requestId: "" };
    void (async () => {
      const cfg = await this.d.mail.configFor(tenantId);
      if (!cfg) return;
      for (const to of recipients) {
        if (this.emailHour.add(tenantId) > EMAIL_TENANT_PER_HOUR) {
          this.d.metrics.inc("rs_request_notify_total", { channel: "email", result: "suppressed" });
          continue;
        }
        const out = await this.d.mail.sendForTenant(ctx, { tenantId, kind: "request_notify", entity: "support_requests" }, to, content, cfg);
        this.d.metrics.inc("rs_request_notify_total", { channel: "email", result: out.ok ? "ok" : "failed" });
        await writeAudit(this.d.db, ctx, { tenantId, username: "system", action: "request.notify", entity: "support_requests", result: out.ok ? "success" : "fail", newValue: { channel: "email", recipient: maskEmail(to), result: out.ok ? "success" : "fail", attempts: 1 } });
      }
    })().catch((e: unknown) => this.logErr(e, "request_notify_email"));
  }

  /** POST /public/requests/cancel (AC-141): her durumda 204 — sır oracle'ı yok. */
  async cancelBySecret(ctx: AuditContext, secret: string): Promise<void> {
    await this.limit(ctx, null, "cancel", "req.cancel", "ip", ipKey(ctx.ip));
    const row = await repo.findBySecretHash(this.d.db, sha256Hex(secret));
    if (row) await this.customerCancel(ctx, row);
  }

  /**
   * Müşteri iptali (`request.cancel` / `request.decline` / close 1000 / REST): PENDING → CANCELLED(CUSTOMER);
   * ACCEPTED + oturum PENDING → decline (§13.3): oturum CANCELLED(customer_declined) + talep CANCELLED(CUSTOMER), tek TX.
   * Oturum ACTIVE olmuşsa yok sayılır.
   */
  async customerCancel(ctx: AuditContext, row: repo.SecretRow): Promise<void> {
    const now = new Date(this.d.clock.now());
    if (row.status === "PENDING") {
      const ok = await this.d.db.$transaction(async (tx) => {
        if ((await repo.cancelPending(tx, row.id, "CUSTOMER", now)) === 0) return false;
        await writeAudit(tx, ctx, { tenantId: row.tenantId, ...CUSTOMER, action: "request.cancelled", entity: "support_requests", entityId: row.id, result: "success", oldValue: { status: "PENDING" }, newValue: { status: "CANCELLED", reason: "CUSTOMER" } });
        return true;
      });
      if (ok) await this.closedAfterCommit(row.tenantId, row.id, "CANCELLED", { reason: "CUSTOMER" });
      else await this.resendFinal(row.id);
      return;
    }
    if (row.status !== "ACCEPTED" || row.session?.status !== "PENDING") return;
    const sessionId = row.session.id;
    const ok = await this.d.db.$transaction(async (tx) => {
      if ((await repo.cancelRequestSession(tx, row.id, now, "CUSTOMER", "customer_declined")) === 0) return false;
      if ((await repo.cancelAccepted(tx, row.id)) === 0) throw new Error("request_decline_state");
      await writeAudit(tx, ctx, { tenantId: row.tenantId, ...CUSTOMER, action: "request.cancelled", entity: "support_requests", entityId: row.id, result: "success", oldValue: { status: "ACCEPTED" }, newValue: { status: "CANCELLED", reason: "CUSTOMER", phase: "accepted", sessionId } });
      return true;
    });
    if (!ok) return;
    this.clearConnectTimer(row.id);
    this.d.rooms.closeSession(sessionId, "cancelled");
    if (row.acceptedBy) this.d.hub.sendToUser(row.tenantId, row.acceptedBy, { t: "request.declined", id: row.id, sessionId });
    this.d.hub.closeRequest(row.id, { t: "request.closed", status: "CANCELLED", reason: "CUSTOMER" });
  }

  /** Yarışta kaybeden müşteri isteği: güncel son durumu bildir (ör. süre doldu). */
  private async resendFinal(requestId: string): Promise<void> {
    const r = await repo.findById(this.d.db, requestId);
    if (r && (r.status === "EXPIRED" || r.status === "CANCELLED")) this.d.hub.closeRequest(requestId, { t: "request.closed", status: r.status });
  }

  /** Sistem iptali: DISCONNECTED (120 sn kopma) / TENANT_PASSIVE (AC-141, 145). */
  async cancelSystem(requestId: string, reason: repo.SystemCancelReason): Promise<boolean> {
    const now = new Date(this.d.clock.now());
    const row = await this.d.db.$transaction(async (tx) => {
      const r = await repo.findById(tx, requestId);
      if (!r || (await repo.cancelPending(tx, requestId, reason, now)) === 0) return null;
      await writeAudit(tx, SYSTEM_CTX, { tenantId: r.tenantId, ...SYSTEM, action: "request.cancelled", entity: "support_requests", entityId: requestId, result: "success", oldValue: { status: "PENDING" }, newValue: { status: "CANCELLED", reason } });
      return r;
    });
    if (!row) return false;
    await this.closedAfterCommit(row.tenantId, requestId, "CANCELLED", { reason });
    return true;
  }

  /** P9 tenant pasife alma servisi çağırır (AC-145); süpürücü yedek yol. */
  async cancelAllForTenant(tenantId: string): Promise<number> {
    let n = 0;
    for (const r of await repo.findPendingOfTenant(this.d.db, tenantId)) if (await this.cancelSystem(r.id, "TENANT_PASSIVE")) n++;
    return n;
  }

  /** GET /public/agent/request-download?ref= (AC-130, 132): 302 konumu; ref loga/audit'e yazılmaz. */
  async download(ctx: AuditContext, ref: unknown, assertReady: () => Promise<void>): Promise<string> {
    const ip = ipKey(ctx.ip);
    this.assertRefNotBlocked(ip);
    await this.limit(ctx, null, "download", "req.download", "ip", ip);
    const r = await this.resolveRef(ref);
    if (!r) throw this.refInvalid(ip);
    await assertReady();
    // AC-168: dosya adı sahibin etiketi + ref (G-E10-8 şerhi: yalnız ref'i bilen görür).
    return r.customer ? requestDownloadLocation(r.customer.fileLabel, ref as string) : requestDownloadLocation(r.s.fileLabel, r.s.requestRef);
  }

  /** forward_auth firma yolu (G-E9-11): ref aktif ve label güncel file_label → true; aksi false (tek 404). */
  async firmPathValid(uri: string): Promise<boolean> {
    const p = parseFirmDownloadUri(uri);
    if (!p) return false;
    const r = await this.resolveRef(p.ref);
    if (!r) return false;
    return (r.customer ? r.customer.fileLabel : r.s.fileLabel) === p.label;
  }

  // ------------------------------------------------------------------ bağlanma penceresi (AC-155)

  startConnectTimer(requestId: string): void {
    this.clearConnectTimer(requestId);
    this.connectTimers.set(
      requestId,
      this.d.clock.setTimeout(() => {
        this.connectTimers.delete(requestId);
        void this.connectTimeout(requestId, "connect_timeout").catch((err: unknown) => this.logErr(err, "request_connect_timeout"));
      }, this.d.timing.requestConnectMs),
    );
  }

  clearConnectTimer(requestId: string): void {
    const t = this.connectTimers.get(requestId);
    if (t === undefined) return;
    this.d.clock.clearTimeout(t);
    this.connectTimers.delete(requestId);
  }

  /**
   * ACCEPTED → CONNECT_FAILED + oturum PENDING → CANCELLED(`connect_timeout`|`auth_revoked`), tek TX. Oturum admit
   * edilmişse (consumed) hiçbir şey yapılmaz. Kabul edene `request.connect_failed`, müşteriye `request.closed`.
   */
  async connectTimeout(requestId: string, endReason: "connect_timeout" | "auth_revoked"): Promise<boolean> {
    this.clearConnectTimer(requestId);
    const now = new Date(this.d.clock.now());
    const res = await this.d.db.$transaction(async (tx) => {
      const r = await repo.findById(tx, requestId);
      if (!r || r.status !== "ACCEPTED") return null;
      const sess = await tx.supportSession.findFirst({ where: { requestId }, select: { id: true, status: true, consumedAt: true } });
      if (!sess || sess.consumedAt) return null;
      if (sess.status === "PENDING") await repo.cancelRequestSession(tx, requestId, now, "SYSTEM", endReason);
      if ((await repo.connectFailed(tx, requestId)) === 0) return null;
      await writeAudit(tx, SYSTEM_CTX, { tenantId: r.tenantId, ...SYSTEM, action: "request.connect_failed", entity: "support_requests", entityId: requestId, result: "success", oldValue: { status: "ACCEPTED" }, newValue: { status: "CONNECT_FAILED", sessionId: sess.id, reason: endReason } });
      return { r, sessionId: sess.id };
    });
    if (!res) return false;
    this.d.rooms.closeSession(res.sessionId, endReason === "auth_revoked" ? "cancelled" : "timeout");
    if (res.r.acceptedBy) this.d.hub.sendToUser(res.r.tenantId, res.r.acceptedBy, { t: "request.connect_failed", id: requestId, sessionId: res.sessionId });
    this.d.hub.closeRequest(requestId, { t: "request.closed", status: "CONNECT_FAILED" });
    return true;
  }

  shutdown(): void {
    for (const t of this.connectTimers.values()) this.d.clock.clearTimeout(t);
    this.connectTimers.clear();
  }
}
