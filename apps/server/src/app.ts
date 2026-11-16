// Fastify uygulaması (dinlemeden). server.ts dinler; testler `inject` ile kullanır.
// Rota kaydı `app-routes.ts`, açılış işleri ve istek kancaları `app-hooks.ts` (sıra buildApp'teki gibi korunur).
import Fastify, { type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import { addRequestHooks, addStartupJobs, decorateJobs, decorateRequests, type Wiring } from "./app-hooks.ts";
import { registerRoutes } from "./app-routes.ts";
import { closeAuthLimits, createAuthLimits, type AuthLimits } from "./auth/service.ts";
import type { AuthContext } from "./auth/session.ts";
import type { Env } from "./env.ts";
import type { Db } from "./lib/db.ts";
import { newId } from "./lib/ids.ts";
import { FixedWindowCounter } from "./lib/rate.ts";
import { createLogger } from "./lib/logger.ts";
import { createMetrics, type Metrics } from "./ops/metrics.ts";
import { Rooms } from "./signaling/rooms.ts";
import type { Clock, Timing } from "./signaling/types.ts";
import { attachSignaling, type SignalingOptions } from "./signaling/ws.ts";
import { createDeviceChannel } from "./unattended/device-ws.ts";
import { DeviceHub } from "./unattended/hub.ts";
import { AgentBinary } from "./public/agent-binary.ts";
import { refKeyFrom } from "./sessions/codes.ts";
import { closePublicLimits, createPublicLimits, type PublicLimits } from "./sessions/public.ts";
import type { RequestService } from "./requests/service.ts";
import { requestChannels } from "./requests/ws.ts";
import type { FetchLike, WhatsappNotifier } from "./notify/whatsapp.ts";
import type { SmsClient } from "./notify/sms.ts";
import type { SendLinkLimits } from "./sessions/send-link.ts";
import type { NotifyOutbox } from "./notify/outbox.ts";
import type { RequestHub } from "./requests/hub.ts";
import type { RetentionJob } from "./jobs/retention.ts";
import type { OrphanScanJob } from "./jobs/orphan-scan.ts";
import type { TenantPurgeRunner } from "./jobs/tenant-purge.ts";
import { closeAccountLimits, createAccountLimits, type AccountDeps } from "./auth/account.ts";
import { SecretBox } from "./lib/crypto.ts";
import { createNetGuard, type NetGuard } from "./lib/netguard.ts";
import { MailService, type TransportFactory } from "./mail/service.ts";
import { applyTurn } from "./settings/routes.ts";
import type { ProbeResult, ProbeTarget } from "./settings/mysql-probe.ts";
import { DEFAULT_LOGO_URL } from "@remote/contracts/api/branding";
import { UploadStore } from "./uploads/store.ts";
import { ErasureLedger } from "./ops/erasure-ledger.ts";
import { mailLogoUrl } from "./uploads/urls.ts";
import { addAvSourceGuard, decorateFsrv, startAvPolling, type FsrvTestOptions } from "./fsrv/wiring.ts";
import { decorateRec } from "./rec/wiring.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    env: Env;
    authLimits: AuthLimits;
    publicLimits: PublicLimits;
    sessionRefKey: string;
    rooms: Rooms;
    /** P27 (mimari-p27 §4.4): bağlı gözetimsiz cihazlar (`/ws/device`). */
    unattendedHub: DeviceHub;
    metrics: Metrics;
    agentBinary: AgentBinary;
    /** P8b: destek talebi servisi + bildirim merkezi. */
    requests: RequestService;
    requestHub: RequestHub;
    /** P13a (AC-197..199): günlük saklama işi (zamanlayıcı + testler aynı örneği kullanır). */
    retention: RetentionJob;
    orphanScan: OrphanScanJob;
    /** P16 G3 (AC-242): firma silme yürütücüsü (zamanlayıcı 60 sn; testler `runJob`/`tick`). */
    tenantPurge: TenantPurgeRunner;
    /** P12b (AC-196): WhatsApp istemcisi; etkin adres panel kaydı > env (`applyWhatsapp`). */
    whatsapp: WhatsappNotifier;
    /** P19 J3: firma SMS istemcisi ve müşteri durum bildirimi kuyruğu. */
    sms: SmsClient;
    outbox: NotifyOutbox;
    /** LG §7: bağlantı gönderimi alıcı/firma kovaları (K1 + customer-send ortak tek örnek). */
    sendLinkLimits: SendLinkLimits;
    /** P27 servis ikilisi bütünlük kapısı (UNATTENDED_AGENT_PATH + SHA). */
    unattendedBinary: AgentBinary;
    /** P10: gizli alan şifreleme, e-posta, hesap güvenliği. */
    secrets: SecretBox;
    netguard: NetGuard;
    mail: MailService;
    account: AccountDeps;
    smtpTestLimit: FixedWindowCounter;
    /** P12: logo/avatar deposu (UPLOADS_DIR). */
    uploads: UploadStore;
    /** P16 (ADR-0030 m.9): imha defteri (yalnız ekleme). */
    erasureLedger: ErasureLedger;
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
  /** Yalnız testler: imha defteri yolu (üretimde sabit `ERASURE_LEDGER_PATH`, env yok). */
  erasureLedgerPath?: string;
  /** Yalnız testler (P28b): sahte clamd yönlendirmesi, DNS, disk oranı, kısa süreler. */
  fsrvTest?: FsrvTestOptions;
}

