// P14a A2 — 2FA kurulum yarışı (AC-214) ve step-up (AC-215, ADR-0022, K-E11-1). Gerçek MySQL + inject; gerçek TOTP
// (RFC 6238) ve süreç içi sahte SMTP (smtp-server, 127.0.0.1; account-p10 kalıbı). TOTP adım sınırı oynamasın diye
// hesap servisinin saati adım ortasına sabitlenir (`app.account.now`).
import type { MfaEnableResponse, MfaSetupResponse, StepUpResponse } from "@remote/contracts/api/auth";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mfaSetup } from "../../src/auth/account.ts";
import { base32Decode, hotp, recoveryCodeCandidates, stepOf, TOTP_STEP_SEC } from "../../src/auth/mfa.ts";
import { resolveSession } from "../../src/auth/session.ts";
import { sha256Hex } from "../../src/lib/ids.ts";
import { createNetGuard, isBlockedIp } from "../../src/lib/netguard.ts";
import type { TransportFactory } from "../../src/mail/service.ts";
import { createTenant, createUser, loginRequest, makeApp, ORIGIN, testDb, type Session, type TestUser } from "../helpers/app.ts";

const inbox: { to: string; body: string }[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let app: FastifyInstance;
/** Adım ortası: kodlar t-1..t+1 penceresinde kalır; test süresince adım değişmez. */
const NOW = (stepOf(Date.now()) + 0.5) * TOTP_STEP_SEC * 1000;
const step = stepOf(NOW);

const transport: TransportFactory = (o) =>
  nodemailer.createTransport({ ...o, port: o.port === 2525 ? smtpPort : 9 } as Parameters<typeof nodemailer.createTransport>[0]);

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
  const netguard = createNetGuard({
    lookupAll: async (h) => (h === "smtp.test" ? ["127.0.0.1"] : []),
    isBlocked: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip),
  });
  app = makeApp({ p10: { netguard, mailTransport: transport } });
  await app.ready();
  app.account.now = () => NOW;
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => smtp.close(() => r()));
});

const db = () => testDb();
let ipSeq = 0;
const nextIp = () => `10.15.${Math.floor(++ipSeq / 250) + 1}.${(ipSeq % 250) + 1}`;

