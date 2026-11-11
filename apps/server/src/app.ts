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
import { createLogger } from "./lib/logger.ts";
import { healthRoutes } from "./ops/health.ts";
import { createMetrics, metricsRoutes, type Metrics } from "./ops/metrics.ts";
import { endOrphanedActive } from "./sessions/service.ts";
import { Rooms } from "./signaling/rooms.ts";
import type { Clock, Timing } from "./signaling/types.ts";
import { attachSignaling, type SignalingOptions } from "./signaling/ws.ts";
import { startScheduler, type Scheduler } from "./jobs/scheduler.ts";
import { refKeyFrom } from "./sessions/codes.ts";
import { closePublicLimits, createPublicLimits, type PublicLimits } from "./sessions/public.ts";
import { publicSessionRoutes, sessionRoutes } from "./sessions/routes.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    env: Env;
    authLimits: AuthLimits;
    publicLimits: PublicLimits;
    sessionRefKey: string;
    rooms: Rooms;
    metrics: Metrics;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    allowPasswordChangePending?: boolean;
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
  const app = Fastify({
    loggerInstance: deps.logger ?? createLogger(env.LOG_LEVEL),
    trustProxy: env.TRUSTED_PROXY_CIDR ?? false, // G-11: yalnız Caddy
    genReqId: () => newId(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
  }) as unknown as FastifyInstance;

  app.decorate("db", deps.db);
  app.decorate("env", env);
  const authLimits = deps.authLimits ?? createAuthLimits();
  app.decorate("authLimits", authLimits);
  app.addHook("onClose", async () => closeAuthLimits(authLimits));
  const publicLimits = createPublicLimits(app.log, env.TRUSTED_PROXY_CIDR);
  app.decorate("publicLimits", publicLimits);
  app.decorate("sessionRefKey", refKeyFrom(env.SESSION_REF_KEY));
  app.addHook("onClose", async () => closePublicLimits(publicLimits));
  const metrics = createMetrics();
  app.decorate("metrics", metrics);
  const sig = deps.signaling ?? {};
  const turn = { urls: env.turnUrls, secret: env.TURN_SECRET, ttlMin: env.TURN_CRED_TTL_MIN };
  const rooms = new Rooms({ db: deps.db, log: app.log, turn, metrics, ...(sig.clock ? { clock: sig.clock } : {}), ...(sig.timing ? { timing: sig.timing } : {}) });
  app.decorate("rooms", rooms);
  metrics.gauge("rs_active_rooms", "Bellekteki oda sayısı", () => rooms.size);
  metrics.gauge("rs_active_sessions", "Admit edilmiş (ACTIVE) oturum sayısı", () => rooms.activeCount);
  metrics.gauge("rs_resolve_failed", "Başarısız kod çözümleme (süreç başından beri)", () => publicLimits.resolveFailed.total);
  attachSignaling(app, rooms, sig);
  if (deps.startJobs) {
    let jobs: Scheduler | undefined;
    app.addHook("onReady", async () => {
      // Bellekteki odası olmayan ACTIVE oturumlar (yeniden başlatma) → ENDED{server} (mimari §3.5).
      const orphaned = await endOrphanedActive(deps.db, new Date());
      if (orphaned > 0) app.log.warn({ ended: orphaned }, "yeniden başlatma: etkin oturumlar sonlandırıldı");
      jobs = startScheduler(deps.db, app.log, rooms);
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
  return app;
}
