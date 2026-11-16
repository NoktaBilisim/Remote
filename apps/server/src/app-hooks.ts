// buildApp kurulumunun ikinci yarısı ve kancalar: talep/bildirim servisleri, arka plan işleri (decorate + onReady/onClose),
// açılış işleri (zamanlayıcı) ve istek ön işleme (hata zarfı, JSON ayrıştırıcı, yanıt başlıkları). Kayıt sırası
// buildApp'teki gibidir; app.ts bu işlevleri aynı sırayla çağırır.
import type { FastifyInstance } from "fastify";
import { sweepOrphanRows } from "./jobs/retention-fsrv.ts";
import type { FsrvRuntime } from "./fsrv/wiring.ts";
import type { AppDeps } from "./app.ts";
import type { AccountDeps } from "./auth/account.ts";
import type { SecretBox } from "./lib/crypto.ts";
import type { Db } from "./lib/db.ts";
import { registerErrorHandling } from "./lib/errors.ts";
import type { NetGuard } from "./lib/netguard.ts";
import type { MailService } from "./mail/service.ts";
import type { Metrics } from "./ops/metrics.ts";
import type { ErasureLedger } from "./ops/erasure-ledger.ts";
import { endOrphanedActive } from "./sessions/service.ts";
import type { PublicLimits } from "./sessions/public.ts";
import type { Rooms } from "./signaling/rooms.ts";
import { RetentionJob } from "./jobs/retention.ts";
import { OrphanScanJob } from "./jobs/orphan-scan.ts";
import { registerPurgeMetrics, TenantPurgeRunner } from "./jobs/tenant-purge.ts";
import { startScheduler, type Scheduler } from "./jobs/scheduler.ts";
import { WhatsappNotifier } from "./notify/whatsapp.ts";
import { SmsClient } from "./notify/sms.ts";
import { NotifyOutbox } from "./notify/outbox.ts";
import { RequestHub } from "./requests/hub.ts";
import { armOrphanedPending, pendingGauge } from "./requests/jobs.ts";
import { closeRequestLimits, createRequestLimits, type RequestLimits } from "./requests/limits.ts";
import { RequestService } from "./requests/service.ts";
import { applyWhatsapp } from "./settings/routes.ts";
import { closeSendLinkLimits, createSendLinkLimits } from "./sessions/send-link.ts";
import { serviceBinary } from "./unattended/download.ts";
import type { UploadStore } from "./uploads/store.ts";

/** buildApp ara ürünleri (yalnız bu dosyada; kapanış değişkenlerinin yerini tutar). */
export interface Wiring {
  metrics: Metrics;
  publicLimits: PublicLimits;
  secrets: SecretBox;
  netguard: NetGuard;
  mail: MailService;
  uploads: UploadStore;
  erasureLedger: ErasureLedger;
  accountLimits: AccountDeps["limits"];
  rooms: Rooms;
}

interface RequestWiring {
  hub: RequestHub;
  requestLimits: RequestLimits;
  notifier: WhatsappNotifier;
  outbox: NotifyOutbox;
  requests: RequestService;
}

function createNotifier(app: FastifyInstance, deps: AppDeps, w: Wiring): WhatsappNotifier {
  const { env } = deps;
  return new WhatsappNotifier({
    url: env.WHATSAPP_SERVICE_URL,
    apiKey: env.WHATSAPP_SERVICE_API_KEY ?? null,
    production: env.NODE_ENV === "production",
    allowInsecureHttp: env.WHATSAPP_ALLOW_INSECURE_HTTP,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    db: deps.db,
    log: app.log,
    metrics: w.metrics,
    clock: w.rooms.clock,
    ...(deps.whatsappFetch ? { fetch: deps.whatsappFetch } : {}),
  });
}

