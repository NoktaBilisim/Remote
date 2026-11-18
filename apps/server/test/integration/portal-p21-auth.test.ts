// P21 K3 — portal kimliği: giriş, kilit/hız, geçici şifre, şifre değişimi, isteğe bağlı TOTP, panel ↔ portal çerez ayrımı
// (mimari-p21 §5.1–5.2, §10; ADR-0039; AC-262; r2 S-P21-2/3/5/7/9). Gerçek MySQL + fastify.inject.
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE, PORTAL_TENANT_COOKIE, type PortalMe } from "@remote/contracts/api/portal";
import { PORTAL_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aadFor } from "../../src/lib/crypto.ts";
import { createTenant, createUser, loginAs, makeApp, ORIGIN, testDb } from "../helpers/app.ts";
import {
  createPortalUser,
  enableTotpRow,
  nextIp,
  PORTAL_ENV,
  portalLoginAs,
  portalLoginReq,
  sessionOf,
  totpAt,
  type TestPortalUser,
} from "../helpers/portal.ts";
import { createCustomerRow } from "../helpers/requests.ts";

let app: FastifyInstance;
const db = testDb;
const errOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string; message: string; fields?: Record<string, string> } }>().error;

beforeAll(async () => {
  app = makeApp({ env: PORTAL_ENV });
  await app.ready();
});
afterAll(() => app.close());

async function fixture(o: Partial<Parameters<typeof createPortalUser>[0]> = {}) {
  const t = await createTenant();
  const c = await createCustomerRow(t.id);
  const u = await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c.id, ...o });
  return { t, c, u };
}
const login = (u: TestPortalUser, ip = nextIp(), extra: { password?: string; totpCode?: string; email?: string; slug?: string } = {}) =>
  portalLoginReq(
    app,
    {
      email: extra.email ?? u.email,
      tenantSlug: extra.slug ?? u.slug,
      password: extra.password ?? u.password,
      ...(extra.totpCode ? { totpCode: extra.totpCode } : {}),
    },
    { ip },
  );

async function lastAudit(entityId: string, action: string) {
  return db().auditLog.findFirst({ where: { entityId, action }, orderBy: { id: "desc" } });
}

