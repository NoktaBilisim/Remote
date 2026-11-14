// Fastify uygulaması (dinlemeden). server.ts dinler; testler `inject` ile kullanır.
// Rotalar eklenti olarak kaydedilir (ready'de yüklenir) — AC-69 test aracı onRoute ile tüm uçları toplar.
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import { authRoutes } from "./auth/routes.ts";
import { closeAuthLimits, createAuthLimits, type AuthLimits } from "./auth/service.ts";
import type { AuthContext } from "./auth/session.ts";
import type { Env } from "./env.ts";
import type { Db } from "./lib/db.ts";
import { registerErrorHandling } from "./lib/errors.ts";
import { newId } from "./lib/ids.ts";
import { FixedWindowCounter } from "./lib/rate.ts";
import { createLogger } from "./lib/logger.ts";
import { healthRoutes } from "./ops/health.ts";
import { createMetrics, metricsRoutes, type Metrics } from "./ops/metrics.ts";
import { endOrphanedActive } from "./sessions/service.ts";
import { Rooms } from "./signaling/rooms.ts";
import type { Clock, Timing } from "./signaling/types.ts";
import { attachSignaling, type SignalingOptions } from "./signaling/ws.ts";
import { RetentionJob } from "./jobs/retention.ts";
import { startScheduler, type Scheduler } from "./jobs/scheduler.ts";
import { AgentBinary } from "./public/agent-binary.ts";
import { internalAgentRoutes, publicAgentRoutes } from "./public/routes.ts";
import { refKeyFrom } from "./sessions/codes.ts";
import { closePublicLimits, createPublicLimits, type PublicLimits } from "./sessions/public.ts";
import { publicSessionRoutes, sessionRoutes } from "./sessions/routes.ts";
import { WhatsappNotifier, type FetchLike } from "./notify/whatsapp.ts";
import { RequestHub } from "./requests/hub.ts";
import { armOrphanedPending, pendingGauge } from "./requests/jobs.ts";
import { closeRequestLimits, createRequestLimits } from "./requests/limits.ts";
import { publicRequestDownloadRoutes, publicRequestRoutes } from "./requests/public-routes.ts";
import { requestSettingsRoutes, supportRequestRoutes } from "./requests/routes.ts";
import { RequestService } from "./requests/service.ts";
import { requestChannels } from "./requests/ws.ts";
import { customerRoutes } from "./customers/routes.ts";
import { publicBindingRoutes } from "./bindings/public-routes.ts";
import { userRoutes } from "./users/routes.ts";
import { closeAccountLimits, createAccountLimits, type AccountDeps } from "./auth/account.ts";
import { SecretBox } from "./lib/crypto.ts";
import { createNetGuard, type NetGuard } from "./lib/netguard.ts";
import { MailService, type TransportFactory } from "./mail/service.ts";
import { smtpSettingsRoutes } from "./tenants/smtp-routes.ts";
import { adminTenantRoutes, tenantSettingsRoutes } from "./tenants/routes.ts";
import { auditReadOnlyRoutes, auditRoutes } from "./audit/routes.ts";
import { adminSettingsRoutes, applyTurn, applyWhatsapp, consentTextRoutes } from "./settings/routes.ts";
import type { ProbeResult, ProbeTarget } from "./settings/mysql-probe.ts";
import { DEFAULT_LOGO_URL } from "@remote/contracts/api/branding";
import { fileRoutes, publicBrandingRoutes } from "./uploads/files.ts";
import { uploadRoutes } from "./uploads/routes.ts";
import { UploadStore } from "./uploads/store.ts";
import { mailLogoUrl } from "./uploads/urls.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    env: Env;
    authLimits: AuthLimits;
    publicLimits: PublicLimits;
    sessionRefKey: string;
    rooms: Rooms;
    metrics: Metrics;
    agentBinary: AgentBinary;
    /** P8b: destek talebi servisi + bildirim merkezi. */
    requests: RequestService;
    requestHub: RequestHub;
    /** P13a (AC-197..199): günlük saklama işi (zamanlayıcı + testler aynı örneği kullanır). */
    retention: RetentionJob;
    /** P12b (AC-196): WhatsApp istemcisi; etkin adres panel kaydı > env (`applyWhatsapp`). */
    whatsapp: WhatsappNotifier;
    /** P10: gizli alan şifreleme, e-posta, hesap güvenliği. */
    secrets: SecretBox;
    netguard: NetGuard;
    mail: MailService;
    account: AccountDeps;
    smtpTestLimit: FixedWindowCounter;
    /** P12: logo/avatar deposu (UPLOADS_DIR). */
    uploads: UploadStore;
    /** P10 (AC-67): zorunlu 2FA kurulum aşaması uygulanıyor mu (production'da her zaman true, B-P10-3). */
    mfaSetupEnforced: boolean;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    allowPasswordChangePending?: boolean;
    /** P10: 2FA doğrulaması bekleyen oturumda serbest (/auth/me, /auth/logout, /auth/mfa/verify). */
    mfaVerifyStage?: boolean;
    /** P10: 2FA kurulumu zorunlu oturumda serbest (/auth/me, /auth/logout, /auth/mfa/setup|enable, /auth/password/change). */
    mfaSetupStage?: boolean;
  }
}

