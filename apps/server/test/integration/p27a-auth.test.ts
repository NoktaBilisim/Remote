// P27a-K3 auth dalı (mimari-p27a §4.1, §4.2, §5.1–5.3; AC-325..329, 331 (Super Admin + anahtar), 332, 333, 335a).
// Gerçek MySQL + fastify.inject + gerçek TOTP kurulumu + süreç içi sahte SMTP (127.0.0.1). Yeniden kullanım/döndürme:
// p27a-rotation.test.ts.
import {
  TRUSTED_DEVICE_COOKIE_PATH,
  TRUSTED_DEVICE_DAYS,
  type LogoutAllResponse,
  type MeResponse,
  type TrustedDeviceListResponse,
} from "@remote/contracts/api/auth";
import { AUTH_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance } from "fastify";
import pino from "pino";
import type { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, makeApp, ORIGIN, testDb } from "../helpers/app.ts";
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "../helpers/mail-tls.ts";
import { newId, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";
import { issue } from "../../src/auth/trusted-device.ts";
import { resetSuperadmin, cliAuditContext } from "../../src/auth/superadmin-reset.ts";
import {
  call,
  enroll,
  freshCode,
  ipFactory,
  passwordLogin,
  rememberDevice,
  tdCookie,
  tdOf,
  type Enrolled,
} from "../helpers/trusted-device.ts";
import { sessionOf } from "../helpers/auth.ts";

const inbox: { to: string; body: string }[] = [];
const logs: string[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let app: FastifyInstance;
const ip = ipFactory(81);
const db = () => testDb();
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

beforeAll(async () => {
  ({ smtp, port: smtpPort } = await startInboxSmtp(inbox));
  const logger = pino({ level: "info" }, { write: (s: string) => void logs.push(s) });
  app = makeApp({
    logger,
    p10: { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => smtpPort), mfaSetupEnforcement: false },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeSmtp(smtp);
});

const decodeQp = (raw: string): string => {
  const bytes = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
};
const rowsOf = (userId: string) => db().trustedDevice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const audits = (userId: string, action: string) =>
  db().auditLog.findMany({ where: { userId, action }, orderBy: { id: "asc" }, select: { newValue: true, result: true, entityId: true } });

async function admin(): Promise<Enrolled & { tenantId: string }> {
  const t = await createTenant();
  return { ...(await enroll(app, ip, { tenantId: t.id })), tenantId: t.id };
}

describe("AC-325 hatırlama seçeneği (verify)", () => {
  it("AC-325: işaretli + doğru TOTP → deviceRemembered, çerez öznitelikleri, DB'de yalnız özet, expires = +30 gün, audit created", async () => {
    const a = await admin();
    const before = Date.now();
    const r = await rememberDevice(app, ip, a, { ua: CHROME_WIN });
    expect(r.body.deviceRemembered).toBe(true);
    const c = tdOf(r.res);
    expect(c).toMatchObject({ path: TRUSTED_DEVICE_COOKIE_PATH, httpOnly: true, secure: true, sameSite: "Strict", maxAge: 2_592_000 });
    expect(c?.domain).toBeUndefined();
    const [id, secret] = (r.cookie ?? "").split(".");
    const rows = await rowsOf(a.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      tenantId: a.tenantId,
      tokenHash: sha256Hex(secret ?? ""),
      uaSummary: "Chrome · Windows",
      lastUsedAt: null,
    });
    const ttl = (rows[0]?.expiresAt.getTime() ?? 0) - (rows[0]?.createdAt.getTime() ?? 0);
    expect(ttl).toBe(TRUSTED_DEVICE_DAYS * 86_400_000);
    expect(rows[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const created = await audits(a.user.id, AUTH_AUDIT.TRUSTED_DEVICE_CREATED);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entityId: id, result: "success", newValue: { uaSummary: "Chrome · Windows" } });
  });

  it("AC-325: işaretsizse çerez/satır oluşmaz (deviceRemembered:false)", async () => {
    const a = await admin();
    const r = await rememberDevice(app, ip, a, { remember: false });
    expect(r.body.deviceRemembered).toBe(false);
    expect(r.cookie).toBeUndefined();
    expect(await rowsOf(a.user.id)).toHaveLength(0);
  });

  it("AC-325: kurtarma koduyla rememberDevice → 400 VALIDATION; kurtarma kodu tek başına geçerli", async () => {
    const a = await admin();
    const l = await passwordLogin(app, ip(), a.user);
    const bad = await call(app, ip(), l.s, "POST", "/auth/mfa/verify", { recoveryCode: a.codes[0], rememberDevice: true });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: "VALIDATION" } });
    const ok = await call(app, ip(), l.s, "POST", "/auth/mfa/verify", { recoveryCode: a.codes[0] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ deviceRemembered: false });
    expect(await rowsOf(a.user.id)).toHaveLength(0);
  });

  it("AC-325/AC-331: me.rememberDeviceAvailable — verify aşamasında true, firma anahtarı kapalıysa false, tam oturumda false", async () => {
    const a = await admin();
    const l = await passwordLogin(app, ip(), a.user);
    const me = async () => (await call(app, ip(), l.s, "GET", "/auth/me")).json<MeResponse>().mfa.rememberDeviceAvailable;
    expect(await me()).toBe(true);
    await db().tenantSettings.update({ where: { tenantId: a.tenantId }, data: { mfaRememberDevice: false } });
    expect(await me()).toBe(false);
    await db().tenantSettings.update({ where: { tenantId: a.tenantId }, data: { mfaRememberDevice: true } });
    const v = await call(app, ip(), l.s, "POST", "/auth/mfa/verify", { code: await freshCode(a) });
    expect(v.statusCode).toBe(200);
  });
});