describe("AC-262 portal girişi", () => {
  it("AC-262: doğru → 200 PortalMe + iki __Host- çerezi (Secure, SameSite=Strict, HttpOnly yalnız oturumda) + rs_portal_tenant", async () => {
    const { t, c, u } = await fixture();
    const res = await login(u);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const me = res.json<PortalMe>();
    expect(me.user).toMatchObject({ id: u.id, email: u.email, mustChangePassword: false, totpEnabled: false });
    expect(me.customer.name).toBe(c.name);
    expect(me.provider.name).toBe(t.name);
    const sess = res.cookies.find((x) => x.name === PORTAL_SESSION_COOKIE);
    const csrf = res.cookies.find((x) => x.name === PORTAL_CSRF_COOKIE);
    expect(sess).toMatchObject({ secure: true, sameSite: "Strict", httpOnly: true, path: "/" });
    expect(csrf).toMatchObject({ secure: true, sameSite: "Strict", path: "/" });
    expect(csrf?.httpOnly).toBeFalsy();
    expect(res.cookies.find((x) => x.name === PORTAL_TENANT_COOKIE)?.value).toBe(t.slug);
    expect(res.cookies.some((x) => x.name === SESSION_COOKIE)).toBe(false);
    const a = await lastAudit(u.id, PORTAL_AUDIT.LOGIN);
    expect(a).toMatchObject({ userId: null, username: u.email, entity: "portal_users", result: "success", tenantId: t.id });
    expect((await db().portalUser.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).not.toBeNull();
  });

  it("AC-262: yanlış şifre / olmayan e-posta / bilinmeyen kısa ad → aynı 401 metni; olmayan hesap audit'i entity_id NULL", async () => {
    const { u } = await fixture();
    const wrong = await login(u, nextIp(), { password: "Yanlis-Sifre-123" });
    const ghost = await login(u, nextIp(), { email: `yok-${u.id.toLowerCase()}@example.test` });
    const noSlug = await login(u, nextIp(), { slug: "olmayan-firma-kisa" });
    for (const r of [wrong, ghost, noSlug]) {
      expect(r.statusCode).toBe(401);
      expect(errOf(r).message).toBe("E-posta veya şifre hatalı.");
    }
    const g = await db().auditLog.findFirst({ where: { username: `yok-${u.id.toLowerCase()}@example.test` } });
    expect(g).toMatchObject({ entity: "portal_users", entityId: null, result: "fail" });
  });

  it("AC-262: Origin yok / yabancı → 403 CSRF_INVALID; bilinmeyen alan → 400", async () => {
    const { u } = await fixture();
    const body = { email: u.email, tenantSlug: u.slug, password: u.password };
    expect((await portalLoginReq(app, body, { origin: null })).statusCode).toBe(403);
    expect((await portalLoginReq(app, body, { origin: "https://kotu.example" })).statusCode).toBe(403);
    expect((await portalLoginReq(app, { ...body, customerId: "x" } as typeof body)).statusCode).toBe(400);
  });

  it("AC-262: aynı IP'den 21. deneme/dk → 429", async () => {
    const { u } = await fixture();
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await login(u, ip, { email: `x${i}-${u.id.toLowerCase()}@example.test` })).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it("AC-262: e-posta+IP ikilisi 5. hatada 423 + portal.locked{account_ip}; kilitliyken doğru şifre de 423", async () => {
    const { u } = await fixture();
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await login(u, ip, { password: "Yanlis-Sifre-123" })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 423]);
    expect((await login(u, ip)).statusCode).toBe(423);
    const l = await lastAudit(u.id, PORTAL_AUDIT.LOCKED);
    expect(l?.newValue).toEqual({ scope: "account_ip", minutes: 15 });
    expect((await login(u, nextIp())).statusCode).toBe(200); // başka IP etkilenmez
  });

  it("AC-262: hesap geneli 20 hatalı/sa → 423 + locked_until (IP'den bağımsız)", async () => {
    const { u } = await fixture();
    const codes: number[] = [];
    for (let ipN = 0; ipN < 5; ipN++) {
      const ip = nextIp();
      for (let i = 0; i < 4; i++) codes.push((await login(u, ip, { password: "Yanlis-Sifre-123" })).statusCode);
    }
    expect(codes.slice(0, 19).every((c) => c === 401)).toBe(true);
    expect(codes[19]).toBe(423);
    const row = await db().portalUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    expect((await login(u, nextIp())).statusCode).toBe(423);
  });

  it("AC-262 r2 S-P21-3: aynı e-posta iki firmada ayrı hesap; her biri yalnız kendi kısa adıyla girer", async () => {
    const email = `ortak-${Date.now()}@example.test`;
    const a = await fixture({ email });
    const b = await fixture({ email });
    const ra = await login(a.u);
    const rb = await login(b.u);
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    expect(ra.json<PortalMe>().user.id).toBe(a.u.id);
    expect(rb.json<PortalMe>().user.id).toBe(b.u.id);
  });

  it("AC-262 r2 S-P21-5: geçici şifre 72 sa sonra doğru şifreyle 401 'süresi doldu' + audit temp_password_expired; süre içinde giriş", async () => {
    const expired = await fixture({ mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() - 1000) });
    const r = await login(expired.u);
    expect(r.statusCode).toBe(401);
    expect(errOf(r).message).toContain("72 saat");
    expect((await lastAudit(expired.u.id, PORTAL_AUDIT.LOGIN))?.newValue).toEqual({ reason: "temp_password_expired" });
    const fresh = await fixture({ mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + 3_600_000) });
    const ok = await login(fresh.u);
    expect(ok.statusCode).toBe(200);
    expect(ok.json<PortalMe>().user.mustChangePassword).toBe(true);
  });

  it("AC-262 K-P21-12: pasif hesap (doğru şifre) → 401 genel mesaj, MFA_REQUIRED değil; müşteri pasif → giriş 401", async () => {
    const p = await fixture({ status: "PASSIVE" });
    await enableTotpRow(app.secrets, p.u.id);
    const r = await login(p.u);
    expect(r.statusCode).toBe(401);
    expect((await lastAudit(p.u.id, PORTAL_AUDIT.LOGIN))?.newValue).toEqual({ reason: "inactive" });
    const c = await fixture();
    await db().customer.update({ where: { id: c.c.id }, data: { status: "PASSIVE", passiveAt: new Date() } });
    expect((await login(c.u)).statusCode).toBe(401);
  });

  it("AC-262 K-P21-12: açık oturum müşteri/firma pasife alınınca sonraki istekte 401 ve çerez temizlenir", async () => {
    const { t, c, u } = await fixture();
    const s = await portalLoginAs(app, u);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s.headers })).statusCode).toBe(200);
    await db().customer.update({ where: { id: c.id }, data: { status: "PASSIVE", passiveAt: new Date() } });
    const r = await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s.headers });
    expect(r.statusCode).toBe(401);
    expect(r.cookies.find((x) => x.name === PORTAL_SESSION_COOKIE)?.value).toBe("");
    const other = await fixture();
    const s2 = await portalLoginAs(app, other.u);
    await db().tenant.update({ where: { id: other.t.id }, data: { status: "PASSIVE" } });
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s2.headers })).statusCode).toBe(401);
    expect(t.id).not.toBe(other.t.id);
  });
});