z.config(z.locales.tr());

export interface AppDeps {
  env: Env;
  db: Db;
  logger?: Logger;
  authLimits?: AuthLimits;
  /** Periyodik işler (expiry); server.ts true verir, testler işi doğrudan çağırır. */
  startJobs?: boolean;
  /** Testler: sahte saat, kısa süreler, kısa ping/yeniden doğrulama aralıkları. */
  signaling?: SignalingOptions & { clock?: Clock; timing?: Partial<Timing> };
  /** Testler: sahte WhatsApp servisi. */
  whatsappFetch?: FetchLike;
  /** Testler: yerel sahte SMTP'ye izin veren netguard ve/veya taşıyıcı. Production yolu her zaman varsayılan. */
  netguard?: NetGuard;
  mailTransport?: TransportFactory;
  /** Yalnız testler (env ile değiştirilemez; server.ts vermez): false → zorunlu 2FA kurulum aşaması uygulanmaz. */
  mfaSetupEnforcement?: boolean;
  /** Yalnız testler: MySQL bağlantı testi yerine sahte yoklama (P11). */
  mysqlProbe?: (t: ProbeTarget) => Promise<ProbeResult>;
}

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), display-capture=(self)";

/** CSP / başlıklar (mimari §5.4, G-19, AC-126). connect-src WS origin'i portu içerir. */
function helmetOptions(env: Env) {
  const base = new URL(env.PUBLIC_BASE_URL);
  const ws = `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}`;
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", ws],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: false },
    crossOriginResourcePolicy: { policy: "same-origin" as const },
    crossOriginOpenerPolicy: { policy: "same-origin" as const },
    referrerPolicy: { policy: "no-referrer" as const },
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { env } = deps;
  // B-P10-3: zorunlu 2FA kurulumu production'da kapatılamaz (savunma derinliği; server.ts zaten vermez).
  if (deps.mfaSetupEnforcement === false && env.NODE_ENV === "production") throw new Error("mfaSetupEnforcement:false production'da kullanılamaz");
  const app = Fastify({
    loggerInstance: deps.logger ?? createLogger(env.LOG_LEVEL),
    trustProxy: env.TRUSTED_PROXY_CIDR ?? false, // G-11: yalnız Caddy
    genReqId: () => newId(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
  }) as unknown as FastifyInstance;

  app.decorate("db", deps.db);
  app.decorate("mfaSetupEnforced", deps.mfaSetupEnforcement ?? true); // örnek başına (modül global'i yok)
  app.decorate("env", env);
  const authLimits = deps.authLimits ?? createAuthLimits();
  app.decorate("authLimits", authLimits);
  app.addHook("onClose", async () => closeAuthLimits(authLimits));
  const publicLimits = createPublicLimits(app.log, env.TRUSTED_PROXY_CIDR);
  app.decorate("publicLimits", publicLimits);
  app.decorate("sessionRefKey", refKeyFrom(env.SESSION_REF_KEY));
  app.addHook("onClose", async () => closePublicLimits(publicLimits));
  // P6 (G-07): indirme yalnız volume'daki ikilinin hash'i AGENT_SHA256 ile eşleşirken açık; açılışta bir kez ısıtılır.
  const agentBinary = new AgentBinary(env.AGENT_BINARY_PATH, env.AGENT_SHA256, (state) =>
    app.log.warn({ alarm: "agent_binary", state }, "Windows istemcisi indirilemez (yapılandırma eksik, dosya yok veya SHA-256 uyuşmuyor)"),
  );
  app.decorate("agentBinary", agentBinary);
  app.addHook("onReady", async () => {
    await agentBinary.check();
  });
  const metrics = createMetrics();
  app.decorate("metrics", metrics);
  // P10: gizli alanlar, netguard (G-12), e-posta.
  const secrets = new SecretBox(env.encryptionKeys);
  const netguard =
    deps.netguard ??
    createNetGuard({
      denyHosts: [new URL(env.PUBLIC_BASE_URL).hostname], // B-P10-1: kendi adresimiz de yasak
      onSelfUnresolved: (host, cached) => app.log.warn({ alarm: "netguard_self_unresolved", host, cached }, cached ? "kendi adımız çözülemedi; son başarılı çözüm kullanıldı" : "kendi adımız çözülemedi; SMTP hedefi reddedildi (fail-closed)"),
    });
  const mail = new MailService({
    db: deps.db,
    secrets,
    netguard,
    metrics,
    log: app.log,
    logoUrlFor: (tenantId) => mailLogoUrl(deps.db, env.PUBLIC_BASE_URL, tenantId), // P12 (AC-81)
    fallbackLogoUrl: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}${DEFAULT_LOGO_URL}`,
    ...(deps.mailTransport ? { transport: deps.mailTransport } : {}),
  });
  // P12 (AC-84): yükleme deposu; yazılamıyorsa alarm (yüklemeler 500 verir, sunucu yine açılır).
  const uploads = new UploadStore(env.UPLOADS_DIR);
  app.decorate("uploads", uploads);
  app.addHook("onReady", async () => {
    if (!(await uploads.writable())) app.log.error({ alarm: "uploads_not_writable" }, "UPLOADS_DIR yazılamıyor; logo/avatar yüklemesi çalışmaz");
  });
  app.decorate("secrets", secrets);
  app.decorate("netguard", netguard);
  app.decorate("mail", mail);
  const smtpTestLimit = new FixedWindowCounter(6, 60_000, 60_000); // AC-122: 5/dk/tenant (SMTP + e-posta kanal testi ortak)
  app.decorate("smtpTestLimit", smtpTestLimit);
  const accountLimits = createAccountLimits();
  app.addHook("onClose", async () => {
    closeAccountLimits(accountLimits);
    smtpTestLimit.close();
  });
  const sig = deps.signaling ?? {};
  const turn = { urls: env.turnUrls, secret: env.TURN_SECRET, ttlMin: env.TURN_CRED_TTL_MIN };
  const rooms = new Rooms({ db: deps.db, log: app.log, turn, metrics, ...(sig.clock ? { clock: sig.clock } : {}), ...(sig.timing ? { timing: sig.timing } : {}) });
  app.decorate("rooms", rooms);
  // P11 (G-13): panel TURN kaydı varsa env yerine o; okunamazsa env ile devam (alarm logu).
  app.addHook("onReady", async () => {
    try {
      await applyTurn(app);
    } catch (err) {
      app.log.error({ err, alarm: "turn_settings_load" }, "TURN panel ayarı okunamadı; env kullanılıyor");
    }
  });
  metrics.gauge("rs_active_rooms", "Bellekteki oda sayısı", () => rooms.size);
  metrics.gauge("rs_active_sessions", "Admit edilmiş (ACTIVE) oturum sayısı", () => rooms.activeCount);
  metrics.gauge("rs_resolve_failed", "Başarısız kod çözümleme (süreç başından beri)", () => publicLimits.resolveFailed.total);
  // P8b (mimari-e9 §2): bildirim merkezi, hız sınırları, WhatsApp istemcisi, talep servisi.
  const hub: RequestHub = new RequestHub(rooms.clock, (tenantId: string) => requests.statesOf(tenantId), (err) => app.log.error({ err }, "talep sıra yayını hatası"));
  const requestLimits = createRequestLimits();
  const notifier = new WhatsappNotifier({ url: env.WHATSAPP_SERVICE_URL, production: env.NODE_ENV === "production", publicBaseUrl: env.PUBLIC_BASE_URL, db: deps.db, log: app.log, metrics, clock: rooms.clock, ...(deps.whatsappFetch ? { fetch: deps.whatsappFetch } : {}) });
  app.decorate("whatsapp", notifier);
  // P12b (AC-196): panel WhatsApp adresi varsa env yerine o; okunamazsa env ile devam (alarm logu).
  app.addHook("onReady", async () => {
    try {
      await applyWhatsapp(app);
    } catch (err) {
      app.log.error({ err, alarm: "whatsapp_settings_load" }, "WhatsApp panel ayarı okunamadı; env kullanılıyor");
    }
  });
  const requests: RequestService = new RequestService({ db: deps.db, env, log: app.log, rooms, hub, limits: requestLimits, notifier, mail, metrics, clock: rooms.clock, timing: rooms.timing });
  app.decorate("requests", requests);
  const retention = new RetentionJob(requests);
  app.decorate("retention", retention);
  app.decorate("requestHub", hub);
  app.decorate("account", {
    db: deps.db,
    secrets,
    mail,
    limits: accountLimits,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    log: app.log,
    endLive: async (userId: string) => {
      await rooms.endByTechnician(userId);
      hub.closeByUser(userId);
    },
  } satisfies AccountDeps);
  metrics.gauge("rs_customers_active", "Aktif müşteri firmalar (P8c; açılış, günlük iş, durum değişimi)", () => requests.customersActive);
  metrics.gauge("rs_requests_pending", "Bekleyen destek talepleri (süpürücü turunda tazelenir)", () => pendingGauge.value);
  app.addHook("onClose", async () => {
    requests.shutdown();
    hub.shutdown();
    notifier.close();
    closeRequestLimits(requestLimits);
  });
  attachSignaling(app, rooms, sig, requestChannels(app, requests, sig.revalidateMs), () => ({ request: hub.requestCount, panel: hub.panelCount }));
  if (deps.startJobs) {
    let jobs: Scheduler | undefined;
    app.addHook("onReady", async () => {
      // Bellekteki odası olmayan ACTIVE oturumlar (yeniden başlatma) → ENDED{server} (mimari §3.5).
      const orphaned = await endOrphanedActive(deps.db, new Date());
      if (orphaned > 0) app.log.warn({ ended: orphaned }, "yeniden başlatma: etkin oturumlar sonlandırıldı");
      const armed = await armOrphanedPending(requests); // §3.5: 120 sn tolerans
      if (armed > 0) app.log.info({ pending: armed }, "yeniden başlatma: bekleyen talepler için kopma toleransı başlatıldı");
      requests.refreshCustomersGauge();
      jobs = startScheduler(deps.db, app.log, rooms, undefined, requests, retention);
    });
    app.addHook("onClose", async () => jobs?.stop());
  }
  app.decorateRequest("auth", null);
  registerErrorHandling(app);
  // Gövdesiz `Content-Type: application/json` (ör. POST /auth/logout) kabul edilir (QA-4);
  // dolu gövde Fastify'ın varsayılan (prototip zehirlenmesine karşı korumalı) ayrıştırıcısıyla.
  const defaultJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const text = body.toString();
    if (text.trim() === "") return done(null, undefined);
    return defaultJson(req, text, done);
  });
  app.addHook("onRequest", async (req, reply) => {
    void reply.header("X-Request-Id", req.id);
    void reply.header("Permissions-Policy", PERMISSIONS_POLICY);
  });

  void app.register(cookie);
  void app.register(helmet, helmetOptions(env));
  void app.register(healthRoutes);
  void app.register(metricsRoutes);
  void app.register(authRoutes, { prefix: "/api/v1/auth" });
  void app.register(sessionRoutes, { prefix: "/api/v1/sessions" });
  void app.register(publicSessionRoutes, { prefix: "/api/v1/public/sessions" });
  void app.register(publicAgentRoutes, { prefix: "/api/v1/public/agent" });
  void app.register(internalAgentRoutes, { prefix: "/internal" });
  void app.register(publicRequestRoutes, { prefix: "/api/v1/public/requests" });
  void app.register(publicRequestDownloadRoutes, { prefix: "/api/v1/public/agent" });
  void app.register(supportRequestRoutes, { prefix: "/api/v1/support-requests" });
  void app.register(requestSettingsRoutes, { prefix: "/api/v1/settings/support-requests" });
  void app.register(customerRoutes, { prefix: "/api/v1/customers" });
  void app.register(publicBindingRoutes, { prefix: "/api/v1/public/bindings" });
  void app.register(userRoutes, { prefix: "/api/v1/users" });
  void app.register(adminTenantRoutes, { prefix: "/api/v1/admin" });
  void app.register(tenantSettingsRoutes, { prefix: "/api/v1/settings/tenant" });
  void app.register(smtpSettingsRoutes, { prefix: "/api/v1/settings/smtp" });
  void app.register(auditRoutes, { prefix: "/api/v1/audit" });
  void app.register(auditReadOnlyRoutes, { prefix: "/api/v1/audit" });
  void app.register(adminSettingsRoutes, { prefix: "/api/v1/admin/settings", ...(deps.mysqlProbe ? { mysqlProbe: deps.mysqlProbe } : {}) });
  void app.register(consentTextRoutes, { prefix: "/api/v1/settings/consent-text" });
  // P12 marka: yükleme (multipart yalnız bu bağlamda), dosya sunumu, public marka.
  void app.register(uploadRoutes, { prefix: "/api/v1", deps: { db: deps.db, store: uploads, log: app.log } });
  void app.register(fileRoutes, { prefix: "/api/v1", store: uploads });
  void app.register(publicBrandingRoutes, { prefix: "/api/v1/public" });
  return app;
}