/** db/env, giriş ve public hız sınırları, metrikler, istemci ikilisi. */
function decorateCore(app: FastifyInstance, deps: AppDeps): Pick<Wiring, "metrics" | "publicLimits"> {
  const { env } = deps;
  app.decorate("db", deps.db);
  app.decorate("mfaSetupEnforced", deps.mfaSetupEnforcement ?? true); // örnek başına (modül global'i yok)
  app.decorate("env", env);
  const authLimits = deps.authLimits ?? createAuthLimits();
  app.decorate("authLimits", authLimits);
  app.addHook("onClose", async () => closeAuthLimits(authLimits));
  const metrics = createMetrics();
  app.decorate("metrics", metrics);
  const publicLimits = createPublicLimits(app.log, env.TRUSTED_PROXY_CIDR, metrics);
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
  return { metrics, publicLimits };
}

/** P10: netguard (G-12); testler kendi örneğini verebilir. */
function netguardFor(app: FastifyInstance, deps: AppDeps): NetGuard {
  return (
    deps.netguard ??
    createNetGuard({
      denyHosts: [new URL(deps.env.PUBLIC_BASE_URL).hostname], // B-P10-1: kendi adresimiz de yasak
      onSelfUnresolved: (host, cached) =>
        app.log.warn(
          { alarm: "netguard_self_unresolved", host, cached },
          cached
            ? "kendi adımız çözülemedi; son başarılı çözüm kullanıldı"
            : "kendi adımız çözülemedi; SMTP hedefi reddedildi (fail-closed)",
        ),
    })
  );
}

