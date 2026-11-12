// P10 hesap güvenliği + SMTP (AC-10, 65, 66, 67, 68, 78, 79, 80, 115, 122, 151). Gerçek MySQL + fastify.inject +
// süreç içi sahte SMTP (smtp-server, 127.0.0.1) — dış sunucuya bağlanılmaz. netguard testte yalnız 127.0.0.1'e izin
// verir ("smtp.test" → 127.0.0.1); diğer tüm yasak aralıklar gerçek kuralla reddedilir.
import { CSRF_COOKIE, SESSION_COOKIE, type LoginResponse, type MeResponse, type MfaEnableResponse, type MfaSetupResponse } from "@remote/contracts/api/auth";
import { SMTP_INSECURE_AUTH_MESSAGE, SMTP_PORT_MESSAGE, SMTP_SEND_FAILED_MESSAGE, type TenantSettingsView } from "@remote/contracts/api/tenants";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, hotp, stepOf } from "../../src/auth/mfa.ts";
import { createNetGuard, isBlockedIp } from "../../src/lib/netguard.ts";
import { MAIL_ATTEMPT_CAP_MS, type TransportFactory } from "../../src/mail/service.ts";
import { createSupportSessionRow, createTenant, createUser, loginAs, loginRequest, makeApp, ORIGIN, testDb, type Session, type TestUser } from "../helpers/app.ts";
import { createRequestSettings, requestClient } from "../helpers/requests.ts";
import { FAKE_SMTP_PASSWORD } from "../helpers/secrets.ts";
import { admitted, startLive, techSession } from "../helpers/signal-flow.ts";
import { connect, techHeaders } from "../helpers/ws.ts";

interface Mail { to: string; body: string }
const inbox: Mail[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let p10: NonNullable<Parameters<typeof makeApp>[0]>["p10"];
let app: FastifyInstance;
let wsBase = "";
/** Sözleşme yalnız 25/465/587/2525'e izin verir (B-P10-1): 2525 → süreç içi sahte SMTP, diğerleri → kapalı port 9. */
const transport: TransportFactory = (o) => nodemailer.createTransport({ ...o, port: o.port === 2525 ? smtpPort : 9 } as Parameters<typeof nodemailer.createTransport>[0]);

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    logger: false,
    onData(stream, session, cb) {
      let body = "";
      stream.on("data", (c: Buffer) => (body += c.toString("utf8")));
      stream.on("end", () => {
        inbox.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), body });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
  smtpPort = (smtp.server.address() as { port: number }).port;
  const netguard = createNetGuard({ lookupAll: async (h) => (h === "smtp.test" ? ["127.0.0.1"] : []), isBlocked: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip) });
  p10 = { netguard, mailTransport: transport, mfaSetupEnforcement: true };
  app = makeApp({ p10, env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32" } });
  await app.listen({ host: "127.0.0.1", port: 0 });
  wsBase = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => smtp.close(() => r()));
});

const db = () => testDb();
let ipSeq = 0;
const ip = () => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

