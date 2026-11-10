// Düzeltme turu 1 (QA-1/2/4, S1-2/3/5/6/8/10) entegrasyon testleri.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { ORIGIN, createTenant, createUser, loginAs, loginRequest, makeApp, testDb, type TestUser } from "../helpers/app.ts";

let app: FastifyInstance;
let tenantId: string;
let user: TestUser;

beforeEach(async () => {
  app = makeApp();
  tenantId = (await createTenant()).id;
  user = await createUser({ tenantId });
});
afterEach(() => app.close());

const wrong = (login: string, ip: string) => app.inject(loginRequest(login, "yanlis-sifre-000", { remoteAddress: ip }));
const audits = (userId: string, action: string) => testDb().auditLog.findMany({ where: { userId, action } });
const shape = (r: LightMyRequestResponse) => ({ status: r.statusCode, error: { ...r.json().error, requestId: undefined } });

describe("eşzamanlı kilit sayaçları", () => {
  it("AC-65: aynı hesap+IP'den 10 paralel hatalı deneme → tam 5 deneme doğrulanır, kilit tek kez", async () => {
    const res = await Promise.all(Array.from({ length: 10 }, () => wrong(user.email, "198.51.100.40")));
    expect(res.filter((r) => r.statusCode === 401)).toHaveLength(4);
    expect(res.filter((r) => r.statusCode === 423)).toHaveLength(6);
    const fails = (await audits(user.id, "auth.login")).filter((r) => (r.newValue as { reason?: string }).reason === "invalid_credentials");
    expect(fails).toHaveLength(5);
    expect(await audits(user.id, "auth.locked")).toHaveLength(1);
  });

  it("AC-65: farklı IP'lerden 25 paralel hatalı deneme → hesap geneli kilit (atomik sayaç)", async () => {
    await Promise.all(Array.from({ length: 25 }, (_v, i) => wrong(user.email, `203.0.113.${i + 1}`)));
    const row = await testDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const locks = (await audits(user.id, "auth.locked")).map((r) => r.newValue);
    expect(locks).toEqual([{ scope: "account", minutes: 15 }]);
    expect((await app.inject(loginRequest(user.email, user.password, { remoteAddress: "192.0.2.77" }))).statusCode).toBe(423);
  });

  it("AC-65: hesap geneli kilit var olan ve olmayan hesapta aynı (durum + gövde), çok IP", async () => {
    const ghost = "hic-yok@example.test";
    const run = async (login: string, net: number) => {
      let last: LightMyRequestResponse | undefined;
      for (let i = 0; i < 20; i++) last = await wrong(login, `10.${net}.${Math.floor(i / 4)}.1`);
      const after = await wrong(login, `10.${net}.99.1`);
      return [shape(last as LightMyRequestResponse), shape(after)];
    };
    const real = await run(user.email, 1);
    const fake = await run(ghost, 2);
    expect(real[0]?.status).toBe(423);
    expect(fake).toEqual(real);
  });
});

describe("giriş araması ve oturumlar", () => {
  it("AC-64: '@' içeren girdi yalnız e-posta ile aranır (kullanıcı adı çakışması etkisiz)", async () => {
    const other = await createUser({ tenantId });
    await testDb().user.update({ where: { id: other.id }, data: { username: user.email } });
    const res = await app.inject(loginRequest(user.email, user.password));
    expect(res.json().user.id).toBe(user.id);
    expect((await app.inject(loginRequest(other.username, other.password))).statusCode).toBe(401);
  });

  it("AC-65: yeni giriş aynı tarayıcının eski oturumunu iptal eder", async () => {
    const old = await loginAs(app, user);
    const res = await app.inject(loginRequest(user.email, user.password, { headers: { origin: ORIGIN, cookie: old.headers.cookie } }));
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: old.headers.cookie } })).statusCode).toBe(401);
  });

  it("AC-65: gövdesiz application/json logout 204; CSRF hatasında 403 + çerezler temizlenir, oturum kalır", async () => {
    const s = await loginAs(app, user);
    const bad = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: s.headers.cookie, origin: ORIGIN } });
    expect(bad.statusCode).toBe(403);
    expect(bad.cookies.map((c) => [c.name, c.value])).toEqual([["__Host-rs_session", ""], ["__Host-rs_csrf", ""]]);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: s.headers.cookie } })).statusCode).toBe(200);
    const ok = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { ...s.headers, "content-type": "application/json" } });
    expect(ok.statusCode).toBe(204);
  });
});

describe("şifre değişimi", () => {
  const change = (headers: Record<string, string>, current: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/password/change", headers, payload: { current, next: "Yeni-Sifre-12345" } });
  const me = (cookie: string) => app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });

  it("AC-66: başarılı değişim tüm oturumları iptal eder; mevcut oturum yeni token + CSRF ile yenilenir (S2-2)", async () => {
    const other = await loginAs(app, user);
    const current = await loginAs(app, user);
    const res = await change(current.headers, user.password);
    expect(res.statusCode).toBe(204);
    const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
    expect(jar["__Host-rs_session"]).toBeTruthy();
    expect(jar["__Host-rs_csrf"]).toBeTruthy();
    expect(jar["__Host-rs_session"]).not.toBe(current.token);
    expect((await me(other.headers.cookie)).statusCode).toBe(401);
    expect((await me(current.headers.cookie)).statusCode).toBe(401);
    const fresh = `__Host-rs_session=${jar["__Host-rs_session"]}; __Host-rs_csrf=${jar["__Host-rs_csrf"]}`;
    expect((await me(fresh)).statusCode).toBe(200);
    const [oldRow, newRow] = await Promise.all([
      testDb().authSession.findFirstOrThrow({ where: { userId: user.id, revokedAt: { not: null } }, orderBy: { createdAt: "desc" } }),
      testDb().authSession.findFirstOrThrow({ where: { userId: user.id, revokedAt: null } }),
    ]);
    expect(newRow.expiresAt.getTime()).toBeLessThanOrEqual(oldRow.expiresAt.getTime());
  });

  it("AC-66: oturum başına 5 hatalı mevcut şifre → oturum iptal + 401", async () => {
    const s = await loginAs(app, user);
    for (let i = 0; i < 4; i++) expect((await change(s.headers, "yanlis")).statusCode).toBe(400);
    const fifth = await change(s.headers, "yanlis");
    expect(fifth.statusCode).toBe(401);
    expect((await me(s.headers.cookie)).statusCode).toBe(401);
    expect((await audits(user.id, "auth.password_change")).at(-1)?.newValue).toEqual({ reason: "too_many_attempts" });
  });
});
