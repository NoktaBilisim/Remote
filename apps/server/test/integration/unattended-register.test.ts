// P27-K2 cihaz kayıt ucu `POST /api/v1/unattended/register` (mimari-p27 §4.2 r2, §4.5, §7.1; AC-273, 296, 297, 337, 339).
// Kimliksiz (kayıt kodu); IP başına 10/sa, IP başına 5 yanlış kodda 15 dk kilit, sistem geneli yalnız BAŞARISIZ 100/sa.
// Her test kendi IP'sinden gelir (`remoteAddress`); tavan testi ayrı uygulama örneğinde (sayaçlar süreç içi).
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SMTPServer } from "smtp-server";
import { createTenant, createUser, loginStepUp, makeApp, testDb, type TestUser } from "../helpers/app.ts";
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "../helpers/mail-tls.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { contactRow, setSmtp, SHA, UNSIGNED_ENV } from "../helpers/unattended.ts";

const inbox: { to: string; body: string }[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let app: FastifyInstance;
let signedApp: FastifyInstance;
let ipSeq = 0;
const nextIp = (): string => `198.51.100.${(++ipSeq % 250) + 1}`;

beforeAll(async () => {
  ({ smtp, port: smtpPort } = await startInboxSmtp(inbox));
  const p10 = { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => smtpPort), mfaSetupEnforcement: false };
  app = makeApp({ env: { ...UNSIGNED_ENV }, p10 });
  const signedEnv = { UNATTENDED_MODE: "signed", DEPLOY_ENV: "development", UNATTENDED_SIGNED_SHA256: SHA };
  signedApp = makeApp({ env: signedEnv, p10 });
  await Promise.all([app.ready(), signedApp.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), signedApp.close()]);
  await closeSmtp(smtp);
});

interface Firm {
  tenantId: string;
  admin: TestUser;
  customerId: string;
  email: string;
}

