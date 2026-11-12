// AC-69 test aracı (mimari §5.1, §9): uygulamadaki TÜM uçları onRoute ile toplar; her uç burada
// sınıflandırılmak zorundadır (sınıfsız uç → test kırmızı). Sınıflar:
//  - public: kimliksiz (ops, login, public müşteri uçları)
//  - self:   oturumlu ama tenant kaydı hedeflemeyen uç → B kullanıcısının yanıtında A tenant'ının hiçbir id'si olmamalı
//  - tenant: tenant kaydı hedefleyen uç → CROSS_TENANT_CASES'te A'nın kaydına B ile istek = 404
//  - list:   tenant kayıtlarını listeleyen GET → B'nin yanıtı kendi kaydını içerir, A'nınkini içermez
// Yeni paket uç eklediğinde ROUTE_CLASSES + (tenant ise) CROSS_TENANT_CASES'e satır ekler.
import type { FastifyInstance, InjectOptions } from "fastify";
import { createSupportSessionRow, createTenant, createUser, type TestUser } from "./app.ts";
import { createCustomerRow, createRequestRow } from "./requests.ts";

// P8b: "scoped" = tenantScope'lu koleksiyon/ayar ucu (id'siz); izolasyonu requests-p8b.test.ts ("AC-147/148") ve
// requests-p8b-5.test.ts ("AC-147", "AC-148: Super Admin", "AC-129") test eder.
// P9: "system" = yalnız SUPER_ADMIN (/admin/*); tenant kullanıcısı (ADMIN dahil) → 403 (tenant-isolation.test.ts).
export type RouteClass = "public" | "self" | "tenant" | "list" | "scoped" | "system";

