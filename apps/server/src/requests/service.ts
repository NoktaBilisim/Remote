// Destek talebi servisi (P8b-1; mimari-e9 §2.3, §3.4, §5.4, §13; mimari-api "Destek talepleri (P8b)"; ADR-0016).
// Durum makinesi tek koşullu UPDATE'lerle (count=1 kazanır); çoklu yazma tek TX + audit; bellek (hub/rooms/WhatsApp) commit SONRASI.
// Kişisel veri (ad/telefon/açıklama) audit'e ve loga yazılmaz (AC-160); talep sırrı yalnız 201 yanıtında döner.
import type {
  CancelReason,
  CreateRequestData,
  CreateRequestResponse,
  NotifyChoice,
  RequestClientOs,
  RequestSource,
  TenantRequestInfo,
  WebFormInfo,
} from "@remote/contracts/api/requests";
import { slaBreachedAt } from "@remote/contracts/api/requests";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Env } from "../env.ts";
import type { Db } from "../lib/db.ts";
import { AppError, DB_BUSY_MESSAGE, DB_BUSY_RETRY_SEC } from "../lib/errors.ts";
import { FormTokens } from "./form-token.ts";
import { ConcurrencyGate, GateBusyError, type GateOptions } from "../lib/gate.ts";
import { sha256Hex } from "../lib/ids.ts";
import { ipKey, isIPv6Key } from "../lib/ip.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { UNDECLARED_AGENT_VERSION } from "../lib/version.ts";
import type { WhatsappNotifier } from "../notify/whatsapp.ts";
import type { SmsClient } from "../notify/sms.ts";
import type { NotifyOutbox } from "../notify/outbox.ts";
import type { Metrics } from "../ops/metrics.ts";
import { abuseEmail, chatRetentionDaysOf, currentConsentText } from "../public/consent.ts";
import type { Rooms } from "../signaling/rooms.ts";
import type { Clock, Timing } from "../signaling/types.ts";
import type { RequestHub, RequestStatePayload } from "./hub.ts";
import { blocked, hitBlocked, rateLimited, type RequestLimits } from "./limits.ts";
import { issueBinding } from "../bindings/service.ts";
import { osFromUserAgent } from "../lib/agent-os.ts";
import { parseFirmDownloadUri, requestDownloadLocation, type FirmFileExt } from "./ref.ts";
import { effectiveLogoUrl } from "../uploads/urls.ts";
import * as repo from "./repo.ts";
import { RequestBlockCache } from "./blocks.ts";
import type { MailService } from "../mail/service.ts";
import { HourCounter } from "./limits.ts";
import { CalendarCache, publicBusinessHours } from "./hours.ts";
import type { SecretBox } from "../lib/crypto.ts";
import { RequestMessages } from "./messages.ts";
import { admitCreate, peekCreate } from "./create-steps.ts";
import type { PortalCreateOptions } from "./create-tx.ts";
import { afterCreate } from "./create-after.ts";
import { webFormCoreInput, webFormInfoOf } from "./web-form.ts";
import { cancelSystemOf, connectTimeoutOf, customerCancelOf } from "./cancel.ts";

export const CUSTOMER = { username: "customer" } as const;
export const SYSTEM = { username: "system" } as const;
export const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "requests", requestId: "" };
type CounterKey = { [K in keyof RequestLimits]: RequestLimits[K] extends FixedWindowCounter ? K : never }[keyof RequestLimits];
/**
 * S8b-5: talep oluşturma TX'i için süreç içi kapı. Havuz 10 bağlantı; talepler en çok 4'ünü tutar (panel/giriş/WS
 * için en az 6 kalır). Bekleyenler bağlantı tutmaz; kuyruk doluysa hemen, 5 sn bekleme aşılırsa 503 NOT_READY.
 */
export const REQUEST_GATE: GateOptions = { perKey: 2, global: 4, maxWaitingPerKey: 16, maxWaiting: 64, waitMs: 5_000 };