async function firm(): Promise<Firm> {
  const t = await createTenant();
  await setSmtp(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const customer = await createCustomerRow(t.id);
  return { tenantId: t.id, admin, customerId: customer.id, email: await contactRow(t.id, customer.id) };
}

async function codeFor(f: Firm, a = app): Promise<string> {
  const s = await loginStepUp(a, f.admin);
  const r = await a.inject({
    method: "POST",
    url: "/api/v1/unattended/registration-codes",
    headers: s.headers,
    payload: { customerId: f.customerId },
  });
  expect(r.statusCode).toBe(201);
  return r.json<{ code: string }>().code;
}

const body = (code: string, o: { signed?: boolean; key?: string } = {}) => ({
  code,
  publicKey: o.key ?? randomBytes(32).toString("base64url"),
  name: "MUHASEBE-PC",
  osVersion: "Windows 11 Pro 23H2",
  version: "1.0.0",
  sha256: SHA,
  signed: o.signed ?? false,
});
const register = (payload: object, ip: string, a = app) =>
  a.inject({ method: "POST", url: "/api/v1/unattended/register", payload, remoteAddress: ip });
const code = (r: { statusCode: number; json: () => unknown }) =>
  `${r.statusCode} ${(r.json() as { error?: { code: string } }).error?.code ?? ""}`.trim();
const WRONG = "ABCD-EFGH-JKMN-PQRS";

describe("P27-K2 POST /unattended/register", () => {
  it("AC-273 AC-337: geçerli kod → cihaz (Yeni — doğrulanmadı, kayıt IP'si) + UN_DEVICE_REGISTERED + manage sahiplerine e-posta; kod tek kullanım", async () => {
    const f = await firm();
    const other = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const c = await codeFor(f);
    const ip = nextIp();
    const before = inbox.length;
    const r = await register(body(c.toLowerCase().replace(/-/g, " ")), ip); // normalize: küçük harf/boşluk
    expect(r.statusCode).toBe(200);
    const out = r.json<{ deviceId: string; tenantName: string; customerName: string }>();
    expect(out.tenantName).toMatch(/^Firma /);
    const dev = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: out.deviceId } });
    expect(dev).toMatchObject({
      tenantId: f.tenantId,
      customerId: f.customerId,
      registeredIp: ip,
      verifiedAt: null,
      registeredBy: f.admin.id,
    });
    const rows = await testDb().notificationOutbox.findMany({ where: { tenantId: f.tenantId, kind: "UN_DEVICE_REGISTERED" } });
    // Eşzamanlı dosyaların tick()'i satırı önceden teslim etmiş olabilir: yalnız varlık + kanal doğrulanır.
    expect(rows.map((x) => x.channel)).toEqual(["EMAIL"]);
    expect(["PENDING", "SENT"]).toContain(rows[0]?.state);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: out.deviceId, action: "unattended.device.registered" } });
    expect(audit.newValue).toMatchObject({ customerId: f.customerId, name: "MUHASEBE-PC", signed: false, ip, eventId: rows[0]?.eventId });
    expect(JSON.stringify(audit.newValue)).not.toContain(c.replace(/-/g, ""));
    await expect.poll(() => inbox.slice(before).some((m) => m.to === other.email)).toBe(true);
    for (let i = 0; i < 5 && (await testDb().notificationOutbox.count({ where: { id: rows[0]?.id, state: "SENT" } })) === 0; i++)
      await app.outbox.tick();
    expect(await testDb().notificationOutbox.findUniqueOrThrow({ where: { id: rows[0]?.id ?? "" } })).toMatchObject({ state: "SENT" });
    expect(inbox.some((m) => m.to === f.email)).toBe(true);
    expect(code(await register(body(c), ip))).toBe("404 REGISTRATION_CODE_INVALID");
  });

  it("AC-273: aynı kodla eşzamanlı iki kayıt → biri 200, diğeri 404; tek cihaz", async () => {
    const f = await firm();
    const c = await codeFor(f);
    const res = await Promise.all([register(body(c), nextIp()), register(body(c), nextIp())]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect(await testDb().unattendedDevice.count({ where: { customerId: f.customerId } })).toBe(1);
  });

  it("AC-339: IP başına 5 yanlış koddan sonra o IP 429 (geçerli kod dahil); başka IP'den geçerli kod kaydolur; aynı açık anahtar 409", async () => {
    const f = await firm();
    const c = await codeFor(f);
    const ip = nextIp();
    for (let i = 0; i < 5; i++) expect(code(await register(body(WRONG), ip))).toBe("404 REGISTRATION_CODE_INVALID");
    expect(code(await register(body(c), ip))).toBe("429 RATE_LIMITED");
    const key = randomBytes(32).toString("base64url");
    expect((await register(body(c, { key }), nextIp())).statusCode).toBe(200);
    expect(code(await register(body(await codeFor(f), { key }), nextIp()))).toBe("409 CONFLICT");
    const fails = await testDb().auditLog.findMany({ where: { action: "unattended.device.registered", result: "fail", ipAddress: ip } });
    expect(fails.length).toBeGreaterThanOrEqual(5);
  });

  it("AC-297: signed modda imzasız beyan → 409 UNATTENDED_DISABLED, kod tüketilmez; imzalı + listedeki SHA → 200", async () => {
    const f = await firm();
    const c = await codeFor(f, signedApp);
    expect(code(await register(body(c), nextIp(), signedApp))).toBe("409 UNATTENDED_DISABLED");
    expect(await testDb().unattendedRegistrationCode.count({ where: { customerId: f.customerId, usedAt: null } })).toBe(1);
    expect((await register(body(c, { signed: true }), nextIp(), signedApp)).statusCode).toBe(200);
  });

  it("AC-297: mod off → 409 UNATTENDED_DISABLED; geçersiz gövde 400", async () => {
    const off = makeApp();
    await off.ready();
    try {
      expect(code(await register(body(WRONG), nextIp(), off))).toBe("409 UNATTENDED_DISABLED");
    } finally {
      await off.close();
    }
    expect((await register({ ...body(WRONG), publicKey: "kısa" }, nextIp())).statusCode).toBe(400);
  });
});

describe("P27-K2 kayıt sistem tavanı (D-P27-1)", () => {
  it("AC-339: sistem tavanı yalnız başarısızları sayar — 100 başarısızdan sonra yanlış kod 429 (audit cap), geçerli kod yine kaydolur", async () => {
    const capApp = makeApp({ env: { ...UNSIGNED_ENV } });
    await capApp.ready();
    try {
      const f = await firm();
      const s = await loginStepUp(capApp, f.admin);
      const r = await capApp.inject({
        method: "POST",
        url: "/api/v1/unattended/registration-codes",
        headers: s.headers,
        payload: { customerId: f.customerId },
      });
      const c = r.json<{ code: string }>().code;
      for (let i = 0; i < 100; i++) await register(body(WRONG), `203.0.113.${Math.floor(i / 4) + 1}`, capApp);
      const capped = await register(body(WRONG), "192.0.2.10", capApp);
      expect(code(capped)).toBe("429 RATE_LIMITED");
      expect((await register(body(c), "192.0.2.11", capApp)).statusCode).toBe(200);
      expect(capApp.metrics.render()).toMatch(/rs_unattended_register_total\{result="cap"\} \d+/);
    } finally {
      await capApp.close();
    }
  });
});