describe("AC-331 Super Admin ve firma anahtarı", () => {
  it("AC-331/AC-325: Super Admin rememberDevice:true → 200 deviceRemembered:false, satır yok; me false", async () => {
    const sa = await enroll(app, ip, { tenantId: null, role: "SUPER_ADMIN" });
    const l = await passwordLogin(app, ip(), sa.user);
    expect((await call(app, ip(), l.s, "GET", "/auth/me")).json<MeResponse>().mfa.rememberDeviceAvailable).toBe(false);
    const r = await rememberDevice(app, ip, sa);
    expect(r.body.deviceRemembered).toBe(false);
    expect(r.cookie).toBeUndefined();
    expect(await rowsOf(sa.user.id)).toHaveLength(0);
  });

  it("AC-331: anahtar kapalıyken rememberDevice yok sayılır ve mevcut çerez TOTP'yi atlatmaz (çerez silinir)", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    await db().tenantSettings.update({ where: { tenantId: a.tenantId }, data: { mfaRememberDevice: false } });
    const l = await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""));
    expect(l.body?.mfaRequired).toBe(true);
    expect(tdOf(l.res)?.value).toBe("");
    const again = await rememberDevice(app, ip, a);
    expect(again.body.deviceRemembered).toBe(false);
  });
});

describe("AC-326 hatırlanan cihazla giriş", () => {
  it("AC-326: doğru şifre + geçerli çerez → mfaRequired:false; used audit + auth.login {mfa:remembered}; last_used/ip; expires sabit; döndürme", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    const [before] = await rowsOf(a.user.id);
    const loginIp = ip();
    const l = await passwordLogin(app, loginIp, a.user, tdCookie(cookie ?? ""));
    expect(l.body).toMatchObject({ mfaRequired: false, mfaSetupRequired: false });
    const next = tdOf(l.res);
    expect(next?.value).toMatch(new RegExp(`^${before?.id}\\.`));
    expect(next?.value).not.toBe(cookie);
    const [after] = await rowsOf(a.user.id);
    expect(after?.expiresAt.getTime()).toBe(before?.expiresAt.getTime());
    expect(after?.ip).toBe(loginIp);
    expect(after?.lastUsedAt).not.toBeNull();
    expect((await audits(a.user.id, AUTH_AUDIT.TRUSTED_DEVICE_USED))[0]?.entityId).toBe(before?.id);
    const logins = await audits(a.user.id, "auth.login");
    expect(logins.at(-1)?.newValue).toEqual({ mfa: "remembered" });
    expect((await call(app, ip(), l.s, "GET", "/users")).statusCode).toBe(200); // tam oturum
  });

  it("AC-326: hatalı şifre çerezle de 401 ve satıra dokunulmaz; kilitli hesap çerezle 423", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    const [before] = await rowsOf(a.user.id);
    const bad = await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""), "Yanlis-Sifre-999");
    expect(bad.res.statusCode).toBe(401);
    expect(tdOf(bad.res)).toBeUndefined();
    expect((await rowsOf(a.user.id))[0]).toEqual(before);
    await db().user.update({ where: { id: a.user.id }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    const locked = await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""));
    expect(locked.res.statusCode).toBe(423);
    expect((await rowsOf(a.user.id))[0]).toEqual(before);
  });

  it("AC-326: süresi dolmuş belirteç → TOTP adımı, çerez silinir, satır silinmez", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    const [row] = await rowsOf(a.user.id);
    // TTL CHECK (≤ 30 gün) bozulmadan geçmişe kaydır.
    await db().trustedDevice.update({
      where: { id: row?.id ?? "" },
      data: { createdAt: new Date(Date.now() - 31 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) },
    });
    const l = await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""));
    expect(l.body?.mfaRequired).toBe(true);
    expect(tdOf(l.res)?.value).toBe("");
    expect(await rowsOf(a.user.id)).toHaveLength(1);
  });

  it("AC-326: başka kullanıcının geçerli belirteci yok sayılır (TOTP) ve silinmez", async () => {
    const a = await admin();
    const b = await enroll(app, ip, { tenantId: a.tenantId });
    const { cookie } = await rememberDevice(app, ip, a);
    const [before] = await rowsOf(a.user.id);
    const l = await passwordLogin(app, ip(), b.user, tdCookie(cookie ?? ""));
    expect(l.body?.mfaRequired).toBe(true);
    expect((await rowsOf(a.user.id))[0]).toEqual(before);
    expect(await audits(b.user.id, AUTH_AUDIT.TRUSTED_DEVICE_REUSE)).toHaveLength(0);
  });

  it("AC-326: aynı adlı iki çerez — biri bilinmeyen biri geçerli → atlama", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    const l = await passwordLogin(app, ip(), a.user, `${tdCookie("bozuk-deger")}; ${tdCookie(cookie ?? "")}`);
    expect(l.body?.mfaRequired).toBe(false);
  });

  it("AC-326: hatırlanan cihaz mustChangePassword zorunluluğunu atlamaz", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    await db().user.update({ where: { id: a.user.id }, data: { mustChangePassword: true } });
    const l = await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""));
    expect(l.body).toMatchObject({ mfaRequired: false, mustChangePassword: true });
    expect((await call(app, ip(), l.s, "GET", "/users")).json()).toMatchObject({ error: { code: "PASSWORD_CHANGE_REQUIRED" } });
  });

  it("AC-326: TOTP'si olmayan kullanıcıda çerez kurulum aşamasını atlatmaz (setup)", async () => {
    const t = await createTenant();
    const enforced = makeApp({ p10: { mfaSetupEnforcement: true } });
    try {
      const a = await enroll(enforced, ip, { tenantId: t.id });
      const { cookie } = await rememberDevice(enforced, ip, a);
      await db().user.update({ where: { id: a.user.id }, data: { totpEnabled: false, totpSecretEnc: null, totpLastStep: null } });
      const l = await passwordLogin(enforced, ip(), a.user, tdCookie(cookie ?? ""));
      expect(l.body).toMatchObject({ mfaRequired: false, mfaSetupRequired: true });
      expect(tdOf(l.res)?.value).toBe("");
    } finally {
      await enforced.close();
    }
  });
});