interface RequestServiceDeps {
  db: Db;
  env: Env;
  log: FastifyBaseLogger;
  rooms: Rooms;
  hub: RequestHub;
  limits: RequestLimits;
  notifier: WhatsappNotifier;
  /** P10 (AC-151): e-posta bildirim kanalı (tenant SMTP). */
  mail: MailService;
  /** P19 J3: SMS kanalı kullanılabilirliği ve müşteri durum bildirimi kuyruğu (kabul/ret/süre dolumu TX'inde). */
  sms: SmsClient;
  outbox: NotifyOutbox;
  metrics: Metrics;
  clock: Clock;
  timing: Timing;
  /** P18 H3: talep mesajı gövdesi alan şifrelemesi (mevcut anahtar halkası). */
  secrets: SecretBox;
  /** Test için kapı ayarı (varsayılan `REQUEST_GATE`). */
  gate?: GateOptions;
}

export const tenantActive = (t: { status: string; deletedAt: Date | null }): boolean => t.status === "ACTIVE" && t.deletedAt === null;

export interface ChannelAvailability {
  smtp: boolean;
  sms: boolean;
}

const NO_NOTIFY: NotifyChoice = { sms: false, whatsapp: false, email: false };

/**
 * Ortak oluşturma çekirdeğinin girdisi (P19 §8c.2): AGENT (`createRequestInputSchema`) ve WEB (`webRequestInputSchema`)
 * aynı TX'e girer. Sürüm yalnız AGENT dalında vardır (S-P19-13: WEB'de `null`; `?? "0.0.0"` yasak).
 */
export type CreateCoreInput = Omit<CreateRequestData, "clientVersion" | "clientOs"> & { notify: NotifyChoice } &
  // P31 (AC-511): `clientOs` yalnız AGENT dalında; WEB'de tipte yok (DB CHECK source_client_os_chk: WEB ⇒ NULL, aksi 3819).
  ({ source: "AGENT"; clientVersion: string; clientOs?: RequestClientOs } | { source: "WEB"; clientVersion: null; clientOs?: never });

/** P31 (AC-509): firma indirmesinde platform kapıları — `assertReady` seçilen platformun 503'ü, `macosOk` örtük seçim için. */
export interface DownloadGates {
  assertReady: (os: RequestClientOs) => Promise<void>;
  macosOk: () => Promise<boolean>;
}

const agentInput = (d: CreateRequestData): CreateCoreInput => ({ ...d, source: "AGENT", notify: NO_NOTIFY });

/** Tek 404 gövdesi (AC-131, 132, 145): biçim dışı / yok / yenilenmiş / pasif / ayarı yok ayırt edilmez. */
const refInvalidError = (): AppError => new AppError("REQUEST_REF_INVALID");

export class RequestService {
  readonly d: RequestServiceDeps;
  private readonly connectTimers = new Map<string, unknown>();
  /** create-after.ts e-posta bildirimi tenant saatlik sayacı. */
  readonly emailHour = new HourCounter();
  /** Tenant kovası uyarısı pencere başına bir kez (§13.6 `queue.alert`; create-steps.ts). */
  readonly alerted = new Map<string, number>();
  private readonly gate: ConcurrencyGate;
  private gateLoggedAt = Number.NEGATIVE_INFINITY;
  /** P15 (AC-235): talep engelleri kapı önbelleği (tenant başına; yazmada geçersiz kılınır). */
  readonly blocks: RequestBlockCache;
  /** P18 (AC-258): mesai takvimi önbelleği (tenant başına 60 sn; ayar/tatil yazımında geçersiz kılınır). */
  readonly calendars: CalendarCache;
  /** S-P18-T7: tenant → {son audit anı, o andan beri bastırılan deneme sayısı} (create-steps.ts). */
  readonly outsideAudit = new Map<string, { at: number; pending: number }>();
  /** P18 H3 (AC-255): kabul öncesi mesajlaşma. */
  readonly messages: RequestMessages;
  /** P19 (S-P19-1, T4): web formu bot kapısı (bootId'li HMAC + kullanılmış nonce kümesi). Testte değiştirilebilir. */
  formTokens: FormTokens;