function createMail(app: FastifyInstance, deps: AppDeps, secrets: SecretBox, netguard: NetGuard, metrics: Metrics): MailService {
  const { env } = deps;
  return new MailService({
    db: deps.db,
    secrets,
    netguard,
    metrics,
    log: app.log,
    logoUrlFor: (tenantId) => mailLogoUrl(deps.db, env.PUBLIC_BASE_URL, tenantId), // P12 (AC-81)
    fallbackLogoUrl: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}${DEFAULT_LOGO_URL}`,
    ...(deps.mailTransport ? { transport: deps.mailTransport } : {}),
  });
}

/** P10 gizli alanlar/e-posta/hesap sınırları, P12 yükleme deposu, P16 imha defteri. */
function decorateIo(app: FastifyInstance, deps: AppDeps, metrics: Metrics): Omit<Wiring, "metrics" | "publicLimits" | "rooms"> {
  // P10: gizli alanlar, netguard (G-12), e-posta.
  const secrets = new SecretBox(deps.env.encryptionKeys);
  const netguard = netguardFor(app, deps);
  const mail = createMail(app, deps, secrets, netguard, metrics);
  // P12 (AC-84): yükleme deposu; yazılamıyorsa alarm (yüklemeler 500 verir, sunucu yine açılır).
  const uploads = new UploadStore(deps.env.UPLOADS_DIR);
  app.decorate("uploads", uploads);
  const erasureLedger = new ErasureLedger(deps.erasureLedgerPath, () => metrics.inc("rs_erasure_ledger_write_failed_total")); // P16
  app.decorate("erasureLedger", erasureLedger);
  app.addHook("onReady", async () => {
    if (!(await uploads.writable()))
      app.log.error({ alarm: "uploads_not_writable" }, "UPLOADS_DIR yazılamıyor; logo/avatar yüklemesi çalışmaz");
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
  return { secrets, netguard, mail, uploads, erasureLedger, accountLimits };
}

/** Sinyalizasyon odaları + P11 (G-13) panel TURN kaydı + oda göstergeleri. */
function decorateRooms(app: FastifyInstance, deps: AppDeps, metrics: Metrics, publicLimits: PublicLimits): Rooms {
  const { env } = deps;
  const sig = deps.signaling ?? {};
  const turn = { urls: env.turnUrls, secret: env.TURN_SECRET, ttlMin: env.TURN_CRED_TTL_MIN };
  const rooms = new Rooms({
    db: deps.db,
    log: app.log,
    turn,
    metrics,
    ...(sig.clock ? { clock: sig.clock } : {}),
    ...(sig.timing ? { timing: sig.timing } : {}),
  });
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
  return rooms;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { env } = deps;
  // B-P10-3: zorunlu 2FA kurulumu production'da kapatılamaz (savunma derinliği; server.ts zaten vermez).
  if (deps.mfaSetupEnforcement === false && env.NODE_ENV === "production")
    throw new Error("mfaSetupEnforcement:false production'da kullanılamaz");
  const app = Fastify({
    loggerInstance: deps.logger ?? createLogger(env.LOG_LEVEL),
    trustProxy: env.TRUSTED_PROXY_CIDR ?? false, // G-11: yalnız Caddy
    genReqId: () => newId(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
  }) as unknown as FastifyInstance;
  addAvSourceGuard(app, env.CLAMAV_ALLOWED_CIDR); // P28b D-r2-1: ilk onRequest kancası
  const core = decorateCore(app, deps);
  const io = decorateIo(app, deps, core.metrics);
  const rooms = decorateRooms(app, deps, core.metrics, core.publicLimits);
  const fsrv = decorateFsrv(app, { db: deps.db, env, secrets: io.secrets, metrics: core.metrics, clock: rooms.clock, test: deps.fsrvTest });
  // P28e (§2): kayıt servisi kök örnekte, `rooms`'tan hemen sonra — talep/resolve rıza teklifi (`rooms.rec`) ve sinyal portu
  // rota kaydından önce hazır olur. Açılış süpürmesi yalnız `startJobs` (paylaşılan test DB'sinde kapalı).
  decorateRec(app, {
    db: deps.db,
    store: fsrv.store,
    secrets: io.secrets,
    metrics: core.metrics,
    clock: rooms.clock,
    rooms,
    sweepOnReady: deps.startJobs === true,
  });
  const w: Wiring = { ...core, ...io, rooms };
  const r = decorateRequests(app, deps, w);
  const jobs = decorateJobs(app, deps, w, r);
  const sig = deps.signaling ?? {};
  const devices = new DeviceHub({ db: deps.db, rooms, metrics: core.metrics, log: app.log, now: () => rooms.clock.now() });
  app.decorate("unattendedHub", devices);
  const deviceChannel = createDeviceChannel(app, devices, {
    ...(sig.pingMs ? { pingMs: sig.pingMs } : {}),
    ...(sig.deviceUnauth ? { unauth: sig.deviceUnauth } : {}),
    ...(sig.deviceBeforeAttach ? { beforeAttach: sig.deviceBeforeAttach } : {}),
  });
  const counts = () => ({ request: r.hub.requestCount, panel: r.hub.panelCount, device: devices.size });
  attachSignaling(app, rooms, sig, requestChannels(app, r.requests, sig.revalidateMs), counts, deviceChannel);
  if (deps.startJobs) {
    addStartupJobs(app, deps.db, { rooms, requests: r.requests, ...jobs, outbox: r.outbox, fsrv });
    startAvPolling(app, fsrv);
  }
  addRequestHooks(app);
  registerRoutes(app, deps, io.uploads);
  return app;
}