function jar(res: LightMyRequestResponse): Session {
  const c = Object.fromEntries(res.cookies.map((x) => [x.name, x.value]));
  const token = c[SESSION_COOKIE] ?? "";
  const csrf = c[CSRF_COOKIE] ?? "";
  return { token, headers: { cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN } };
}
async function signIn(u: TestUser, password = u.password): Promise<{ s: Session; body: LoginResponse }> {
  const res = await app.inject(loginRequest(u.email, password, { remoteAddress: ip() }));
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode} ${res.body}`);
  return { s: jar(res), body: res.json<LoginResponse>() };
}
const call = (s: Session | null, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: s ? s.headers : { origin: ORIGIN }, remoteAddress: ip(), ...(payload === undefined ? {} : { payload: payload as object }) });
/** quoted-printable + UTF-8 çözümü (sahte SMTP ham gövdesi). */
const decodeQp = (raw: string): string => {
  const bytes = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
};
const totpNow = (secret: string, offset = 0) => hotp(base32Decode(secret), stepOf(Date.now()) + offset);

/** Admin'i 2FA kurulumundan geçirir; tam oturum + sır + kurtarma kodları döner. */
async function enrolledAdmin(tenantId: string) {
  const admin = await createUser({ tenantId, role: "ADMIN" });
  const { s } = await signIn(admin);
  const setup = (await call(s, "POST", "/auth/mfa/setup", {})).json<MfaSetupResponse>();
  const en = await call(s, "POST", "/auth/mfa/enable", { code: totpNow(setup.secret) });
  return { admin, s, secret: setup.secret, codes: en.json<MfaEnableResponse>().recoveryCodes };
}

async function configureSmtp(s: Session) {
  const r = await call(s, "PUT", "/settings/tenant", { smtp: { host: "smtp.test", port: 2525, security: "NONE", fromEmail: "destek@firma.test", fromName: "Firma Destek" } });
  expect(r.statusCode, r.body).toBe(200);
}

describe("AC-67 iki adımlı doğrulama", () => {
  it("AC-67: Admin girişte kurulum aşamasında; diğer uçlar 403 MFA_SETUP_REQUIRED; yanlış kod 400; kurulumla 10 kurtarma kodu (DB'de yalnız hash) ve diğer oturumlar iptal", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const first = await signIn(admin);
    expect(first.body).toMatchObject({ mfaRequired: false, mfaSetupRequired: true });
    const other = await signIn(admin);
    expect((await call(first.s, "GET", "/users")).json()).toMatchObject({ error: { code: "MFA_SETUP_REQUIRED" } });
    expect((await call(first.s, "GET", "/auth/me")).json<MeResponse>().mfa).toMatchObject({ enabled: false, required: true, stage: "setup" });
    const setup = (await call(first.s, "POST", "/auth/mfa/setup", {})).json<MfaSetupResponse>();
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const row = await db().user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(Buffer.from(row.totpSecretEnc ?? []).toString("latin1")).not.toContain(setup.secret);
    expect((await call(first.s, "POST", "/auth/mfa/enable", { code: "000000" === totpNow(setup.secret) ? "111111" : "000000" })).statusCode).toBe(400);
    const en = await call(first.s, "POST", "/auth/mfa/enable", { code: totpNow(setup.secret) });
    expect(en.statusCode, en.body).toBe(200);
    const codes = en.json<MfaEnableResponse>().recoveryCodes;
    expect(codes).toHaveLength(10);
    const stored = await db().recoveryCode.findMany({ where: { userId: admin.id } });
    expect(stored).toHaveLength(10);
    for (const c of codes) expect(JSON.stringify(stored)).not.toContain(c);
    expect((await call(first.s, "GET", "/users")).statusCode).toBe(200);
    expect((await call(other.s, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await call(first.s, "POST", "/auth/mfa/setup", {})).statusCode).toBe(409);
  });

  it("AC-67: 2FA etkin girişte doğrulama aşaması; aynı kod ikinci kez kabul edilmez; kurtarma kodu tek kullanımlık; audit'te kod yok", async () => {
    const t = await createTenant();
    const { admin, secret, codes } = await enrolledAdmin(t.id);
    const a = await signIn(admin);
    expect(a.body).toMatchObject({ mfaRequired: true, mfaSetupRequired: false });
    expect((await call(a.s, "GET", "/sessions")).json()).toMatchObject({ error: { code: "MFA_REQUIRED" } });
    expect((await call(a.s, "GET", "/auth/me")).json<MeResponse>()).toMatchObject({ permissions: [], mfa: { stage: "verify" } });
    // Kurulumda kullanılan adım/kod tekrar kabul edilmez (totp_last_step).
    const reused = await call(a.s, "POST", "/auth/mfa/verify", { code: totpNow(secret) });
    expect(reused.statusCode).toBe(401);
    const v = await call(a.s, "POST", "/auth/mfa/verify", { code: totpNow(secret, 1) });
    expect(v.statusCode, v.body).toBe(200);
    const full = jar(v);
    expect(full.token).not.toBe(a.s.token); // token yenilenir
    expect((await call(a.s, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await call(full, "GET", "/sessions")).statusCode).toBe(200);
    const b = await signIn(admin);
    const rc = codes[0] ?? "";
    const r1 = await call(b.s, "POST", "/auth/mfa/verify", { recoveryCode: rc.toUpperCase() });
    expect(r1.json()).toMatchObject({ recoveryCodesLeft: 9 });
    const c = await signIn(admin);
    expect((await call(c.s, "POST", "/auth/mfa/verify", { recoveryCode: rc })).statusCode).toBe(401);
    const audits = JSON.stringify(await db().auditLog.findMany({ where: { userId: admin.id } }), (_k, x: unknown) => (typeof x === "bigint" ? String(x) : x));
    expect(audits).not.toContain(rc);
    expect(audits).not.toContain(secret);
  });

  it("AC-67: yarım oturum WS'te (panel + teknisyen sinyal) reddedilir, veri ucu 403 MFA_REQUIRED", async () => {
    const t = await createTenant();
    const { admin } = await enrolledAdmin(t.id);
    const a = await signIn(admin);
    expect((await call(a.s, "GET", "/users")).json()).toMatchObject({ error: { code: "MFA_REQUIRED" } });
    expect((await call(a.s, "GET", "/users")).statusCode).toBe(403);
    expect((await call(a.s, "POST", "/sessions", {})).statusCode).toBe(403);
    await expect(connect(`${wsBase}/ws/panel`, ["rs.v1"], techHeaders(a.s.token, ORIGIN))).rejects.toThrow(/HTTP 40[13]/);
    const sess = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id });
    await expect(connect(`${wsBase}/ws/tech?sessionId=${sess.id}`, ["rs.v1"], techHeaders(a.s.token, ORIGIN))).rejects.toThrow(/HTTP 40[13]/);
  });

  it("AC-67/B-P10-9: aynı IP'den 5 hatalı → 429; başka IP'den gerçek kullanıcı doğrulayabilir; hesap geneli 15 hatalı (IP'den bağımsız) → 429", async () => {
    const t = await createTenant();
    const { admin, secret } = await enrolledAdmin(t.id);
    const a = await signIn(admin);
    const from = (addr: string, body: object) => app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers: a.s.headers, remoteAddress: addr, payload: body });
    for (let i = 0; i < 5; i++) expect((await from("10.88.0.1", { code: "999999" })).statusCode).toBe(401);
    expect((await from("10.88.0.1", { code: "999999" })).statusCode).toBe(429);
    const ok = await from("10.88.0.2", { code: totpNow(secret, 1) });
    expect(ok.statusCode, ok.body).toBe(200);
    const b = await signIn(admin);
    const fromB = (addr: string) => app.inject({ method: "POST", url: "/api/v1/auth/mfa/verify", headers: b.s.headers, remoteAddress: addr, payload: { code: "999999" } });
    for (let i = 0; i < 15; i++) expect((await fromB(`10.89.${i}.1`)).statusCode).toBeOneOf([401, 429]);
    const last = await fromB("10.89.99.1");
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("B-P10-6: 2FA etkinleşince hesap sahibine bildirim e-postası; SMTP yoksa audit mail.sent{not_configured}", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    await configureSmtp(s);
    const { admin } = await enrolledAdmin(t.id);
    await expect.poll(() => inbox.some((m) => m.to === admin.email && m.body.includes("etkinle"))).toBe(true);
    const t2 = await createTenant();
    const lone = await enrolledAdmin(t2.id);
    await expect.poll(() => db().auditLog.count({ where: { userId: lone.admin.id, action: "mail.sent", result: "fail", newValue: { path: "$.reason", equals: "not_configured" } } })).toBe(1);
  });

  it("AC-67: USER için tenant ayarı — requireTech2fa=false ise kurulum zorunlu değil, true ise zorunlu", async () => {
    const t = await createTenant();
    const user = await createUser({ tenantId: t.id, role: "USER" });
    expect((await signIn(user)).body.mfaSetupRequired).toBe(true);
    const { s } = await enrolledAdmin(t.id);
    expect((await call(s, "PUT", "/settings/tenant", { requireTech2fa: false })).json<TenantSettingsView>().requireTech2fa).toBe(false);
    expect((await signIn(user)).body.mfaSetupRequired).toBe(false);
  });

  it("AC-67/AC-115: Admin kullanıcının 2FA'sını sıfırlar → sır/kodlar silinir, oturumlar iptal, audit user.mfa_reset; kendi hesabı 403", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    const target = await enrolledAdmin(t.id);
    const r = await call(s, "POST", `/users/${target.admin.id}/reset-mfa`, {});
    expect(r.statusCode, r.body).toBe(204);
    const row = await db().user.findUniqueOrThrow({ where: { id: target.admin.id } });
    expect(row).toMatchObject({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null });
    expect(await db().recoveryCode.count({ where: { userId: target.admin.id } })).toBe(0);
    expect((await call(target.s, "GET", "/auth/me")).statusCode).toBe(401);
    expect(await db().auditLog.count({ where: { action: "user.mfa_reset", entityId: target.admin.id } })).toBe(1);
    expect((await call(s, "POST", `/users/${target.admin.id}/reset-mfa`, {})).statusCode).toBe(409);
    const me = (await call(s, "GET", "/auth/me")).json<MeResponse>();
    expect((await call(s, "POST", `/users/${me.user.id}/reset-mfa`, {})).statusCode).toBe(403);
  });
});

describe("AC-68 oturum süresi ve tüm cihazlardan çıkış", () => {
  it("AC-68/AC-115: logout-all diğer oturumları anında geçersiz kılar, bu oturum kalır; audit", async () => {
    const t = await createTenant();
    const user = await createUser({ tenantId: t.id, role: "USER" });
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { requireTech2fa: false } });
    const a = await signIn(user);
    const b = await signIn(user);
    const r = await call(a.s, "POST", "/auth/logout-all", {});
    expect(r.json()).toEqual({ revokedSessions: 1 });
    expect((await call(b.s, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await call(a.s, "GET", "/auth/me")).statusCode).toBe(200);
    expect(await db().auditLog.count({ where: { action: "auth.logout_all", userId: user.id } })).toBe(1);
  });

  it("AC-115: logout-all sonrası teknisyenin etkin destek oturumu 5 sn içinde biter (auth_revoked, DB ENDED)", async () => {
    const live = await startLive({ p10: { ...p10, mfaSetupEnforcement: false } });
    try {
      const tt = await techSession(live);
      const g = await admitted(live, tt);
      const other = await loginAs(live.app, { id: tt.tech.id, email: tt.tech.email, username: tt.tech.username, tenantId: tt.tenantId, password: tt.tech.password });
      const t0 = Date.now();
      expect((await live.app.inject({ method: "POST", url: "/api/v1/auth/logout-all", headers: other.headers, payload: {} })).statusCode).toBe(200);
      expect((await g.guest.waitFor("session.ended", 5000)).reason).toBe("auth_revoked");
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(await db().supportSession.findUniqueOrThrow({ where: { id: tt.sessionId } })).toMatchObject({ status: "ENDED", endReason: "auth_revoked" });
    } finally {
      await live.close();
    }
  });

  it("AC-115: Admin 2FA sıfırlayınca teknisyenin etkin destek oturumu 5 sn içinde biter", async () => {
    const live = await startLive({ p10: { ...p10, mfaSetupEnforcement: false } });
    try {
      const tt = await techSession(live);
      const setup = (await live.app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup", headers: tt.techAuth.headers, payload: {} })).json<MfaSetupResponse>();
      expect((await live.app.inject({ method: "POST", url: "/api/v1/auth/mfa/enable", headers: tt.techAuth.headers, payload: { code: totpNow(setup.secret) } })).statusCode).toBe(200);
      const g = await admitted(live, tt);
      const adm = await createUser({ tenantId: tt.tenantId, role: "ADMIN" });
      const as = await loginAs(live.app, adm);
      const t0 = Date.now();
      expect((await live.app.inject({ method: "POST", url: `/api/v1/users/${tt.tech.id}/reset-mfa`, headers: as.headers, payload: {} })).statusCode).toBe(204);
      expect((await g.guest.waitFor("session.ended", 5000)).reason).toBe("auth_revoked");
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(await db().supportSession.findUniqueOrThrow({ where: { id: tt.sessionId } })).toMatchObject({ status: "ENDED", endReason: "auth_revoked" });
    } finally {
      await live.close();
    }
  });

  it("AC-68: 30 dk hareketsizlik ve 8 sa mutlak süre sonunda oturum geçersiz", async () => {
    const t = await createTenant();
    const user = await createUser({ tenantId: t.id, role: "USER" });
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { requireTech2fa: false } });
    const a = await signIn(user);
    const b = await signIn(user);
    await db().authSession.updateMany({ where: { userId: user.id, tokenHash: { not: "" } }, data: {} });
    const { sha256Hex } = await import("../../src/lib/ids.ts");
    await db().authSession.update({ where: { tokenHash: sha256Hex(a.s.token) }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    await db().authSession.update({ where: { tokenHash: sha256Hex(b.s.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(a.s, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await call(b.s, "GET", "/auth/me")).statusCode).toBe(401);
  });
});

describe("AC-78/79/80/122 SMTP ayarı ve test", () => {
  it("AC-78/AC-79: şifre şifreli saklanır, forma dönmez (hasPassword), boş bırakılırsa korunur, audit'te maskeli", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    const base = { host: "smtp.test", port: 587, security: "STARTTLS", user: "kullanici", fromEmail: "destek@firma.test" };
    const put = await call(s, "PUT", "/settings/tenant", { smtp: { ...base, password: FAKE_SMTP_PASSWORD } });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.body).not.toContain(FAKE_SMTP_PASSWORD);
    expect(put.json<TenantSettingsView>().smtp).toMatchObject({ host: "smtp.test", hasPassword: true, user: "kullanici" });
    const row = await db().tenantSettings.findUniqueOrThrow({ where: { tenantId: t.id } });
    expect(Buffer.from(row.smtpPassEnc ?? []).toString("latin1")).not.toContain(FAKE_SMTP_PASSWORD);
    const keep = await call(s, "PUT", "/settings/tenant", { smtp: { ...base, port: 2525, password: "" } });
    expect(keep.json<TenantSettingsView>().smtp).toMatchObject({ port: 2525, hasPassword: true });
    const noUser = await call(s, "PUT", "/settings/tenant", { smtp: { ...base, user: "" } });
    expect(noUser.json<TenantSettingsView>().smtp).toMatchObject({ user: null, hasPassword: false });
    const audits = JSON.stringify(await db().auditLog.findMany({ where: { tenantId: t.id, action: "tenant_settings.updated" } }), (_k, x: unknown) => (typeof x === "bigint" ? String(x) : x));
    expect(audits).not.toContain(FAKE_SMTP_PASSWORD);
    expect(audits).toContain("***");
    expect((await call(s, "PUT", "/settings/tenant", { smtp: null })).json<TenantSettingsView>().smtp).toBeNull();
  });

  it("AC-122: özel/loopback/link-local hedef kayıtta ve testte genel mesajla 400 HOST_NOT_ALLOWED", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    for (const host of ["10.1.2.3", "169.254.169.254", "100.64.1.1", "[::1]", "yok.test"]) {
      const r = await call(s, "PUT", "/settings/tenant", { smtp: { host, port: 25, security: "NONE", fromEmail: "a@b.test" } });
      expect(r.json(), host).toMatchObject({ error: { code: "HOST_NOT_ALLOWED", message: "Bu sunucu adresi kullanılamaz." } });
    }
    // Kayıttan sonra DB'de yasak hedefe dönmüş ayar → test de reddeder.
    await configureSmtp(s);
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { smtpHost: "10.9.9.9" } });
    expect((await call(s, "POST", "/settings/smtp/test", { to: "x@y.test" })).json()).toMatchObject({ error: { code: "HOST_NOT_ALLOWED" } });
  });

  it("AC-80/AC-122: test maili gönderilir + audit (alıcı maskeli, konu, sonuç); 6. istek 429; SMTP yoksa 502", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    expect((await call(s, "POST", "/settings/smtp/test", { to: "x@y.test" })).json()).toMatchObject({ error: { code: "UPSTREAM", message: "Önce SMTP ayarlarını yapın" } });
    await configureSmtp(s);
    const to = `test-${Date.now()}@alici.test`;
    const r = await call(s, "POST", "/settings/smtp/test", { to });
    expect(r.json()).toEqual({ ok: true, message: "Test e-postası gönderildi." });
    expect(inbox.some((m) => m.to === to)).toBe(true);
    const sent = await db().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "mail.sent", entity: "tenant_settings" } });
    expect(sent.newValue).toMatchObject({ recipient: "t***@alici.test", result: "success" });
    for (let i = 0; i < 3; i++) await call(s, "POST", "/settings/smtp/test", { to });
    expect((await call(s, "POST", "/settings/smtp/test", { to })).statusCode).toBe(429);
  });

  it("AC-80/B-P10-1: bağlanılamazsa 502 tek genel mesaj, sabit süre tabanı; sınıf yalnız audit'te; izinsiz port (DB'de eski değer) aynı yanıt", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    await configureSmtp(s);
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { smtpPort: 25 } }); // sahte taşıyıcı → kapalı port
    const t0 = Date.now();
    const r = await call(s, "POST", "/settings/smtp/test", { to: "x@y.test" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(MAIL_ATTEMPT_CAP_MS - 100);
    expect(r.json()).toMatchObject({ error: { code: "UPSTREAM", message: SMTP_SEND_FAILED_MESSAGE } });
    const a = await db().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "mail.sent", entity: "tenant_settings", result: "fail" } });
    expect(a.newValue).toMatchObject({ reason: "connect" });
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { smtpPort: 3306 } });
    expect((await call(s, "POST", "/settings/smtp/test", { to: "x@y.test" })).json()).toMatchObject({ error: { code: "UPSTREAM", message: SMTP_SEND_FAILED_MESSAGE } });
    expect(await db().auditLog.count({ where: { tenantId: t.id, action: "mail.sent", result: "fail", newValue: { path: "$.reason", equals: "port_not_allowed" } } })).toBe(1);
  });

  it("B-P10-1/B-P10-5: kayıtta izinsiz port 400 fields.smtp.port; güvenlik Yok + kimlik bilgisi 400 fields.smtp.security; DB'de kalmış böyle ayarla gönderim reddedilir", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    const base = { host: "smtp.test", fromEmail: "a@b.test" };
    expect((await call(s, "PUT", "/settings/tenant", { smtp: { ...base, port: 22, security: "STARTTLS" } })).json()).toMatchObject({ error: { code: "VALIDATION", fields: { "smtp.port": SMTP_PORT_MESSAGE } } });
    expect((await call(s, "PUT", "/settings/tenant", { smtp: { ...base, port: 25, security: "NONE", user: "u", password: FAKE_SMTP_PASSWORD } })).json()).toMatchObject({ error: { code: "VALIDATION", fields: { "smtp.security": SMTP_INSECURE_AUTH_MESSAGE } } });
    await configureSmtp(s);
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { smtpUser: "eski-kullanici" } });
    const before = inbox.length;
    expect((await call(s, "POST", "/settings/smtp/test", { to: "x@y.test" })).json()).toMatchObject({ error: { code: "UPSTREAM", message: SMTP_SEND_FAILED_MESSAGE } });
    expect(inbox.length).toBe(before);
    expect(await db().auditLog.count({ where: { tenantId: t.id, action: "mail.sent", newValue: { path: "$.reason", equals: "insecure_auth" } } })).toBe(1);
  });
});

describe("AC-66 şifre sıfırlama", () => {
  it("AC-66: her durumda 202; bağlantı 30 dk, tek kullanımlık; sıfırlama oturumları iptal eder; DB'de yalnız hash", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    await configureSmtp(s);
    const user = await createUser({ tenantId: t.id, role: "USER" });
    expect((await call(null, "POST", "/auth/password/forgot", { email: "yok-boyle@example.test" })).statusCode).toBe(202);
    expect((await call(null, "POST", "/auth/password/forgot", { email: user.email.toUpperCase() })).statusCode).toBe(202);
    await expect.poll(() => inbox.find((m) => m.to === user.email)).toBeTruthy();
    const body = (inbox.find((m) => m.to === user.email)?.body ?? "").replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    const token = /reset-password#token=([A-Za-z0-9_-]{43})/.exec(body)?.[1] ?? "";
    expect(token).toHaveLength(43);
    const row = await db().passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(30 * 60_000);
    const old = await signIn(user);
    const ok = await call(null, "POST", "/auth/password/reset", { token, next: "Yeni-Sifre-12345" });
    expect(ok.statusCode, ok.body).toBe(204);
    expect((await call(old.s, "GET", "/auth/me")).statusCode).toBe(401);
    expect((await call(null, "POST", "/auth/password/reset", { token, next: "Baska-Sifre-12345" })).json()).toMatchObject({ error: { code: "RESET_TOKEN_INVALID" } });
    await signIn(user, "Yeni-Sifre-12345");
  });

  it("AC-66: süresi dolmuş bağlantı 410; Super Admin/SMTP'siz tenant gönderim yok, audit no_smtp", async () => {
    const t = await createTenant();
    const user = await createUser({ tenantId: t.id, role: "USER" });
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    for (const u of [user, sa]) expect((await call(null, "POST", "/auth/password/forgot", { email: u.email })).statusCode).toBe(202);
    await expect.poll(() => db().auditLog.count({ where: { userId: { in: [user.id, sa.id] }, action: "auth.password_reset_requested", result: "fail" } })).toBe(2);
    expect(await db().passwordResetToken.count({ where: { userId: { in: [user.id, sa.id] } } })).toBe(0);
    const { newId, sha256Hex } = await import("../../src/lib/ids.ts");
    const token = (await import("../../src/lib/ids.ts")).newSecretToken();
    const created = new Date(Date.now() - 31 * 60_000);
    await db().passwordResetToken.create({ data: { id: newId(), userId: user.id, tokenHash: sha256Hex(token), createdAt: created, expiresAt: new Date(created.getTime() + 30 * 60_000) } });
    expect((await call(null, "POST", "/auth/password/reset", { token, next: "Yeni-Sifre-12345" })).statusCode).toBe(410);
  });
});

describe("AC-65 hesap geneli kilit bildirimi", () => {
  it("AC-65: 20. hatalı denemede kilit + (SMTP ayarlıysa) hesap sahibine bildirim e-postası", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    await configureSmtp(s);
    const user = await createUser({ tenantId: t.id, role: "USER" });
    await db().user.update({ where: { id: user.id }, data: { failedLoginCount: 19, failedWindowAt: new Date() } });
    const r = await app.inject(loginRequest(user.email, "yanlis-sifre-000", { remoteAddress: ip() }));
    expect(r.statusCode).toBe(423);
    await expect.poll(() => inbox.some((m) => m.to === user.email && m.body.includes("kilitlendi"))).toBe(true);
    // B-P10-9: aynı saat içinde ikinci kilit → yeni e-posta yok (soğuma).
    await db().user.update({ where: { id: user.id }, data: { failedLoginCount: 19, failedWindowAt: new Date(), lockedUntil: null } });
    expect((await app.inject(loginRequest(user.email, "yanlis-sifre-000", { remoteAddress: ip() }))).statusCode).toBe(423);
    await new Promise((r) => setTimeout(r, 500));
    expect(inbox.filter((m) => m.to === user.email && m.body.includes("kilitlendi"))).toHaveLength(1);
  });
});

describe("AC-10 oturum bağlantısı e-postası", () => {
  it("AC-10: kendi bekleyen oturumu gönderilir (kod + link); başka bağlantı 400; 21. istek 429", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    await configureSmtp(s);
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.create": true } });
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { requireTech2fa: false } });
    const ts = (await signIn(tech)).s;
    const sess = await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id });
    const link = `${ORIGIN}/session/${sess.token}`;
    const to = `musteri-${Date.now()}@example.test`;
    const ok = await call(ts, "POST", `/sessions/${sess.id}/email`, { to, link });
    expect(ok.json(), ok.body).toEqual({ sent: true });
    const m = decodeQp(inbox.find((x) => x.to === to)?.body ?? "");
    const code = sess.code ?? "";
    expect(m).toContain(`${code.slice(0, 4)} ${code.slice(4)}`);
    expect(m).toContain("Test Kullanıcı"); // teknisyen fullName
    expect(m).toContain(link);
    const row = await db().supportSession.findUniqueOrThrow({ where: { id: sess.id }, select: { expiresAt: true } });
    const until = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(row.expiresAt);
    expect(m).toContain(`Son geçerlilik: ${until} (Türkiye saati)`);
    expect(m).toContain(`<img src="${ORIGIN}/img/logo.png"`);
    const sa = await db().auditLog.findFirstOrThrow({ where: { action: "session.email", entityId: sess.id, userId: tech.id } });
    expect(sa.newValue).toMatchObject({ subject: expect.stringContaining("uzak destek bağlantınız"), recipient: expect.stringMatching(/^m\*\*\*@example\.test$/) });
    expect((await call(ts, "POST", `/sessions/${sess.id}/email`, { to, link: `${ORIGIN}/session/${"b".repeat(43)}` })).statusCode).toBe(400);
    expect((await call(ts, "POST", `/sessions/${sess.id}/email`, { to, link: `https://kotu.test/session/${sess.token}` })).statusCode).toBe(400);
    const other = await createSupportSessionRow({ tenantId: t.id, technicianId: (await createUser({ tenantId: t.id })).id });
    expect((await call(ts, "POST", `/sessions/${other.id}/email`, { to, link: `${ORIGIN}/session/${other.token}` })).statusCode).toBe(404);
    const { newId } = await import("../../src/lib/ids.ts");
    await db().auditLog.createMany({ data: Array.from({ length: 19 }, () => ({ tenantId: t.id, userId: tech.id, username: tech.email, action: "session.email", entity: "support_sessions", entityId: sess.id, result: "success", ipAddress: "", userAgent: "", correlationId: newId() })) });
    const limited = await call(ts, "POST", `/sessions/${sess.id}/email`, { to, link });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(await db().auditLog.count({ where: { action: "mail.sent", entityId: sess.id, result: "success" } })).toBe(1);
  });
});