describe("AC-327 step-up atlanmaz", () => {
  it("AC-327: hatırlanan cihazla açılan oturumda step_up_at NULL; step-up korumalı uç 401 MFA_STEP_UP_REQUIRED", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    const victim = await createUser({ tenantId: a.tenantId });
    const l = await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""));
    expect(l.body?.mfaRequired).toBe(false);
    const s = await db().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(l.s.token) } });
    expect(s).toMatchObject({ mfaPassed: true, stepUpAt: null });
    const del = await call(app, ip(), l.s, "DELETE", `/users/${victim.id}`);
    expect(del.statusCode).toBe(401);
    expect(del.json()).toMatchObject({ error: { code: "MFA_STEP_UP_REQUIRED" } });
  });
});

describe("AC-328 geçersiz kılma (auth dalı)", () => {
  const skipsTotp = async (a: Enrolled, cookie: string | undefined) =>
    (await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""))).body?.mfaRequired === false;

  it("AC-328: şifre değişimi → tüm cihazlar silinir; audit revokedTrustedDevices", async () => {
    const a = await admin();
    const { cookie, s } = await rememberDevice(app, ip, a);
    const r = await call(app, ip(), s, "POST", "/auth/password/change", { current: a.user.password, next: "Yeni-Guclu-Sifre-456" });
    expect(r.statusCode).toBe(204);
    expect(await rowsOf(a.user.id)).toHaveLength(0);
    expect((await audits(a.user.id, "auth.password_change")).at(-1)?.newValue).toMatchObject({ revokedTrustedDevices: 1 });
    const l = await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""), "Yeni-Guclu-Sifre-456");
    expect(l.body?.mfaRequired).toBe(true);
  });

  it("AC-328: e-postayla şifre sıfırlama → tüm cihazlar silinir; audit revokedTrustedDevices", async () => {
    const a = await admin();
    const { cookie } = await rememberDevice(app, ip, a);
    const token = newSecretToken();
    await db().passwordResetToken.create({
      data: { id: newId(), userId: a.user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 600_000) },
    });
    const r = await call(app, ip(), null, "POST", "/auth/password/reset", { token, next: "Yeni-Guclu-Sifre-789" });
    expect(r.statusCode, r.body).toBe(204);
    expect(await rowsOf(a.user.id)).toHaveLength(0);
    expect((await audits(a.user.id, AUTH_AUDIT.PASSWORD_RESET)).at(-1)?.newValue).toMatchObject({ revokedTrustedDevices: 1 });
    expect((await passwordLogin(app, ip(), a.user, tdCookie(cookie ?? ""), "Yeni-Guclu-Sifre-789")).body?.mfaRequired).toBe(true);
  });

  it("AC-328: Super Admin sıfırlaması (CLI çekirdeği) audit'e revokedTrustedDevices yazar (Super Admin satırı yapısal olarak yok → 0)", async () => {
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const r = await resetSuperadmin(db(), cliAuditContext(), { email: sa.email, resetMfa: false, dryRun: false });
    expect(r.kind).toBe("reset");
    const row = await db().auditLog.findFirstOrThrow({
      where: { entityId: sa.id, action: AUTH_AUDIT.SUPERADMIN_RESET, result: "success" },
    });
    expect(row.newValue).toMatchObject({ revokedTrustedDevices: 0 });
  });

  it("AC-328: 2FA yeniden etkinleştirme → tüm cihazlar silinir; audit revokedTrustedDevices", async () => {
    const a = await admin();
    const { cookie, s } = await rememberDevice(app, ip, a);
    // Admin 2FA sıfırlaması (K4) sonrası durum: TOTP kapalı; cihaz satırı kalmış olsa bile yeniden etkinleştirme siler.
    await db().user.update({ where: { id: a.user.id }, data: { totpEnabled: false, totpSecretEnc: null, totpLastStep: null } });
    const setup = (await call(app, ip(), s, "POST", "/auth/mfa/setup", {})).json<{ secret: string }>();
    const re: Enrolled = { ...a, secret: setup.secret };
    const en = await call(app, ip(), s, "POST", "/auth/mfa/enable", { code: await freshCode(re) });
    expect(en.statusCode, en.body).toBe(200);
    expect(await rowsOf(a.user.id)).toHaveLength(0);
    expect((await audits(a.user.id, AUTH_AUDIT.MFA_ENABLED)).at(-1)?.newValue).toMatchObject({ revokedTrustedDevices: 1 });
    expect(await skipsTotp(re, cookie)).toBe(false);
  });

  it("AC-328: tüm cihazlardan çıkış → bu cihaz dahil silinir, yanıt sayıyı verir ve çerezi siler", async () => {
    const a = await admin();
    const one = await rememberDevice(app, ip, a);
    await rememberDevice(app, ip, a);
    const r = await call(app, ip(), one.s, "POST", "/auth/logout-all", {}, tdCookie(one.cookie ?? ""));
    expect(r.statusCode).toBe(200);
    expect(r.json<LogoutAllResponse>()).toMatchObject({ revokedTrustedDevices: 2 });
    expect(tdOf(r)?.value).toBe("");
    expect(await rowsOf(a.user.id)).toHaveLength(0);
    expect((await audits(a.user.id, AUTH_AUDIT.LOGOUT_ALL)).at(-1)?.newValue).toMatchObject({ revokedTrustedDevices: 2 });
    expect(await skipsTotp(a, one.cookie)).toBe(false);
  });
});

