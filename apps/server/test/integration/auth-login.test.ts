import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTenant, createUser, loginRequest, makeApp, testDb, type TestUser } from "../helpers/app.ts";

let app: FastifyInstance;
let user: TestUser;

beforeEach(async () => {
  app = makeApp();
  const t = await createTenant();
  user = await createUser({ tenantId: t.id, role: "USER" });
});
afterEach(() => app.close());

const from = (ip: string) => ({ remoteAddress: ip });
const audits = (userId: string) => testDb().auditLog.findMany({ where: { userId }, orderBy: { id: "asc" } });

describe("login", () => {
  it("AC-64: e-posta veya kullanıcı adıyla giriş; şifre argon2id (m=19456,t=2,p=1) hash'li", async () => {
    const byEmail = await app.inject(loginRequest(user.email.toUpperCase(), user.password));
    expect(byEmail.statusCode).toBe(200);
    expect(byEmail.json()).toMatchObject({ user: { id: user.id, role: "USER" }, mfaRequired: false, mustChangePassword: false });
    const cookies = byEmail.cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly ?? false, sameSite: c.sameSite, secure: c.secure }));
    expect(cookies).toEqual([
      { name: "__Host-rs_session", httpOnly: true, sameSite: "Strict", secure: true },
      { name: "__Host-rs_csrf", httpOnly: false, sameSite: "Strict", secure: true },
    ]);
    expect((await app.inject(loginRequest(user.username, user.password))).statusCode).toBe(200);
    const row = await testDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const session = await testDb().authSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(byEmail.cookies[0]?.value).not.toBe(session.tokenHash);
  });

  it("AC-64: yanlış şifre ve olmayan kullanıcı aynı 401 mesajı; geçersiz girdi 400", async () => {
    const wrong = await app.inject(loginRequest(user.email, "yanlis-sifre-000"));
    const ghost = await app.inject(loginRequest("yok@example.test", "yanlis-sifre-000"));
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(ghost.json().error.message);
    expect(wrong.json().error).toMatchObject({ code: "UNAUTHENTICATED", requestId: expect.any(String) });
    const bad = await app.inject(loginRequest("ab", ""));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({ code: "VALIDATION", fields: { login: expect.any(String), password: expect.any(String) } });
  });

  it("AC-64: pasif kullanıcı ve pasif tenant kullanıcısı giriş yapamaz (genel 401)", async () => {
    const passiveUser = await createUser({ tenantId: user.tenantId, status: "PASSIVE" });
    const pt = await createTenant("PASSIVE");
    const inPassiveTenant = await createUser({ tenantId: pt.id });
    expect((await app.inject(loginRequest(passiveUser.email, passiveUser.password))).statusCode).toBe(401);
    expect((await app.inject(loginRequest(inPassiveTenant.email, inPassiveTenant.password))).statusCode).toBe(401);
  });

  it("AC-65: hesap+IP için 5. hatalı denemede 423; doğru şifre de 15 dk reddedilir; başka IP etkilenmez", async () => {
    for (let i = 1; i <= 4; i++) {
      expect((await app.inject(loginRequest(user.email, "yanlis-sifre-000", from("198.51.100.1")))).statusCode).toBe(401);
    }
    const fifth = await app.inject(loginRequest(user.email, "yanlis-sifre-000", from("198.51.100.1")));
    expect(fifth.statusCode).toBe(423);
    expect(fifth.json().error.code).toBe("ACCOUNT_LOCKED");
    expect(Number(fifth.headers["retry-after"])).toBe(900);
    expect((await app.inject(loginRequest(user.email, user.password, from("198.51.100.1")))).statusCode).toBe(423);
    expect((await app.inject(loginRequest(user.email, user.password, from("198.51.100.2")))).statusCode).toBe(200);

    const rows = await audits(user.id);
    expect(rows.filter((r) => r.action === "auth.login" && r.result === "fail")).toHaveLength(6);
    expect(rows.find((r) => r.action === "auth.locked")?.newValue).toEqual({ scope: "account_ip", minutes: 15 });
    expect(rows.at(-1)).toMatchObject({ action: "auth.login", result: "success", ipAddress: "198.51.100.2" });
  });

  it("AC-65: olmayan hesapta da aynı kilit (varlık sızmaz)", async () => {
    for (let i = 1; i <= 4; i++) await app.inject(loginRequest("yok@example.test", "x-yanlis", from("198.51.100.3")));
    expect((await app.inject(loginRequest("yok@example.test", "x-yanlis", from("198.51.100.3")))).statusCode).toBe(423);
  });

  it("AC-65: IP'den bağımsız 1 saatte 20 hatalı → hesap geneli 15 dk kilit (DB), yeni IP'den de 423", async () => {
    for (let i = 0; i < 19; i++) {
      const ip = `203.0.113.${Math.floor(i / 4) + 10}`; // her IP'de en çok 4 hata (ikili kilidi tetiklenmez)
      expect((await app.inject(loginRequest(user.email, "yanlis-sifre-000", from(ip)))).statusCode).toBe(401);
    }
    const twentieth = await app.inject(loginRequest(user.email, "yanlis-sifre-000", from("203.0.113.99")));
    expect(twentieth.statusCode).toBe(423);
    const row = await testDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect((await app.inject(loginRequest(user.email, user.password, from("192.0.2.200")))).statusCode).toBe(423);
    const locked = (await audits(user.id)).filter((r) => r.action === "auth.locked");
    expect(locked.map((r) => r.newValue)).toContainEqual({ scope: "account", minutes: 15 });
  });

  it("AC-65: IP başına 20 giriş denemesi/dk; 21. deneme 429 + Retry-After", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.inject(loginRequest(`yok${i}@example.test`, "x-yanlis", from("192.0.2.50")));
      expect(res.statusCode).toBe(401);
    }
    const res = await app.inject(loginRequest(user.email, user.password, from("192.0.2.50")));
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
