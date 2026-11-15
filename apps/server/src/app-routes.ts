// Rota kaydı (buildApp'ten; sıra değişmez). Rotalar eklenti olarak kaydedilir (ready'de yüklenir) — AC-69 test aracı
// onRoute ile tüm uçları toplar.
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "./app.ts";
import { authRoutes } from "./auth/routes.ts";
import { superadminRoutes } from "./auth/superadmin-routes.ts";
import type { Env } from "./env.ts";
import { healthRoutes } from "./ops/health.ts";
import { metricsRoutes } from "./ops/metrics.ts";
import { internalAgentRoutes, publicAgentRoutes } from "./public/routes.ts";
import { publicSessionRoutes, sessionRoutes } from "./sessions/routes.ts";
import { publicRequestDownloadRoutes, publicRequestRoutes } from "./requests/public-routes.ts";
import { requestSettingsRoutes, supportRequestRoutes } from "./requests/routes.ts";
import { businessHoursRoutes, holidayRoutes } from "./requests/hours-routes.ts";
import { requestBlockRoutes } from "./requests/block-routes.ts";
import { publicWebRequestRoutes } from "./requests/web-routes.ts";
import { customerRoutes } from "./customers/routes.ts";
import { publicBindingRoutes } from "./bindings/public-routes.ts";
import { userRoutes } from "./users/routes.ts";
import { smtpSettingsRoutes } from "./tenants/smtp-routes.ts";
import { smsSettingsRoutes } from "./tenants/sms-routes.ts";
import { adminTenantRoutes, tenantSettingsRoutes } from "./tenants/routes.ts";
import { auditReadOnlyRoutes, auditRoutes } from "./audit/routes.ts";
import { adminSettingsRoutes, consentTextRoutes } from "./settings/routes.ts";
import { fileRoutes, publicBrandingRoutes } from "./uploads/files.ts";
import { uploadRoutes } from "./uploads/routes.ts";
import type { UploadStore } from "./uploads/store.ts";
import { unattendedRegisterRoutes, unattendedRoutes } from "./unattended/routes.ts";

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
    // P13b (mimari-p13 §7.5, G-19): yalnız remote.noktabilisim.net ve alt alanları; preload yok, apex'e konmaz.
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    crossOriginResourcePolicy: { policy: "same-origin" as const },
    crossOriginOpenerPolicy: { policy: "same-origin" as const },
    referrerPolicy: { policy: "no-referrer" as const },
  };
}

/** Çekirdek eklentiler ve oturum/talep/müşteri uçları (sıra korunur). */
function registerCoreRoutes(app: FastifyInstance, env: Env): void {
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
  void app.register(publicWebRequestRoutes, { prefix: "/api/v1/public/web-requests" });
  void app.register(publicRequestDownloadRoutes, { prefix: "/api/v1/public/agent" });
  void app.register(supportRequestRoutes, { prefix: "/api/v1/support-requests" });
  void app.register(requestSettingsRoutes, { prefix: "/api/v1/settings/support-requests" });
  void app.register(requestBlockRoutes, { prefix: "/api/v1/request-blocks" });
  void app.register(businessHoursRoutes, { prefix: "/api/v1/settings/business-hours" });
  void app.register(holidayRoutes, { prefix: "/api/v1/settings/holidays" });
  void app.register(customerRoutes, { prefix: "/api/v1/customers" });
  void app.register(publicBindingRoutes, { prefix: "/api/v1/public/bindings" });
}

/** Yönetim, ayar, audit ve marka uçları (sıra korunur). */
function registerAdminRoutes(app: FastifyInstance, deps: AppDeps, uploads: UploadStore): void {
  void app.register(userRoutes, { prefix: "/api/v1/users" });
  void app.register(adminTenantRoutes, { prefix: "/api/v1/admin" });
  void app.register(superadminRoutes, { prefix: "/api/v1/admin/superadmins" });
  void app.register(tenantSettingsRoutes, { prefix: "/api/v1/settings/tenant" });
  void app.register(smtpSettingsRoutes, { prefix: "/api/v1/settings/smtp" });
  void app.register(smsSettingsRoutes, { prefix: "/api/v1/settings/sms" });
  void app.register(auditRoutes, { prefix: "/api/v1/audit" });
  void app.register(auditReadOnlyRoutes, { prefix: "/api/v1/audit" });
  void app.register(adminSettingsRoutes, { prefix: "/api/v1/admin/settings", ...(deps.mysqlProbe ? { mysqlProbe: deps.mysqlProbe } : {}) });
  void app.register(consentTextRoutes, { prefix: "/api/v1/settings/consent-text" });
  // P12 marka: yükleme (multipart yalnız bu bağlamda), dosya sunumu, public marka.
  void app.register(uploadRoutes, { prefix: "/api/v1", deps: { db: deps.db, store: uploads, log: app.log } });
  void app.register(fileRoutes, { prefix: "/api/v1", store: uploads });
  void app.register(publicBrandingRoutes, { prefix: "/api/v1/public" });
  // P27 (mimari-p27 §4.2): panel uçları + cihaz kayıt ucu (kimliksiz). K3 `link` (DeviceHub) seçeneğini buraya verir.
  void app.register(unattendedRoutes, { prefix: "/api/v1/unattended" });
  void app.register(unattendedRegisterRoutes, { prefix: "/api/v1/unattended" });
}

/** Tüm eklenti ve rota kayıtları, buildApp'teki sırayla. */
export function registerRoutes(app: FastifyInstance, deps: AppDeps, uploads: UploadStore): void {
  registerCoreRoutes(app, deps.env);
  registerAdminRoutes(app, deps, uploads);
}