describe("AC-262 ilk girişte şifre değişimi", () => {
  it("AC-262: must_change iken requests/sessions/request-form 403 PASSWORD_CHANGE_REQUIRED; me serbest; değişim sonrası diğer oturumlar 401, mevcut yenilenir", async () => {
    const { u } = await fixture({ mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + 3_600_000) });
    const s1 = await portalLoginAs(app, u);
    const s2 = await portalLoginAs(app, u);
    for (const url of ["/api/v1/portal/requests", "/api/v1/portal/sessions", "/api/v1/portal/request-form"]) {
      const r = await app.inject({ method: "GET", url, headers: s1.headers });
      expect(r.statusCode, url).toBe(403);
      expect(errOf(r).code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s1.headers })).statusCode).toBe(200);
    const theme = await app.inject({ method: "PATCH", url: "/api/v1/portal/me", headers: s1.headers, payload: { theme: "DARK" } });
    expect(theme.statusCode).toBe(403);

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/password",
      headers: s1.headers,
      payload: { current: "Yanlis-Sifre-123", next: "Yeni-Guclu-Sifre-456" },
    });
    expect(bad.statusCode).toBe(400);
    expect(errOf(bad).fields?.current).toBeDefined();

    const ch = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/password",
      headers: s1.headers,
      payload: { current: u.password, next: "Yeni-Guclu-Sifre-456" },
    });
    expect(ch.statusCode, ch.body).toBe(204);
    const renewed = sessionOf(ch);
    expect(renewed.token).not.toBe(s1.token);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s1.headers })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s2.headers })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/requests", headers: renewed.headers })).statusCode).toBe(200);
    const row = await db().portalUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ mustChangePassword: false, tempPasswordExpiresAt: null });
    const a = await lastAudit(u.id, PORTAL_AUDIT.PASSWORD_CHANGE);
    expect(a).toMatchObject({ result: "success", userId: null, entity: "portal_users" });
    expect(a?.newValue).toEqual({ revokedSessions: 2 });
  });

  it("AC-262: oturum başına 5 hatalı mevcut şifre → oturum iptal + 401", async () => {
    const { u } = await fixture();
    const s = await portalLoginAs(app, u);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/portal/account/password",
            headers: s.headers,
            payload: { current: `Yanlis-Sifre-${i}00`, next: "Yeni-Guclu-Sifre-456" },
          })
        ).statusCode,
      );
    expect(codes).toEqual([400, 400, 400, 400, 401]);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s.headers })).statusCode).toBe(401);
  });

  it("AC-262: çıkış 204 + çerezler silinir + audit entity_id = hesap, sessionId new_value'da (r2 S-P21-2); CSRF yoksa 403", async () => {
    const { u } = await fixture();
    const s = await portalLoginAs(app, u);
    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/portal/auth/logout",
      headers: { cookie: s.headers.cookie, origin: ORIGIN },
    });
    expect(noCsrf.statusCode).toBe(403);
    const s2 = await portalLoginAs(app, u);
    const out = await app.inject({ method: "POST", url: "/api/v1/portal/auth/logout", headers: s2.headers });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((x) => x.name === PORTAL_SESSION_COOKIE)?.value).toBe("");
    const a = await lastAudit(u.id, PORTAL_AUDIT.LOGOUT);
    expect(a).toMatchObject({ entity: "portal_users", entityId: u.id, userId: null });
    expect((a?.newValue as { sessionId: string }).sessionId).toMatch(/^[0-9A-Z]{26}$/);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s2.headers })).statusCode).toBe(401);
  });

  it("AC-262 §1.6: PATCH /portal/me tema kaydı + rs_theme çerezi", async () => {
    const { u } = await fixture();
    const s = await portalLoginAs(app, u);
    const r = await app.inject({ method: "PATCH", url: "/api/v1/portal/me", headers: s.headers, payload: { theme: "DARK" } });
    expect(r.statusCode).toBe(200);
    expect(r.json<PortalMe>().user.theme).toBe("DARK");
    expect(r.cookies.find((x) => x.name === "rs_theme")?.value).toBe("dark");
    expect((await db().portalUser.findUniqueOrThrow({ where: { id: u.id } })).theme).toBe("DARK");
    expect((await app.inject({ method: "PATCH", url: "/api/v1/portal/me", headers: s.headers, payload: { theme: "X" } })).statusCode).toBe(
      400,
    );
  });
});