  constructor(d: RequestServiceDeps) {
    this.d = d;
    this.calendars = new CalendarCache(d.db, () => d.clock.now(), d.metrics, d.log);
    this.gate = new ConcurrencyGate(d.gate ?? REQUEST_GATE);
    this.blocks = new RequestBlockCache(d.db, () => d.clock.now());
    this.messages = new RequestMessages(this, d.secrets);
    this.formTokens = new FormTokens(d.secrets, () => d.clock.now());
    d.rooms.requestHooks = {
      admitted: (requestId) => this.clearConnectTimer(requestId),
      failed: (requestId) =>
        void this.connectTimeout(requestId, "auth_revoked").catch((err: unknown) => this.logErr(err, "request_auth_revoked")),
    };
    // P8c (ADR-0017): admit edilmiş AGENT misafirin `binding.request`'i → verme TX'i (müşteri istemciden değil oturumdan).
    d.rooms.bindingIssuer = (room, guest, req) =>
      issueBinding(this, guest.ctx ?? { ...SYSTEM_CTX, userAgent: "signaling" }, {
        sessionId: room.sessionId,
        // binding.ts yalnız AGENT misafiri için çağırır; oturum bağlantısı akışında sürüm beyan etmeyen 0.8.x AGENT olabilir.
        clientVersion: guest.clientVersion ?? UNDECLARED_AGENT_VERSION,
        previousKey: req.previousKey,
        previousKeys: req.previousKeys,
        full: req.full,
      });
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
  async resolveRef(
    ref: unknown,
  ): Promise<{ s: repo.SettingsRow; customer: { id: string; name: string; fileLabel: string } | null } | null> {
    if (typeof ref !== "string" || !/^[a-z2-7]{16}$/.test(ref)) return null;
    const [general, c] = await Promise.all([repo.settingsByRef(this.d.db, ref), repo.customerByRef(this.d.db, ref)]);
    if (general) return tenantActive(general.tenant) ? { s: general, customer: null } : null;
    const s = c?.tenant.requestSettings;
    if (!c || c.status !== "ACTIVE" || !s || !tenantActive(s.tenant)) return null;
    return { s, customer: { id: c.id, name: c.name, fileLabel: c.fileLabel } };
  }

  /** Public bilgi gövdesi (`TenantRequestInfo`; P8c `bindings/status` aynı şekli genişletir). */
  async requestInfo(tenantId: string, tenant: { name: string; logoPath: string | null }, waitMinutes: number): Promise<TenantRequestInfo> {
    const [consentText, abuse, logoUrl, chatRetentionDays] = await Promise.all([
      currentConsentText(this.d.db, tenantId, this.d.rooms.rec), // P28e §2.1: teklif yalnız kayıt açık ∧ kapasite uygun (talep yolu katılımlı)
      abuseEmail(this.d.db, { fromEnv: this.d.env.ABUSE_EMAIL, superAdminFallback: this.d.env.NODE_ENV !== "production" }),
      effectiveLogoUrl(this.d.db, tenant.logoPath), // P12 (AC-81)
      chatRetentionDaysOf(this.d.db, tenantId), // P22 (AC-292): Go talep formu saklama satırı
    ]);
    const businessHours = await publicBusinessHours(this.calendars, tenantId, this.d.clock.now()); // P18 (AC-258)
    return {
      tenant: { name: tenant.name, logoUrl },
      consentText,
      waitMinutes,
      abuseEmail: abuse,
      minAgentVersion: this.d.env.MIN_AGENT_VERSION ?? null,
      businessHours,
      chatRetentionDays,
    };
  }

  /** P18 `rs_request_sla_breached_total`: talep kapanışında (kabul/ret/iptal/süre dolumu) bir kez; hata yanıtı bozmaz. */
  countSlaBreach(requestId: string): void {
    void this.d.db.supportRequest
      .findUnique({ where: { id: requestId }, select: { status: true, slaDueAt: true, closedAt: true, acceptedAt: true } })
      .then((r) => {
        if (r && r.status !== "PENDING" && slaBreachedAt(r, this.d.clock.now())) this.d.metrics.inc("rs_request_sla_breached_total");
      })
      .catch((err: unknown) => this.logErr(err, "request_sla_metric"));
  }

  /** Aşım audit'i `request.rate_limited{bucket, keyType}` kaynak başına dakikada en çok 1 (AC-144) + metrik. */
  async rateAudit(ctx: AuditContext, tenantId: string | null, bucket: string, keyType: string, key: string): Promise<void> {
    this.d.metrics.inc("rs_request_rate_limited_total", { bucket });
    const k = `${bucket}|${key}`;
    if (this.d.limits.rateAudit.blockedFor(k) > 0 || this.d.limits.rateAudit.hit(k)) return;
    await writeAudit(this.d.db, ctx, {
      tenantId,
      ...CUSTOMER,
      action: "request.rate_limited",
      entity: "support_requests",
      result: "fail",
      newValue: { bucket, keyType },
    });
  }

  async limit(
    ctx: AuditContext,
    tenantId: string | null,
    counter: CounterKey,
    bucket: string,
    keyType: string,
    key: string,
  ): Promise<void> {
    const wait = hitBlocked(this.d.limits[counter], key);
    if (wait === 0) return;
    await this.rateAudit(ctx, tenantId, bucket, keyType, key);
    throw rateLimited(wait);
  }

  /**
   * S14-1: `/public/requests` kapı öncesi ön kontrol — ip/önek/net48 kovası zaten kilitliyse 429 (sayım yok; AC-209 503'te
   * kova tüketilmez kuralı korunur). Kilitli istemci kapı yuvası/kuyruk yeri tutamaz.
   */
  private async assertCreateNotBlocked(ctx: AuditContext, tenantId: string | null, ip: string, prefix: string, net: string): Promise<void> {
    const checks: [CounterKey, string, string, string][] = [
      ["createIp", "req.create.ip", "ip", ip],
      ["createPrefix", "req.create.prefix", "prefix", prefix],
    ];
    if (isIPv6Key(net)) checks.push(["createNet48", "req.create.net48", "net48", net]);
    for (const [counter, bucket, keyType, key] of checks) {
      const wait = blocked(this.d.limits[counter], key);
      if (wait === 0) continue;
      await this.rateAudit(ctx, tenantId, bucket, keyType, key);
      throw rateLimited(wait);
    }
  }

  async publishCount(tenantId: string): Promise<void> {
    this.d.hub.publish(tenantId, { t: "queue.count", pending: await repo.countPending(this.d.db, tenantId) });
  }

  /** Kapanış sonrası ortak bellek adımları (commit sonrası). P8c tek kayıt iptali de kullanır. */
  async closedAfterCommit(
    tenantId: string,
    requestId: string,
    status: "CANCELLED" | "EXPIRED" | "REJECTED",
    extra: { reason?: CancelReason; message?: string } = {},
  ): Promise<void> {
    this.d.hub.closeRequest(requestId, { t: "request.closed", status, ...extra });
    this.d.hub.publish(tenantId, { t: "request.removed", id: requestId, status });
    this.countSlaBreach(requestId);
    this.d.hub.queueChanged(tenantId);
    await this.publishCount(tenantId);
  }

  /** `/ws/request` sıra durumları (AC-139): tenant'ın bekleyenleri, yalnız kendi talebine ait alanlar. */
  async statesOf(tenantId: string): Promise<Map<string, RequestStatePayload>> {
    const q = await repo.pendingQueue(this.d.db, tenantId);
    return new Map(
      q.map((r, i) => [
        r.id,
        {
          status: "PENDING" as const,
          requestCode: r.requestCode,
          position: i + 1,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
        },
      ]),
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
   * POST /public/requests (G-E9-10 sırası; P14a AC-209): Origin (route) → ref/kayıt ön bakışı → kapı (503 NOT_READY) →
   * ipKey/önek/net48 kovaları (güvenilen CIDR muaf) → zod → sürüm → ref → bilinen kaynak → tenant kovası (okuma) → TX [kilit
   * → bekleyen sayımları → kod → INSERT → audit] → commit sonrası tenant kovası sayımı → hub/WhatsApp.
   */
  async create(ctx: AuditContext, body: unknown, parse: (b: unknown) => CreateRequestData): Promise<CreateRequestResponse> {
    return this.createCore(ctx, body, (b) => agentInput(parse(b)), "AGENT");
  }

  /**
   * Ortak oluşturma çekirdeği (AGENT ve WEB). WEB'de gövde zaten zod + bot kapısından geçmiştir (`createWeb`); ref/form
   * kapalı → kovalardan ÖNCE tek tip 404 (S-P19-2). Kova/TX sırası iki kaynakta aynı (P18 sırası).
   */
  private async createCore(
    ctx: AuditContext,
    body: unknown,
    parse: (b: unknown) => CreateCoreInput,
    source: RequestSource,
    portal: PortalCreateOptions | null = null,
  ): Promise<CreateRequestResponse> {
    const p = await peekCreate(this, ctx, body, source, portal);
    // P14a (AC-209) sıra: hazır mı (kapı; dolu/zaman aşımı → 503 NOT_READY) → IP/önek kovası → TX → commit sonrası tenant
    // kovası. 503'te hiçbir kova tüketilmez. Ref/kayıt çözülemediyse TX'e hiç varılmaz (tek 404 yolu) → kapı gerekmez.
    // S14-1: kilitli ip/önek/net48 kapıya HİÇ girmez (sayımsız ön kontrol); sayım (`hit`) kapının içinde kalır.
    if (!p.trusted) await this.assertCreateNotBlocked(ctx, p.peeked?.tenantId ?? null, p.ip, p.prefix, p.net);
    const admit = () => admitCreate(this, ctx, body, parse, p);
    const r = p.peeked ? await this.gated(p.peeked.tenantId, admit) : await admit();
    return afterCreate(this, p.web, r);
  }

  // ------------------------------------------------------------------ P19 web talep formu (§8c.2; AC-259)

  /**
   * Müşteriye sunulabilir durum bildirimi kanalları: firma açmış **ve** kanal kullanılabilir (tek kaynak: form, oluşturma
   * denetimi, ayar uyarıları). SMS: adres + çözülebilir anahtar + güvenli hedef (J3; `keyUnreadable` → kullanılamaz).
   */
  channelsOf(s: repo.SettingsRow, avail: ChannelAvailability): NotifyChoice {
    return {
      sms: s.notifySmsEnabled && avail.sms,
      whatsapp: s.notifyWhatsappEnabled && this.d.notifier.usable,
      email: s.notifyEmailEnabled && avail.smtp,
    };
  }

  /** Kanal altyapısı (firma bayraklarından bağımsız): tenant SMTP ve SMS. */
  async channelAvailability(tenantId: string): Promise<ChannelAvailability> {
    const [smtp, sms] = await Promise.all([this.d.mail.configFor(tenantId), this.d.sms.usableFor(tenantId)]);
    return { smtp: smtp !== null, sms };
  }

  /** GET /public/web-requests/form?ref= — geçersiz ref, pasif müşteri, form kapalı → aynı 404 (S-P19-2). */
  async webFormInfo(ctx: AuditContext, ref: unknown): Promise<WebFormInfo> {
    return webFormInfoOf(this, ctx, ref);
  }

  /**
   * POST /public/web-requests (§8c.2 m.2–3): zod → bot kapısı (gizli alan, token HMAC + ref + yaş, SENKRON tüketim) → ortak
   * çekirdek (ref/form → kovalar → mesai → TX). Tüketim ref/mesai/kova/TX'ten ÖNCE: sonraki red alan token da harcanmıştır.
   */
  async createWeb(ctx: AuditContext, body: unknown): Promise<CreateRequestResponse> {
    const core = await webFormCoreInput(this, ctx, body);
    return this.createCore(ctx, core, () => core, "WEB");
  }

  /**
   * P21 (K-P21-2): POST /portal/requests — gövde portal/data.ts'te YALNIZ sunucuda kurulur (ref oturumdaki müşterinin);
   * aynı çekirdek, `web_form_enabled` denetimi yok, beklenen firma/müşteri doğrulaması + müşteri bekleyen sınırı (TX).
   */
  async createPortal(ctx: AuditContext, core: CreateCoreInput, portal: PortalCreateOptions): Promise<CreateRequestResponse> {
    return this.createCore(ctx, core, () => core, "WEB", portal);
  }

  /** POST /public/requests/cancel (AC-141): her durumda 204 — sır oracle'ı yok. */
  async cancelBySecret(ctx: AuditContext, secret: string, source: RequestSource = "AGENT"): Promise<void> {
    await this.limit(ctx, null, "cancel", "req.cancel", "ip", ipKey(ctx.ip));
    const row = await repo.findBySecretHash(this.d.db, sha256Hex(secret));
    // P19 (§8c.2 m.4): tür ↔ kaynak uyuşmazlığında sessizce 204 (sır oracle'ı yok).
    if (row && row.source === source) await this.customerCancel(ctx, row);
  }

  /** Müşteri iptali (PENDING → CANCELLED; ACCEPTED + oturum PENDING → decline, §13.3) — cancel.ts. */
  async customerCancel(ctx: AuditContext, row: repo.SecretRow): Promise<void> {
    return customerCancelOf(this, ctx, row);
  }

  /** Sistem iptali: DISCONNECTED (120 sn kopma) / TENANT_PASSIVE (AC-141, 145) — cancel.ts. */
  async cancelSystem(requestId: string, reason: repo.SystemCancelReason): Promise<boolean> {
    return cancelSystemOf(this, requestId, reason);
  }

  /**
   * GET /public/agent/request-download?ref=&os= (AC-130, 132; P31 AC-509, 521): 302 konumu; ref ve UA loga/audit'e
   * yazılmaz. Sıra: engel → kova → ref (tek 404) → platform → kapı. `os` açıksa ona göre (macos + kapı kapalı → 503);
   * yoksa UA macOS masaüstü **ve** mac kapısı `ok` → macos, aksi windows (bugünkü davranış, gerileme yok).
   */
  async download(ctx: AuditContext, ref: unknown, os: RequestClientOs | undefined, gates: DownloadGates): Promise<string> {
    const ip = ipKey(ctx.ip);
    this.assertRefNotBlocked(ip);
    await this.limit(ctx, null, "download", "req.download", "ip", ip);
    const r = await this.resolveRef(ref);
    if (!r) throw this.refInvalid(ip);
    const chosen = os ?? (osFromUserAgent(ctx.userAgent) === "macos" && (await gates.macosOk()) ? "macos" : "windows");
    await gates.assertReady(chosen);
    this.d.metrics.inc("rs_agent_download_total", { os: chosen, kind: "firm" });
    // AC-168: dosya adı sahibin etiketi + ref (G-E10-8 şerhi: yalnız ref'i bilen görür).
    return r.customer
      ? requestDownloadLocation(r.customer.fileLabel, ref as string, chosen)
      : requestDownloadLocation(r.s.fileLabel, r.s.requestRef, chosen);
  }

  /**
   * forward_auth firma yolu (G-E9-11): ref aktif ve label güncel file_label → true; aksi false (tek 404). P31 (K-P31-3):
   * uzantı kapıya göre sabit — `/agent-ready/windows` yalnız `.exe`, `/agent-ready/macos-firm` yalnız `.zip`.
   */
  async firmPathValid(uri: string, ext: FirmFileExt): Promise<boolean> {
    const p = parseFirmDownloadUri(uri, ext);
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

  /** ACCEPTED → CONNECT_FAILED + oturum PENDING → CANCELLED, tek TX (AC-155) — cancel.ts. */
  async connectTimeout(requestId: string, endReason: "connect_timeout" | "auth_revoked"): Promise<boolean> {
    return connectTimeoutOf(this, requestId, endReason);
  }

  shutdown(): void {
    this.messages.close();
    for (const t of this.connectTimers.values()) this.d.clock.clearTimeout(t);
    this.connectTimers.clear();
  }
}