export const ROUTE_CLASSES: Record<string, RouteClass> = {
  "GET /health": "public",
  "GET /ready": "public",
  "POST /api/v1/auth/login": "public",
  "POST /api/v1/auth/logout": "self",
  "POST /api/v1/auth/password/change": "self",
  "GET /api/v1/auth/me": "self",
  // P10 (AC-66..68): kendi hesabı / public sıfırlama; SMTP testi ve e-posta kanal testi tenantScope'lu
  "POST /api/v1/auth/mfa/verify": "self",
  "POST /api/v1/auth/mfa/setup": "self",
  "POST /api/v1/auth/mfa/enable": "self",
  "POST /api/v1/auth/logout-all": "self",
  "POST /api/v1/auth/password/forgot": "public",
  "POST /api/v1/auth/password/reset": "public",
  "POST /api/v1/settings/smtp/test": "scoped",
  "POST /api/v1/settings/support-requests/email/test": "scoped",
  "POST /api/v1/sessions/:id/email": "tenant",
  "POST /api/v1/users/:id/reset-mfa": "tenant",
  // P2
  "POST /api/v1/sessions": "self",
  "GET /api/v1/sessions": "list",
  "GET /api/v1/sessions/:id": "tenant",
  "POST /api/v1/sessions/:id/cancel": "tenant",
  "POST /api/v1/public/sessions/resolve": "public",
  "GET /api/v1/public/sessions/status": "public",
  // P3
  "GET /metrics": "public",
  "POST /api/v1/sessions/:id/terminate": "tenant",
  "POST /api/v1/public/sessions/join": "public",
  // P6
  "GET /api/v1/public/agent/download": "public",
  // P6 düzeltme 1 (S6-2): Caddy forward_auth iç ucu; yalnız güvenilen proxy soketinden, tenant verisi yok
  "GET /internal/agent-ready": "public",
  // P8 oturum geçmişi (historyScope)
  "GET /api/v1/sessions/export.csv": "list",
  "GET /api/v1/sessions/:id/history": "tenant",
  "PATCH /api/v1/sessions/:id": "tenant",
  // P8b-1 destek talepleri
  "GET /api/v1/public/requests/tenant": "public",
  "POST /api/v1/public/requests": "public",
  "POST /api/v1/public/requests/cancel": "public",
  "GET /api/v1/public/agent/request-download": "public",
  "GET /api/v1/support-requests": "scoped",
  "GET /api/v1/support-requests/count": "scoped",
  "GET /api/v1/support-requests/:id": "tenant",
  "POST /api/v1/support-requests/:id/accept": "tenant",
  "POST /api/v1/support-requests/:id/reject": "tenant",
  "GET /api/v1/settings/support-requests": "scoped",
  "PUT /api/v1/settings/support-requests": "scoped",
  "POST /api/v1/settings/support-requests/rotate-ref": "scoped",
  "POST /api/v1/settings/support-requests/whatsapp/test": "scoped",
  // P8c-1 müşteriler + cihaz kaydı (koleksiyon uçlarının izolasyonu: customers-p8c-api.test.ts "AC-172")
  "POST /api/v1/support-requests/:id/revoke-binding": "tenant",
  "GET /api/v1/customers": "scoped",
  "GET /api/v1/customers/general-link": "scoped",
  "GET /api/v1/customers/options": "scoped",
  "POST /api/v1/customers": "scoped",
  "GET /api/v1/customers/:id": "tenant",
  "PATCH /api/v1/customers/:id": "tenant",
  "POST /api/v1/customers/:id/rotate-ref": "tenant",
  "POST /api/v1/customers/:id/deactivate": "tenant",
  "POST /api/v1/customers/:id/reactivate": "tenant",
  "GET /api/v1/customers/:id/requests": "tenant",
  "GET /api/v1/customers/:id/sessions": "tenant",
  "POST /api/v1/public/bindings/status": "public",
  "POST /api/v1/public/bindings/revoke": "public",
  // P9 kullanıcı/yetki/firma yönetimi (koleksiyon izolasyonu: users-p9.test.ts "AC-69")
  "GET /api/v1/users": "scoped",
  "POST /api/v1/users": "scoped",
  "GET /api/v1/users/:id": "tenant",
  "PATCH /api/v1/users/:id": "tenant",
  "POST /api/v1/users/:id/deactivate": "tenant",
  "POST /api/v1/users/:id/reactivate": "tenant",
  "GET /api/v1/settings/tenant": "scoped",
  "PUT /api/v1/settings/tenant": "scoped",
  "GET /api/v1/admin/tenants": "system",
  "POST /api/v1/admin/tenants": "system",
  "GET /api/v1/admin/tenants/:id": "system",
  "PATCH /api/v1/admin/tenants/:id": "system",
  "POST /api/v1/admin/tenants/:id/deactivate": "system",
  "POST /api/v1/admin/tenants/:id/reactivate": "system",
  "POST /api/v1/admin/switch-tenant": "system",
};

export interface TwoTenants {
  a: { tenantId: string; admin: TestUser; user: TestUser; sessionId: string; requestId: string; customerId: string };
  b: { tenantId: string; admin: TestUser; user: TestUser; sessionId: string; requestId: string; customerId: string };
}

export interface CrossTenantCase {
  route: string;
  /** B kullanıcısıyla, A tenant'ının kaydını hedefleyen istek. */
  request: (fx: TwoTenants) => InjectOptions;
}