async function signIn(u: TestUser): Promise<Session> {
  const res = await app.inject(loginRequest(u.email, u.password, { remoteAddress: nextIp() }));
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}`);
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const token = jar[SESSION_COOKIE] ?? "";
  const csrf = jar[CSRF_COOKIE] ?? "";
  return { token, headers: { cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN } };
}
const call = (s: Session, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object, remoteAddress = "10.15.0.1") =>
  app.inject({ method, url: `/api/v1${url}`, headers: s.headers, remoteAddress, ...(payload === undefined ? {} : { payload }) });

const code = (secret: string, offset: number) => hotp(base32Decode(secret), step + offset);

/** 2FA'yı gerçek akışla kurar (etkinleştirme t-1 adımını tüketir → step-up için t ve t+1 kalır). */
async function enrolled(u: TestUser) {
  const s = await signIn(u);
  const setup = (await call(s, "POST", "/auth/mfa/setup", {})).json<MfaSetupResponse>();
  const en = await call(s, "POST", "/auth/mfa/enable", { code: code(setup.secret, -1) });
  expect(en.statusCode, en.body).toBe(200);
  return { s, secret: setup.secret, codes: en.json<MfaEnableResponse>().recoveryCodes };
}

const stepUpAudits = (userId: string) =>
  db().auditLog.findMany({ where: { userId, action: "auth.step_up" }, orderBy: { id: "asc" }, select: { result: true, newValue: true } });

/** Hassas uçlar — geçersiz gövdeyle: guard geçilirse 400 (ortak sistem ayarı satırlarına yazılmaz). */
const SENSITIVE = [
  ["PUT", "/admin/settings/mysql", { host: "" }],
  ["PUT", "/admin/settings/turn", { urls: [] }],
  ["DELETE", "/admin/settings/turn", undefined],
  ["PUT", "/admin/settings/whatsapp", { url: "ftp://x" }],
  ["DELETE", "/admin/settings/whatsapp", undefined],
] as const;

describe("AC-214 paralel mfa/setup yarışı", () => {
  it("AC-214: sürüm okuma ile koşullu UPDATE arasına giren kurulum → bekleyen istek deterministik 409 (gecikme kancalı, 20/20)", async () => {
    const t = await createTenant();
    for (let round = 0; round < 20; round++) {
      const u = await createUser({ tenantId: t.id, role: "ADMIN" });
      const s = await signIn(u);
      const auth = await resolveSession(db(), s.token, new Date(), { setupEnforced: false });
      if (!auth) throw new Error("oturum");
      let release!: () => void;
      let enter!: () => void;
      const entered = new Promise<void>((r) => (enter = r));
      const released = new Promise<void>((r) => (release = r));
      const slow = mfaSetup(app.account, { ip: "10.15.0.2", userAgent: "vitest", requestId: "ac214" }, auth, {
        afterLock: async () => {
          enter();
          await released;
        },
      }).then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "error",
      );
      await entered;
      const fast = await call(s, "POST", "/auth/mfa/setup", {});
      expect(fast.statusCode).toBe(200);
      release();
      expect(await slow, `tur ${round}`).toBe("CONFLICT");
      const row = await db().user.findUniqueOrThrow({ where: { id: u.id }, select: { version: true, totpEnabled: true } });
      expect(row).toEqual({ version: 1, totpEnabled: false });
      expect(await db().auditLog.count({ where: { userId: u.id, action: "auth.mfa_setup" } })).toBe(1);
      // kazananın sırrı geçerli: onun koduyla etkinleşir
      const en = await call(s, "POST", "/auth/mfa/enable", { code: code(fast.json<MfaSetupResponse>().secret, 0) });
      expect(en.statusCode, `tur ${round}`).toBe(200);
    }
  });
});

describe("AC-215 step-up", () => {
  it("AC-215: TOTP'si kurulu olmayan Super Admin → hassas uçlar ve /auth/step-up 403 MFA_SETUP_REQUIRED; okuma serbest", async () => {
    const s = await signIn(await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    for (const [m, u, p] of SENSITIVE) {
      const r = await call(s, m, u, p);
      expect(r.statusCode, `${m} ${u}`).toBe(403);
      expect(r.json().error.code).toBe("MFA_SETUP_REQUIRED");
    }
    expect((await call(s, "POST", "/auth/step-up", { method: "TOTP", code: "123456" })).json().error.code).toBe("MFA_SETUP_REQUIRED");
    expect((await call(s, "GET", "/admin/settings/turn")).statusCode).toBe(200);
  });

  it("AC-215: step-up yoksa 401 MFA_STEP_UP_REQUIRED (oturum geçerli kalır); TOTP ile step-up → 5 dk açık; aynı kod ikinci kez reddedilir; süre dolunca yine 401", async () => {
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const { s, secret } = await enrolled(sa);
    for (const [m, u, p] of SENSITIVE) {
      const r = await call(s, m, u, p);
      expect(r.statusCode, `${m} ${u}`).toBe(401);
      expect(r.json().error.code).toBe("MFA_STEP_UP_REQUIRED");
    }
    expect((await call(s, "GET", "/auth/me")).statusCode).toBe(200);

    const ok = await call(s, "POST", "/auth/step-up", { method: "TOTP", code: code(secret, 0) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const body = ok.json<StepUpResponse>();
    expect(body).toEqual({ method: "TOTP", stepUpUntil: new Date(NOW + 300_000).toISOString() });
    const row = await db().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(s.token) } });
    expect(row.stepUpAt?.getTime()).toBe(NOW);
    // guard geçildi → gövde doğrulaması (400). DELETE'ler gövdesiz olduğundan burada çağrılmaz (paylaşılan satırı yazardı).
    for (const [m, u, p] of SENSITIVE.filter(([m]) => m === "PUT")) expect((await call(s, m, u, p)).statusCode, `${m} ${u}`).toBe(400);

    const replay = await call(s, "POST", "/auth/step-up", { method: "TOTP", code: code(secret, 0) });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.fields).toHaveProperty("code");
    expect(await stepUpAudits(sa.id)).toEqual([
      { result: "success", newValue: { method: "TOTP", remaining: 10 } },
      { result: "fail", newValue: { method: "TOTP", reason: "replayed_code" } },
    ]);

    await db().authSession.update({ where: { tokenHash: sha256Hex(s.token) }, data: { stepUpAt: new Date(Date.now() - 301_000) } });
    expect((await call(s, "PUT", "/admin/settings/turn", { urls: [] })).json().error.code).toBe("MFA_STEP_UP_REQUIRED");
    // step-up oturuma bağlı: başka oturum (aynı kullanıcı) ayrıca ister
    await db().authSession.update({ where: { tokenHash: sha256Hex(s.token) }, data: { stepUpAt: new Date() } });
    const other = await signIn(sa);
    await db().authSession.update({ where: { tokenHash: sha256Hex(other.token) }, data: { mfaPassed: true } });
    expect((await call(other, "DELETE", "/admin/settings/turn")).json().error.code).toBe("MFA_STEP_UP_REQUIRED");
  });

  it('AC-215: kurtarma koduyla step-up — kod tüketilir (ikinci kullanım ret), audit {method, remaining} kod içermez, "Kurtarma kodunuz kullanıldı" e-postası, kalan ≤ 3 bilgisi yanıtta', async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const { s, codes } = await enrolled(admin);
    const put = await call(s, "PUT", "/settings/tenant", {
      smtp: { host: "smtp.test", port: 2525, security: "NONE", fromEmail: "destek@firma.test", fromName: "Firma Destek" },
    });
    expect(put.statusCode, put.body).toBe(200);
    const [c1, c2] = codes;
    if (!c1 || !c2) throw new Error("kod");

    const r = await call(s, "POST", "/auth/step-up", { method: "RECOVERY", code: c1.toLowerCase() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<StepUpResponse>()).toMatchObject({ method: "RECOVERY", recoveryCodesLeft: 9 });
    expect((await call(s, "POST", "/auth/step-up", { method: "RECOVERY", code: c1 })).statusCode).toBe(400);
    await expect.poll(() => inbox.filter((m) => m.to === admin.email).length).toBe(1);
    const mail = inbox.find((m) => m.to === admin.email)?.body ?? "";
    expect(mail).toContain("Subject: =?UTF-8?Q?Kurtarma_kodunuz_kullan=C4=B1ld=C4=B1?=");
    expect(mail).not.toContain(c1);

    // 9 → 3: kalan uyarı eşiği (c2 hariç 6 kod kullanılmış sayılır)
    await db().recoveryCode.updateMany({
      where: { userId: admin.id, usedAt: null, codeHash: { notIn: recoveryCodeCandidates(app.secrets, c2) } },
      data: { usedAt: new Date() },
      limit: 6,
    });
    const low = await call(s, "POST", "/auth/step-up", { method: "RECOVERY", code: c2 });
    expect(low.json<StepUpResponse>().recoveryCodesLeft).toBe(2);

    const audits = await stepUpAudits(admin.id);
    expect(audits).toEqual([
      { result: "success", newValue: { method: "RECOVERY", remaining: 9 } },
      { result: "fail", newValue: { method: "RECOVERY", reason: "invalid_code" } },
      { result: "success", newValue: { method: "RECOVERY", remaining: 2 } },
    ]);
    expect(JSON.stringify(audits)).not.toMatch(new RegExp(`${c1}|${c2}`, "i"));
    await expect
      .poll(() => db().auditLog.count({ where: { userId: admin.id, action: "mail.sent", result: "success" } }))
      .toBeGreaterThanOrEqual(2);
  });

  it("AC-215: hatalı kod 400 fields.code; deneme sayacı /auth/mfa/verify ile ortak — 6. deneme 429 + Retry-After; geçersiz gövde 400", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const { s, secret } = await enrolled(admin);
    const wrong = code(secret, 0) === "000000" ? "111111" : "000000";
    for (const bad of [{}, { method: "TOTP", code: "12" }, { method: "SMS", code: "123456" }, { method: "RECOVERY", code: "123456" }])
      expect((await call(s, "POST", "/auth/step-up", bad, "10.15.9.9")).statusCode, JSON.stringify(bad)).toBe(400);
    for (let i = 0; i < 5; i++) {
      const r = await call(s, "POST", "/auth/step-up", { method: "TOTP", code: wrong }, "10.15.9.9");
      expect(r.statusCode).toBe(400);
      expect(r.json().error.fields).toHaveProperty("code");
    }
    const locked = await call(s, "POST", "/auth/step-up", { method: "TOTP", code: code(secret, 0) }, "10.15.9.9");
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect(await db().authSession.count({ where: { userId: admin.id, stepUpAt: { not: null } } })).toBe(0);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/step-up", headers: { origin: ORIGIN }, payload: {} })).statusCode).toBe(
      401,
    );
  });
});