/** P19 J3: firma SMS istemcisi ve müşteri durum bildirimi kuyruğu. */
function decorateOutbox(
  app: FastifyInstance,
  deps: AppDeps,
  w: Wiring,
  notifier: WhatsappNotifier,
): { sms: SmsClient; outbox: NotifyOutbox } {
  const sms = new SmsClient({
    db: deps.db,
    secrets: w.secrets,
    guard: w.netguard,
    envUrl: deps.env.SMSPORTAL_URL,
    production: deps.env.NODE_ENV === "production",
    log: app.log,
    metrics: w.metrics,
    now: () => w.rooms.clock.now(),
  });
  app.decorate("sms", sms);
  const outbox = new NotifyOutbox({
    db: deps.db,
    secrets: w.secrets,
    sms,
    whatsapp: notifier,
    mail: w.mail,
    metrics: w.metrics,
    log: app.log,
    now: () => w.rooms.clock.now(),
  });
  app.decorate("outbox", outbox);
  return { sms, outbox };
}

/** P8b (mimari-e9 §2): bildirim merkezi, hız sınırları, WhatsApp istemcisi, talep servisi. */
export function decorateRequests(app: FastifyInstance, deps: AppDeps, w: Wiring): RequestWiring {
  const hub: RequestHub = new RequestHub(
    w.rooms.clock,
    (tenantId: string) => requests.statesOf(tenantId),
    (err) => app.log.error({ err }, "talep sıra yayını hatası"),
  );
  const requestLimits = createRequestLimits();
  const notifier = createNotifier(app, deps, w);
  app.decorate("whatsapp", notifier);
  // P12b (AC-196): panel WhatsApp adresi varsa env yerine o; okunamazsa env ile devam (alarm logu).
  app.addHook("onReady", async () => {
    try {
      await applyWhatsapp(app);
    } catch (err) {
      app.log.error({ err, alarm: "whatsapp_settings_load" }, "WhatsApp panel ayarı okunamadı; env kullanılıyor");
    }
  });
  const { sms, outbox } = decorateOutbox(app, deps, w, notifier);
  // LG §7: alıcı/firma bellek kovaları TEK örnek — K1 eski uçları (sessions/routes) ve customer-send ortak kullanır.
  const sendLinkLimits = createSendLinkLimits();
  app.decorate("sendLinkLimits", sendLinkLimits);
  app.addHook("onClose", async () => closeSendLinkLimits(sendLinkLimits));
  // P27 servis ikilisi kapısı tek örnek (oturumlu indirme, LG public indirme ve K2 kanal kapısı ortak; alarm tek kez).
  app.decorate(
    "unattendedBinary",
    serviceBinary(deps.env.UNATTENDED_AGENT_PATH, deps.env.UNATTENDED_AGENT_SHA256, (state) =>
      app.log.warn(
        { alarm: "unattended_binary", state },
        "Gözetimsiz servis ikilisi indirilemez (yapılandırma eksik, dosya yok veya SHA-256 uyuşmuyor)",
      ),
    ),
  );
  const requests: RequestService = new RequestService({
    db: deps.db,
    env: deps.env,
    log: app.log,
    rooms: w.rooms,
    hub,
    limits: requestLimits,
    notifier,
    mail: w.mail,
    sms,
    outbox,
    metrics: w.metrics,
    clock: w.rooms.clock,
    timing: w.rooms.timing,
    secrets: w.secrets,
  });
  app.decorate("requests", requests);
  return { hub, requestLimits, notifier, outbox, requests };
}

/** P16 G3 (AC-242): firma silme yürütücüsü; FENCE sonrası canlı odalar/panel soketleri kapatılır. */
function createTenantPurge(app: FastifyInstance, deps: AppDeps, w: Wiring, hub: RequestHub): TenantPurgeRunner {
  return new TenantPurgeRunner({
    db: deps.db,
    store: w.uploads,
    files: app.fsrv.store,
    ledger: w.erasureLedger,
    metrics: w.metrics,
    log: app.log,
    live: {
      closeTenant: async (tenantId) => {
        await w.rooms.endByTenant(tenantId);
        hub.closeByTenant(tenantId);
      },
    },
  });
}

