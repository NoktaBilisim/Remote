import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createUser, loginAs, loginStepUp, makeApp } from "../helpers/app.ts";
import { CROSS_TENANT_CASES, ROUTE_CLASSES, collectRoutes, idsOf, twoTenants, type TwoTenants } from "../helpers/tenant-matrix.ts";

let app: FastifyInstance;
let routes: string[];
let fx: TwoTenants;

beforeAll(async () => {
  app = makeApp();
  routes = collectRoutes(app);
  await app.ready();
  fx = await twoTenants();
});
afterAll(() => app.close());

describe("tenant izolasyonu (AC-69 test aracı)", () => {
  it("AC-69: uygulamadaki her uç sınıflandırılmış (sınıfsız uç eklenemez)", () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !(r in ROUTE_CLASSES))).toEqual([]);
    for (const c of CROSS_TENANT_CASES) expect(ROUTE_CLASSES[c.route]).toBe("tenant");
    const tenantRoutes = routes.filter((r) => ROUTE_CLASSES[r] === "tenant");
    expect(tenantRoutes.filter((r) => !CROSS_TENANT_CASES.some((c) => c.route === r))).toEqual([]);
  });

  it("AC-69: oturumlu GET 'self' uçlarında B kullanıcısının yanıtı A tenant'ına ait hiçbir kimlik içermez", async () => {
    const selfGets = routes.filter((r) => ROUTE_CLASSES[r] === "self" && r.startsWith("GET "));
    expect(selfGets).toContain("GET /api/v1/auth/me");
    for (const who of [fx.b.admin, fx.b.user]) {
      const s = await loginAs(app, who);
      for (const route of selfGets) {
        const res = await app.inject({ method: "GET", url: route.slice(4), headers: s.headers });
        expect(res.statusCode, route).toBe(200);
        for (const id of idsOf(fx.a)) expect(res.body, `${route} sızdırdı`).not.toContain(id);
        expect(res.body).toContain(fx.b.tenantId);
      }
    }
  });

  it("AC-69/AC-61: 'list' uçlarında B yalnız kendi tenant kaydını görür, A'nın hiçbir kimliği yok", async () => {
    const lists = routes.filter((r) => ROUTE_CLASSES[r] === "list");
    expect(lists).toContain("GET /api/v1/sessions");
    for (const who of [fx.b.admin, fx.b.user]) {
      const s = await loginAs(app, who);
      for (const route of lists) {
        const res = await app.inject({ method: "GET", url: route.slice(4), headers: s.headers });
        expect(res.statusCode, route).toBe(200);
        for (const id of idsOf(fx.a)) expect(res.body, `${route} sızdırdı`).not.toContain(id);
        expect(res.body).toContain(fx.b.sessionId);
      }
    }
  });

  it("AC-69: tenant kaydı hedefleyen uçlarda B → A kaydı 404", async () => {
    const s = await loginAs(app, fx.b.admin);
    // P16: step-up isteyen uçlar için B firmasında ayrı (sahte TOTP'li) Admin — fx.b.admin'in 2FA durumu değişmez.
    const su = await loginStepUp(app, await createUser({ tenantId: fx.b.tenantId, role: "ADMIN" }));
    for (const c of CROSS_TENANT_CASES) {
      const req = c.request(fx);
      const res = await app.inject({ ...req, headers: { ...(c.stepUp ? su : s).headers, ...(req.headers ?? {}) } });
      expect(res.statusCode, c.route).toBe(404);
    }
  });

  it("AC-70/AC-69: sistem uçları (/admin/*) yalnız SUPER_ADMIN — tenant Admin'i ve User 403", async () => {
    const system = routes.filter((r) => ROUTE_CLASSES[r] === "system");
    expect(system.length).toBeGreaterThanOrEqual(7);
    for (const who of [fx.b.admin, fx.b.user]) {
      const s = await loginAs(app, who);
      for (const route of system) {
        const [method, path] = route.split(" ") as [string, string];
        const url = path.replace(":id", fx.a.tenantId);
        const res = await app.inject({ method: method as "GET", url, headers: s.headers, ...(method === "GET" ? {} : { payload: {} }) });
        expect(res.statusCode, route).toBe(403);
      }
    }
  });
});