describe("AC-262 isteğe bağlı TOTP", () => {
  it("AC-262: setup (qrDataUrl, no-store) → enable → kodsuz giriş 403 MFA_REQUIRED ve oturum açılmaz → doğru kod 200 → aynı adım 401 → disable şifre+kod", async () => {
    const { u } = await fixture();
    const s = await portalLoginAs(app, u);
    const setup = await app.inject({ method: "POST", url: "/api/v1/portal/account/totp/setup", headers: s.headers, payload: {} });
    expect(setup.statusCode, setup.body).toBe(200);
    expect(setup.headers["cache-control"]).toBe("no-store");
    const { secret, qrDataUrl, otpauthUrl } = setup.json<{ secret: string; qrDataUrl: string; otpauthUrl: string }>();
    expect(qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(otpauthUrl).toContain(encodeURIComponent(u.email));
    const badEnable = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/totp/enable",
      headers: s.headers,
      payload: { code: totpAt(secret) === "000000" ? "111111" : "000000" },
    });
    expect(badEnable.statusCode).toBe(400);
    expect(errOf(badEnable).fields?.code).toBeDefined();
    const en = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/totp/enable",
      headers: s.headers,
      payload: { code: totpAt(secret) },
    });
    expect(en.statusCode, en.body).toBe(204);
    expect((await lastAudit(u.id, PORTAL_AUDIT.MFA_ENABLED))?.result).toBe("success");
    const again = await app.inject({ method: "POST", url: "/api/v1/portal/account/totp/setup", headers: s.headers, payload: {} });
    expect(again.statusCode).toBe(409);

    const before = await db().portalSession.count({ where: { portalUserId: u.id } });
    const noCode = await login(u);
    expect(noCode.statusCode).toBe(403);
    expect(errOf(noCode).code).toBe("MFA_REQUIRED");
    expect(await db().portalSession.count({ where: { portalUserId: u.id } })).toBe(before);
    expect((await db().portalUser.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);

    const code = totpAt(secret, 1); // enable t'yi tüketti; t+1 hâlâ geçerli pencerede
    const ok = await login(u, nextIp(), { totpCode: code });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<PortalMe>().user.totpEnabled).toBe(true);
    const replay = await login(u, nextIp(), { totpCode: code });
    expect(replay.statusCode).toBe(401);
    expect(errOf(replay).message).toBe("Kod hatalı.");
    expect((await lastAudit(u.id, PORTAL_AUDIT.LOGIN))?.newValue).toEqual({ reason: "replayed_totp" });

    const s2 = sessionOf(ok);
    const noPass = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/totp/disable",
      headers: s2.headers,
      payload: { password: "Yanlis-Sifre-123", code: totpAt(secret) },
    });
    expect(noPass.statusCode).toBe(400);
    expect(errOf(noPass).fields?.password).toBeDefined();
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/totp/disable",
      headers: s2.headers,
      payload: { password: u.password },
    });
    expect(missing.statusCode).toBe(400);
    // Kod tüketimi: t+1 kullanıldı → disable için yeniden kullanılamaz; güncel adım (t) da t+1'den eski → reddedilir.
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/totp/disable",
      headers: s2.headers,
      payload: { password: u.password, code },
    });
    expect(stale.statusCode).toBe(400);
    expect(errOf(stale).fields?.code).toBeDefined();
    await db().portalUser.update({ where: { id: u.id }, data: { totpLastStep: null } });
    const off = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/totp/disable",
      headers: s2.headers,
      payload: { password: u.password, code: totpAt(secret) },
    });
    expect(off.statusCode, off.body).toBe(204);
    const row = await db().portalUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null });
    expect((await lastAudit(u.id, PORTAL_AUDIT.MFA_DISABLED))?.result).toBe("success");
  });

  it("AC-262 S-P21-K-1: TOTP etkinleştirme aynı işlemde hesabın diğer portal oturumlarını iptal eder (mevcut kalır); sayı audit'te", async () => {
    const { t, c, u } = await fixture();
    const other = await fixture({ tenantId: t.id, slug: t.slug, customerId: c.id }); // aynı müşterinin başka hesabı etkilenmez
    const s1 = await portalLoginAs(app, u);
    const s2 = await portalLoginAs(app, u);
    const s3 = await portalLoginAs(app, u);
    const so = await portalLoginAs(app, other.u);
    const me = (s: { headers: Record<string, string> }) => app.inject({ method: "GET", url: "/api/v1/portal/me", headers: s.headers });
    expect((await me(s2)).statusCode).toBe(200);
    const setup = await app.inject({ method: "POST", url: "/api/v1/portal/account/totp/setup", headers: s1.headers, payload: {} });
    const { secret } = setup.json<{ secret: string }>();
    const en = await app.inject({
      method: "POST",
      url: "/api/v1/portal/account/totp/enable",
      headers: s1.headers,
      payload: { code: totpAt(secret) },
    });
    expect(en.statusCode, en.body).toBe(204);
    expect((await me(s1)).statusCode).toBe(200);
    expect((await me(s2)).statusCode).toBe(401);
    expect((await me(s3)).statusCode).toBe(401);
    expect((await me(so)).statusCode).toBe(200);
    const a = await lastAudit(u.id, PORTAL_AUDIT.MFA_ENABLED);
    expect(a).toMatchObject({ result: "success", newValue: { revokedSessions: 2 } });
    expect(await db().portalSession.count({ where: { portalUserId: u.id, revokedAt: null } })).toBe(1);
  });

  it("AC-262 r2 S-P21-7: kodlu 16. hatalı deneme/15 dk → 429 (portalMfaUser); hatalı kod DB sayacını artırır", async () => {
    const { u } = await fixture();
    await enableTotpRow(app.secrets, u.id);
    const codes: number[] = [];
    for (let ipN = 0; ipN < 4; ipN++) {
      const ip = nextIp();
      for (let i = 0; i < 4; i++) codes.push((await login(u, ip, { totpCode: "000000" })).statusCode);
    }
    expect(codes.slice(0, 15).every((c) => c === 401)).toBe(true);
    expect(codes[15]).toBe(429);
    expect((await lastAudit(u.id, PORTAL_AUDIT.LOGIN))?.newValue).toEqual({ reason: "invalid_totp" });
    expect((await db().portalUser.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(15);
  });

  it("AC-262 r2 S-P21-9: panel AAD'siyle şifrelenmiş sır portal satırında çözülemez (ayrı etiket)", async () => {
    const { u } = await fixture();
    const enc = app.secrets.encrypt("JBSWY3DPEHPK3PXP", aadFor.totpSecret(u.id));
    expect(() => app.secrets.decrypt(enc, aadFor.portalTotpSecret(u.id))).toThrow();
    expect(aadFor.portalTotpSecret(u.id)).not.toBe(aadFor.totpSecret(u.id));
  });
});