describe("AC-329 profil uçları", () => {
  it("AC-329: liste yalnız kendi cihazları, en yeni önce, 'Bu cihaz' işaretli, belirteç/özet yok", async () => {
    const a = await admin();
    await rememberDevice(app, ip, a, { ua: CHROME_WIN });
    const second = await rememberDevice(app, ip, a);
    const r = await call(app, ip(), second.s, "GET", "/auth/trusted-devices", undefined, tdCookie(second.cookie ?? ""));
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const { items } = r.json<TrustedDeviceListResponse>();
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(second.cookie?.split(".")[0]);
    expect(items.map((i) => i.current)).toEqual([true, false]);
    expect(items[1]?.uaSummary).toBe("Chrome · Windows");
    const rows = await rowsOf(a.user.id);
    for (const row of rows) expect(r.body).not.toContain(row.tokenHash);
    expect(r.body).not.toContain(second.cookie?.split(".")[1]);
  });

  it("AC-329: boş liste; yarım oturum MFA_REQUIRED; oturumsuz 401", async () => {
    const a = await admin();
    const l = await passwordLogin(app, ip(), a.user);
    expect((await call(app, ip(), l.s, "GET", "/auth/trusted-devices")).json()).toMatchObject({ error: { code: "MFA_REQUIRED" } });
    const v = await call(app, ip(), l.s, "POST", "/auth/mfa/verify", { code: await freshCode(a) });
    const r = await call(app, ip(), sessionOf(v), "GET", "/auth/trusted-devices");
    expect(r.json()).toEqual({ items: [] });
    expect((await call(app, ip(), null, "GET", "/auth/trusted-devices")).statusCode).toBe(401);
  });

  it("AC-329: tekil kaldırma — bu cihazsa çerez silinir; başkasının id'si / olmayan id 404; geçersiz id 400; audit reason:user", async () => {
    const a = await admin();
    const b = await admin();
    const bDev = await rememberDevice(app, ip, b);
    const mine = await rememberDevice(app, ip, a);
    const myId = mine.cookie?.split(".")[0] ?? "";
    const other = await call(app, ip(), mine.s, "DELETE", `/auth/trusted-devices/${bDev.cookie?.split(".")[0]}`);
    expect(other.statusCode).toBe(404);
    expect(await rowsOf(b.user.id)).toHaveLength(1);
    expect((await call(app, ip(), mine.s, "DELETE", "/auth/trusted-devices/bozuk")).statusCode).toBe(400);
    const r = await call(app, ip(), mine.s, "DELETE", `/auth/trusted-devices/${myId}`, undefined, tdCookie(mine.cookie ?? ""));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ revoked: 1, currentCleared: true });
    expect(tdOf(r)?.value).toBe("");
    expect((await call(app, ip(), mine.s, "DELETE", `/auth/trusted-devices/${myId}`)).statusCode).toBe(404);
    expect((await audits(a.user.id, AUTH_AUDIT.TRUSTED_DEVICE_REVOKED)).at(-1)?.newValue).toEqual({ reason: "user", count: 1 });
  });

  it("AC-329: tümünü kaldır; CSRF başlığı olmadan 403", async () => {
    const a = await admin();
    await rememberDevice(app, ip, a);
    const cur = await rememberDevice(app, ip, a);
    const noCsrf = await app.inject({
      method: "DELETE",
      url: "/api/v1/auth/trusted-devices",
      headers: { cookie: cur.s.headers.cookie, origin: ORIGIN },
      remoteAddress: ip(),
    });
    expect(noCsrf.statusCode).toBe(403);
    const r = await call(app, ip(), cur.s, "DELETE", "/auth/trusted-devices", undefined, tdCookie(cur.cookie ?? ""));
    expect(r.json()).toEqual({ revoked: 2, currentCleared: true });
    expect(await rowsOf(a.user.id)).toHaveLength(0);
  });
});

