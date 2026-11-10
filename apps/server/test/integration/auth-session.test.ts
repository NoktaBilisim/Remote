import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { requireAuth, requirePerm, tenantScope } from "../../src/auth/guards.ts";
import { ORIGIN, createTenant, createUser, loginAs, loginRequest, makeApp, testDb, type TestUser } from "../helpers/app.ts";

let app: FastifyInstance;
let tenantId: string;

beforeEach(async () => {
  app = makeApp();
  // Yalnız test için: guard zincirini gerçek bir uçta denemek (P1'de yetkili uç yok).
  app.get("/api/v1/__test/users", { preHandler: [requireAuth, requirePerm("users.view")] }, async (req) => tenantScope(req));
  tenantId = (await createTenant()).id;
});
afterEach(() => app.close());

const me = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/api/v1/auth/me", headers });
const probe = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/api/v1/__test/users", headers });

describe("oturum + CSRF", () => {
  it("AC-64: /auth/me oturumla döner, oturumsuz 401", async () => {
    const u = await createUser({ tenantId, role: "ADMIN" });
    const s = await loginAs(app, u);
    const res = await me({ cookie: s.headers.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { id: u.id, role: "ADMIN" }, tenant: { id: tenantId }, actingTenant: null });
    expect(res.json().permissions).toContain("users.view");
    expect((await me({})).statusCode).toBe(401);
    expect((await me({ cookie: "__Host-rs_session=uydurma" })).json().error.code).toBe("UNAUTHENTICATED");
  });

  it("AC-65: logout CSRF başlığı ister; başarılı logout oturumu iptal eder ve audit'e yazar", async () => {
    const u = await createUser({ tenantId });
    const s = await loginAs(app, u);
    const logout = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/api/v1/auth/logout", headers });
    expect((await logout({ cookie: s.headers.cookie, origin: ORIGIN })).json().error.code).toBe("CSRF_INVALID");
    expect((await logout({ ...s.headers, "x-csrf-token": "baska" })).statusCode).toBe(403);
    expect((await logout({ ...s.headers, origin: "https://kotu.example" })).statusCode).toBe(403);
    expect((await logout({ cookie: s.headers.cookie, "x-csrf-token": s.headers["x-csrf-token"] })).statusCode).toBe(403);
    expect((await logout(s.headers)).statusCode).toBe(204);
    expect((await me({ cookie: s.headers.cookie })).statusCode).toBe(401);
    const row = await testDb().auditLog.findFirst({ where: { userId: u.id, action: "auth.logout" } });
    expect(row).toMatchObject({ result: "success", entity: "auth_sessions", tenantId });
  });

  it("AC-65: login Origin olmadan veya izinsiz Origin'le 403 (login CSRF)", async () => {
    const u = await createUser({ tenantId });
    expect((await app.inject(loginRequest(u.email, u.password, { headers: {} }))).statusCode).toBe(403);
    expect((await app.inject(loginRequest(u.email, u.password, { headers: { origin: "https://kotu.example" } }))).statusCode).toBe(403);
  });

  it("AC-68: 30 dk boşta veya mutlak süresi dolmuş oturum 401", async () => {
    const u = await createUser({ tenantId });
    const s = await loginAs(app, u);
    await testDb().authSession.updateMany({ where: { userId: u.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await me({ cookie: s.headers.cookie })).statusCode).toBe(401);
    const s2 = await loginAs(app, u);
    await testDb().authSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me({ cookie: s2.headers.cookie })).statusCode).toBe(401);
  });
});

describe("ilk giriş şifre değişimi", () => {
  const change = (s: { headers: Record<string, string> }, payload: Record<string, string>) =>
    app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers: s.headers, payload });

  it("AC-66: must_change_password iken yalnız me/logout/password/change serbest; değişimden sonra erişim açılır", async () => {
    const u = await createUser({ tenantId, role: "ADMIN", mustChangePassword: true });
    const s = await loginAs(app, u);
    expect((await me({ cookie: s.headers.cookie })).json().user.mustChangePassword).toBe(true);
    const blocked = await probe(s.headers);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    expect((await change(s, { current: "yanlis", next: "Yeni-Sifre-12345" })).json().error.fields).toEqual({ current: expect.any(String) });
    expect((await change(s, { current: u.password, next: "kisa" })).json().error.fields).toEqual({ next: expect.any(String) });
    expect((await change(s, { current: u.password, next: u.password })).statusCode).toBe(400);
    const changed = await change(s, { current: u.password, next: "Yeni-Sifre-12345" });
    expect(changed.statusCode).toBe(204);
    const jar = Object.fromEntries(changed.cookies.map((c) => [c.name, c.value]));
    const fresh = { ...s.headers, cookie: `__Host-rs_session=${jar["__Host-rs_session"]}; __Host-rs_csrf=${jar["__Host-rs_csrf"]}` };
    expect((await probe(fresh)).statusCode).toBe(200);
    expect((await app.inject(loginRequest(u.email, "Yeni-Sifre-12345", { remoteAddress: "192.0.2.9" }))).json().mustChangePassword).toBe(false);
    const rows = await testDb().auditLog.findMany({ where: { userId: u.id, action: "auth.password_change" } });
    expect(rows.map((r) => r.result).sort()).toEqual(["fail", "success"]);
  });
});

describe("requirePerm + tenantScope", () => {
  async function probeAs(user: TestUser) {
    return probe((await loginAs(app, user)).headers);
  }

  it("AC-73: USER varsayılan kapalı → 403; açılan yetkiyle 200; ADMIN'de kapatılan yetki 403", async () => {
    expect((await probeAs(await createUser({ tenantId }))).json().error.code).toBe("FORBIDDEN");
    const granted = await probeAs(await createUser({ tenantId, perms: { "users.view": true } }));
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toEqual({ tenantId });
    expect((await probeAs(await createUser({ tenantId, role: "ADMIN" }))).statusCode).toBe(200);
    expect((await probeAs(await createUser({ tenantId, role: "ADMIN", perms: { "users.view": false } }))).statusCode).toBe(403);
  });

  it("AC-69: Super Admin tenant seçmeden tenant kapsamlı uca erişemez (403)", async () => {
    const res = await probeAs(await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    expect(res.statusCode).toBe(403);
  });
});