describe("AC-262 ADR-0039 panel ↔ portal çerez ayrımı", () => {
  it("AC-262: panel token'ı portal çerez adıyla → 401; portal token'ı panel çerez adıyla /auth/me → 401", async () => {
    const { t, u } = await fixture();
    const panelUser = await createUser({ tenantId: t.id, role: "ADMIN" });
    const panel = await loginAs(app, panelUser);
    const portal = await portalLoginAs(app, u);
    const r1 = await app.inject({
      method: "GET",
      url: "/api/v1/portal/me",
      headers: { cookie: `${PORTAL_SESSION_COOKIE}=${panel.token}` },
    });
    expect(r1.statusCode).toBe(401);
    const r2 = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: `${SESSION_COOKIE}=${portal.token}` } });
    expect(r2.statusCode).toBe(401);
    // Panel oturum çerezi portal ucunda anlamsız (doğru adla bile).
    const r3 = await app.inject({ method: "GET", url: "/api/v1/portal/me", headers: panel.headers });
    expect(r3.statusCode).toBe(401);
  });

  it("AC-262: portal CSRF çereziyle panel POST → 403; panel CSRF çereziyle portal POST → 403", async () => {
    const { t, u } = await fixture();
    const panel = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const portal = await portalLoginAs(app, u);
    // Panel oturumu + portal CSRF çerezi/başlığı (panel __Host-rs_csrf yok)
    const p1 = await app.inject({
      method: "PATCH",
      url: "/api/v1/auth/me/preferences",
      headers: {
        cookie: `${SESSION_COOKIE}=${panel.token}; ${PORTAL_CSRF_COOKIE}=${portal.csrf}`,
        "x-csrf-token": portal.csrf,
        origin: ORIGIN,
      },
      payload: { theme: "DARK" },
    });
    expect(p1.statusCode).toBe(403);
    // Portal oturumu + panel CSRF çerezi/başlığı (portal CSRF çerezi yok)
    const panelCsrf = panel.headers["x-csrf-token"];
    const p2 = await app.inject({
      method: "PATCH",
      url: "/api/v1/portal/me",
      headers: {
        cookie: `${PORTAL_SESSION_COOKIE}=${portal.token}; ${CSRF_COOKIE}=${panelCsrf}`,
        "x-csrf-token": panelCsrf,
        origin: ORIGIN,
      },
      payload: { theme: "DARK" },
    });
    expect(p2.statusCode).toBe(403);
  });
});
