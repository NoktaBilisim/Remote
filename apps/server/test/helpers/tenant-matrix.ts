// AC-69 test aracı (mimari §5.1, §9): uygulamadaki TÜM uçları onRoute ile toplar; her uç burada
// sınıflandırılmak zorundadır (sınıfsız uç → test kırmızı). Sınıflar:
//  - public: kimliksiz (ops, login, public müşteri uçları)
//  - self:   oturumlu ama tenant kaydı hedeflemeyen uç → B kullanıcısının yanıtında A tenant'ının hiçbir id'si olmamalı
//  - tenant: tenant kaydı hedefleyen uç → CROSS_TENANT_CASES'te A'nın kaydına B ile istek = 404
//  - list:   tenant kayıtlarını listeleyen GET → B'nin yanıtı kendi kaydını içerir, A'nınkini içermez
// Yeni paket uç eklediğinde ROUTE_CLASSES + (tenant ise) CROSS_TENANT_CASES'e satır ekler.
import type { FastifyInstance, InjectOptions } from "fastify";
import { createSupportSessionRow, createTenant, createUser, type TestUser } from "./app.ts";

export type RouteClass = "public" | "self" | "tenant" | "list";

export const ROUTE_CLASSES: Record<string, RouteClass> = {
  "GET /health": "public",
  "GET /ready": "public",
  "POST /api/v1/auth/login": "public",
  "POST /api/v1/auth/logout": "self",
  "POST /api/v1/auth/password/change": "self",
  "GET /api/v1/auth/me": "self",
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
};

export interface TwoTenants {
  a: { tenantId: string; admin: TestUser; user: TestUser; sessionId: string };
  b: { tenantId: string; admin: TestUser; user: TestUser; sessionId: string };
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
    const user = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
    const session = await createSupportSessionRow({ tenantId: t.id, technicianId: user.id });
    return { tenantId: t.id, admin, user, sessionId: session.id };
  };
  return { a: await side(), b: await side() };
}

/** A tarafının yanıtta görünmemesi gereken kimlikleri. */
export const idsOf = (s: TwoTenants["a"]): string[] => [s.tenantId, s.admin.id, s.user.id, s.admin.email, s.user.email, s.sessionId];