describe("AC-332 üst sınır", () => {
  it("AC-332: 11. cihazda en eski düşer (audit reason:limit); paralel iki oluşturmada sınır aşılmaz", async () => {
    const a = await admin();
    const ctx = { ip: "10.0.0.1", userAgent: CHROME_WIN, requestId: "t" };
    const owner = { id: a.user.id, tenantId: a.tenantId, email: a.user.email };
    for (let i = 0; i < 10; i++) await db().$transaction((tx) => issue(tx, ctx, owner, [], new Date(Date.now() + i)));
    const oldest = (await rowsOf(a.user.id))[0];
    const viaApi = await rememberDevice(app, ip, a);
    expect(viaApi.body.deviceRemembered).toBe(true);
    const rows = await rowsOf(a.user.id);
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => r.id === oldest?.id)).toBe(false);
    expect((await audits(a.user.id, AUTH_AUDIT.TRUSTED_DEVICE_REVOKED)).at(-1)?.newValue).toEqual({ reason: "limit", count: 1 });
    await Promise.all([0, 1].map(() => db().$transaction((tx) => issue(tx, ctx, owner, [], new Date()))));
    expect(await rowsOf(a.user.id)).toHaveLength(10);
  });
});

describe("AC-333 gizlilik ve AC-335a bildirim", () => {
  it("AC-335a: hatırlamada tek 'Yeni cihaz' e-postası (cihaz, IP; belirteç ve bağlantı yok); AC-333 log/audit'te belirteç/özet yok", async () => {
    const a = await admin();
    const s = (await passwordLogin(app, ip(), a.user)).s;
    const v = await call(app, ip(), s, "POST", "/auth/mfa/verify", { code: await freshCode(a) });
    const full = sessionOf(v);
    const put = await call(app, ip(), full, "PUT", "/settings/tenant", {
      smtp: { host: "smtp.test", port: 2525, security: "NONE", fromEmail: "destek@firma.test", fromName: "Firma" },
    });
    expect(put.statusCode, put.body).toBe(200);
    const r = await rememberDevice(app, ip, a, { ua: CHROME_WIN });
    const secret = r.cookie?.split(".")[1] ?? "";
    await expect.poll(() => inbox.filter((m) => m.to === a.user.email && decodeQp(m.body).includes("30 gün boyunca")).length).toBe(1);
    const mail = decodeQp(inbox.find((m) => m.to === a.user.email && decodeQp(m.body).includes("30 gün boyunca"))?.body ?? "");
    expect(mail).toContain("Chrome · Windows");
    expect(mail).not.toContain(secret);
    expect(mail).not.toMatch(/<a\s/i);
    // Giriş + döndürme de loglansın.
    const l = await passwordLogin(app, ip(), a.user, tdCookie(r.cookie ?? ""));
    const rotated = tdOf(l.res)?.value.split(".")[1] ?? "";
    const hashes = (await rowsOf(a.user.id)).map((x) => x.tokenHash);
    const all = logs.join("\n");
    const auditText = JSON.stringify(
      await db().auditLog.findMany({ where: { userId: a.user.id }, select: { oldValue: true, newValue: true, entityId: true } }),
    );
    for (const needle of [secret, rotated, sha256Hex(secret), ...hashes]) {
      expect(all).not.toContain(needle);
      expect(auditText).not.toContain(needle);
    }
    expect(all).toContain('"trustedDevice":"used"');
  });

  it("AC-335a: SMTP yoksa e-posta gitmez, mail.sent not_configured audit'i; doğrulama yanıtı 200", async () => {
    const a = await admin();
    const r = await rememberDevice(app, ip, a);
    expect(r.res.statusCode).toBe(200);
    await expect
      .poll(async () =>
        (await db().auditLog.findMany({ where: { userId: a.user.id, action: "mail.sent" } })).some(
          (x) =>
            (x.newValue as { kind?: string; reason?: string }).kind === "trusted_device_created" &&
            (x.newValue as { reason?: string }).reason === "not_configured",
        ),
      )
      .toBe(true);
  });
});