describe("AC-151 e-posta bildirim kanalı", () => {
  it("AC-151: SMTP yokken kanal açılamaz; SMTP ile açılır, smtpConfigured=true; e-posta testi gönderir", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    const body = { waitMinutes: 30, trustedCidrs: [], whatsapp: { enabled: false, recipients: [] }, email: { enabled: true, recipients: ["bildirim@firma.test"] } };
    expect((await call(s, "PUT", "/settings/support-requests", body)).json()).toMatchObject({ error: { fields: { "email.enabled": "Önce SMTP ayarlarını yapın" } } });
    await configureSmtp(s);
    const put = await call(s, "PUT", "/settings/support-requests", body);
    expect(put.json()).toMatchObject({ email: { enabled: true, smtpConfigured: true } });
    const to = `kanal-${Date.now()}@firma.test`;
    expect((await call(s, "POST", "/settings/support-requests/email/test", { to })).json()).toEqual({ ok: true, message: "Test e-postası gönderildi." });
    expect(inbox.find((m) => m.to === to)?.body).toContain("Yeni destek talebi");
  });

  it("AC-151: yeni talep → ayarlı her alıcıya e-posta (müşteri verisi yok), audit request.notify{email} + mail.sent; SMTP hatası talebi engellemez", async () => {
    const t = await createTenant();
    const { s } = await enrolledAdmin(t.id);
    await configureSmtp(s);
    const ref = await createRequestSettings(t.id);
    const r1 = `alici1-${Date.now()}@firma.test`;
    const r2 = `alici2-${Date.now()}@firma.test`;
    await db().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { emailEnabled: true, emailRecipients: [r1, r2] } });
    const rc = requestClient(app, wsBase);
    const created = await rc.createReq(ref, "198.51.100.77", { extra: { email: "musteri-ozel@example.test", customerName: "Zeynep Gizliad", phone: "0532 987 65 43", description: "Muhasebe bilgisayari acilmiyor" } });
    expect(created.statusCode, created.body).toBe(201);
    const { requestCode } = created.json<{ requestCode: string }>();
    await expect.poll(() => [r1, r2].every((r) => inbox.some((m) => m.to === r))).toBe(true);
    for (const r of [r1, r2]) {
      const body = decodeQp(inbox.find((m) => m.to === r)?.body ?? "");
      expect(body).toContain("Yeni destek talebi");
      expect(body).toContain(requestCode);
      for (const pii of ["Zeynep", "Gizliad", "987 65 43", "05329876543", "musteri-ozel", "Muhasebe"]) expect(body, pii).not.toContain(pii);
    }
    await expect.poll(() => db().auditLog.count({ where: { tenantId: t.id, action: "request.notify", result: "success", newValue: { path: "$.channel", equals: "email" } } })).toBe(2);
    expect(await db().auditLog.count({ where: { tenantId: t.id, action: "mail.sent", result: "success", newValue: { path: "$.kind", equals: "request_notify" } } })).toBe(2);
    // SMTP hatası: talep yine 201, bildirim audit'i fail.
    await db().tenantSettings.update({ where: { tenantId: t.id }, data: { smtpPort: 25 } });
    const second = await rc.createReq(ref, "198.51.100.78");
    expect(second.statusCode, second.body).toBe(201);
    await expect.poll(() => db().auditLog.count({ where: { tenantId: t.id, action: "request.notify", result: "fail", newValue: { path: "$.channel", equals: "email" } } }), { timeout: 30_000 }).toBe(2);
  });
});