function accountDeps(app: FastifyInstance, deps: AppDeps, w: Wiring, hub: RequestHub): AccountDeps {
  return {
    db: deps.db,
    secrets: w.secrets,
    mail: w.mail,
    limits: w.accountLimits,
    publicBaseUrl: deps.env.PUBLIC_BASE_URL,
    log: app.log,
    endLive: async (userId: string) => {
      await w.rooms.endByTechnician(userId);
      hub.closeByUser(userId);
    },
  } satisfies AccountDeps;
}

/** Saklama, yetim tarama, firma silme işleri; hesap bağımlılıkları; talep göstergeleri ve kapanış. */
export function decorateJobs(
  app: FastifyInstance,
  deps: AppDeps,
  w: Wiring,
  r: RequestWiring,
): { retention: RetentionJob; orphanScan: OrphanScanJob; tenantPurge: TenantPurgeRunner } {
  const { metrics } = w;
  const retention = new RetentionJob(r.requests, { fsrv: app.fsrv });
  app.decorate("retention", retention);
  const orphanScan = new OrphanScanJob({ db: deps.db, store: w.uploads, metrics, log: app.log }); // P16 AC-243
  app.decorate("orphanScan", orphanScan);
  const tenantPurge = createTenantPurge(app, deps, w, r.hub);
  app.decorate("tenantPurge", tenantPurge);
  registerPurgeMetrics(metrics, () => tenantPurge);
  app.decorate("requestHub", r.hub);
  app.decorate("account", accountDeps(app, deps, w, r.hub));
  metrics.gauge("rs_customers_active", "Aktif müşteri firmalar (P8c; açılış, günlük iş, durum değişimi)", () => r.requests.customersActive);
  metrics.gauge("rs_requests_pending", "Bekleyen destek talepleri (süpürücü turunda tazelenir)", () => pendingGauge.value);
  app.addHook("onClose", async () => {
    r.requests.shutdown();
    r.hub.shutdown();
    r.notifier.close();
    closeRequestLimits(r.requestLimits);
  });
  return { retention, orphanScan, tenantPurge };
}

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), display-capture=(self)";

interface StartupJobs {
  rooms: Rooms;
  requests: RequestService;
  retention: RetentionJob;
  orphanScan: OrphanScanJob;
  tenantPurge: TenantPurgeRunner;
  outbox: NotifyOutbox;
  fsrv: FsrvRuntime;
}

/** server.ts (`startJobs`): açılışta yeniden başlatma temizliği + zamanlayıcı; kapanışta zamanlayıcı durur. */
export function addStartupJobs(app: FastifyInstance, db: Db, j: StartupJobs): void {
  let jobs: Scheduler | undefined;
  app.addHook("onReady", async () => {
    // Bellekteki odası olmayan ACTIVE oturumlar (yeniden başlatma) → ENDED{server} (mimari §3.5).
    const orphaned = await endOrphanedActive(db, new Date());
    if (orphaned > 0) app.log.warn({ ended: orphaned }, "yeniden başlatma: etkin oturumlar sonlandırıldı");
    const armed = await armOrphanedPending(j.requests); // §3.5: 120 sn tolerans
    if (armed > 0) app.log.info({ pending: armed }, "yeniden başlatma: bekleyen talepler için kopma toleransı başlatıldı");
    j.requests.refreshCustomersGauge();
    // P28b (§3.2): yeniden başlatmada bellekte aktarımı kalmayan yükleme/tarama/açık teklif satırları → disk sil → CANCELLED.
    const swept = await sweepOrphanRows(db, j.fsrv, new Date());
    if (swept > 0) app.log.warn({ cancelled: swept }, "yeniden başlatma: yarım kalan sunucu dosya aktarımları iptal edildi");
    jobs = startScheduler(db, app.log, j.rooms, undefined, j.requests, j.retention, j.orphanScan, j.tenantPurge, j.outbox);
  });
  app.addHook("onClose", async () => jobs?.stop());
}

/** İstek ön işleme: `auth` alanı, hata zarfı, gövdesiz JSON kabulü, istek kimliği ve izin politikası başlıkları. */
export function addRequestHooks(app: FastifyInstance): void {
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
}