export const CROSS_TENANT_CASES: CrossTenantCase[] = [
  { route: "GET /api/v1/sessions/:id", request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}` }) },
  { route: "POST /api/v1/sessions/:id/cancel", request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/cancel` }) },
  { route: "POST /api/v1/sessions/:id/terminate", request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/terminate` }) },
  { route: "GET /api/v1/sessions/:id/history", request: (fx) => ({ method: "GET", url: `/api/v1/sessions/${fx.a.sessionId}/history` }) },
  { route: "PATCH /api/v1/sessions/:id", request: (fx) => ({ method: "PATCH", url: `/api/v1/sessions/${fx.a.sessionId}`, payload: { note: "x" } }) },
  { route: "GET /api/v1/support-requests/:id", request: (fx) => ({ method: "GET", url: `/api/v1/support-requests/${fx.a.requestId}` }) },
  { route: "POST /api/v1/support-requests/:id/accept", request: (fx) => ({ method: "POST", url: `/api/v1/support-requests/${fx.a.requestId}/accept`, payload: {} }) },
  { route: "POST /api/v1/support-requests/:id/revoke-binding", request: (fx) => ({ method: "POST", url: `/api/v1/support-requests/${fx.a.requestId}/revoke-binding`, payload: {} }) },
  ...(["GET /api/v1/customers/:id", "GET /api/v1/customers/:id/requests", "GET /api/v1/customers/:id/sessions"] as const).map((route) => ({
    route,
    request: (fx: TwoTenants): InjectOptions => ({ method: "GET", url: route.slice(4).replace(":id", fx.a.customerId) }),
  })),
  { route: "PATCH /api/v1/customers/:id", request: (fx) => ({ method: "PATCH", url: `/api/v1/customers/${fx.a.customerId}`, payload: { note: "x" } }) },
  ...(["rotate-ref", "deactivate", "reactivate"] as const).map((a) => ({
    route: `POST /api/v1/customers/:id/${a}`,
    request: (fx: TwoTenants): InjectOptions => ({ method: "POST", url: `/api/v1/customers/${fx.a.customerId}/${a}`, payload: {} }),
  })),
  // P9: A tenant'ının kullanıcısını B Admin'i hedefler → 404
  { route: "GET /api/v1/users/:id", request: (fx) => ({ method: "GET", url: `/api/v1/users/${fx.a.user.id}` }) },
  { route: "PATCH /api/v1/users/:id", request: (fx) => ({ method: "PATCH", url: `/api/v1/users/${fx.a.user.id}`, payload: { fullName: "Başka Firma" } }) },
  // P10: başka tenant'ın oturumu / kullanıcısı → 404
  { route: "POST /api/v1/sessions/:id/email", request: (fx) => ({ method: "POST", url: `/api/v1/sessions/${fx.a.sessionId}/email`, payload: { to: "x@example.test", link: "https://x.test/session/y" } }) },
  ...(["deactivate", "reactivate", "reset-mfa"] as const).map((a) => ({
    route: `POST /api/v1/users/:id/${a}`,
    request: (fx: TwoTenants): InjectOptions => ({ method: "POST", url: `/api/v1/users/${fx.a.user.id}/${a}`, payload: {} }),
  })),
  { route: "POST /api/v1/support-requests/:id/reject", request: (fx) => ({ method: "POST", url: `/api/v1/support-requests/${fx.a.requestId}/reject`, payload: { message: "Şu an müsait değiliz" } }) },
];

/** buildApp sonrası, ready'den ÖNCE çağrılmalı (rotalar eklentilerde ready'de yüklenir). */
export function collectRoutes(app: FastifyInstance): string[] {
  const routes: string[] = [];
  app.addHook("onRoute", (r) => {
    for (const m of [r.method].flat()) if (m !== "HEAD") routes.push(`${m} ${r.url}`);
  });
  return routes;
}

export async function twoTenants(): Promise<TwoTenants> {
  const side = async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const user = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true, "session_history.view": true, "session_history.export": true } });
    const session = await createSupportSessionRow({ tenantId: t.id, technicianId: user.id });
    const request = await createRequestRow(t.id); // P8b
    const customer = await createCustomerRow(t.id); // P8c
    return { tenantId: t.id, admin, user, sessionId: session.id, requestId: request.id, customerId: customer.id };
  };
  return { a: await side(), b: await side() };
}

/** A tarafının yanıtta görünmemesi gereken kimlikleri. */
export const idsOf = (s: TwoTenants["a"]): string[] => [s.tenantId, s.admin.id, s.user.id, s.admin.email, s.user.email, s.sessionId];
