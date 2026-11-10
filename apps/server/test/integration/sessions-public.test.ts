import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createLogger } from "../../src/lib/logger.ts";
import { sessionRef } from "../../src/sessions/codes.ts";
import { ORIGIN, createSupportSessionRow, createTenant, createUser, makeApp, testDb } from "../helpers/app.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

const resolve = (payload: object, ip: string, origin: string | null = ORIGIN) =>
  app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers: origin ? { origin } : {},
    payload: { clientKind: "BROWSER", ...payload },
    remoteAddress: ip,
  });
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;

type St = "PENDING" | "ACTIVE" | "ENDED" | "EXPIRED" | "CANCELLED";
async function session(status: St = "PENDING", createdAt?: Date) {
  const t = await createTenant();
  const tech = await createUser({ tenantId: t.id, role: "ADMIN" });
  return { tenant: t, row: await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id, status, ...(createdAt ? { createdAt } : {}) }) };
}
const past = () => new Date(Date.now() - 16 * 60_000);
const resolveAudits = (entityId: string) =>
  testDb().auditLog.findMany({ where: { entityId, action: "session.resolve" } });

describe("POST /public/sessions/resolve", () => {
  it("AC-3: kodla çözümleme firma, teknisyen ve teknisyen teyit kodunu döner; tüketmez", async () => {
    const { tenant, row } = await session();
    for (let i = 0; i < 2; i++) {
      const res = await resolve({ code: row.code }, "192.0.2.10");
      expect(res.statusCode).toBe(200);
      const body = res.json<{ sessionRef: string; tenant: { name: string }; techVerifyCode: string; technician: { name: string } }>();
      expect(body.tenant.name).toBe(tenant.name);
      expect(body.techVerifyCode).toBe("1234");
      expect(body.technician.name).toBe("Test Kullanıcı");
      expect(body.sessionRef).toMatch(/^[A-Za-z0-9_-]{43}[0-9A-Z]{26}$/);
      expect(res.body).not.toContain(row.token);
    }
  });

  it("AC-7 (P2 kısmı): ACTIVE/ENDED oturumun linki 410 SESSION_CONSUMED", async () => {
    for (const st of ["ACTIVE", "ENDED"] as const) {
      const { row } = await session(st);
      const res = await resolve({ token: row.token }, "192.0.2.11");
      expect(res.statusCode).toBe(410);
      expect(errCode(res)).toBe("SESSION_CONSUMED");
    }
  });

  it("AC-5, AC-7 (QA-P2-1, S-P2-6): 410 EXPIRED/CANCELLED/CONSUMED → tek session.resolve/fail audit; token ve kod yazılmaz", async () => {
    const cases = [
      { st: "PENDING" as const, createdAt: past(), code: "SESSION_EXPIRED" },
      { st: "CANCELLED" as const, code: "SESSION_CANCELLED" },
      { st: "ACTIVE" as const, code: "SESSION_CONSUMED" },
    ];
    for (const [i, c] of cases.entries()) {
      const { row } = await session(c.st, c.createdAt);
      const ip = `192.0.2.${60 + i}`;
      if (row.code) expect(errCode(await resolve({ code: row.code }, ip))).toBe(c.code); // kod yolu (yalnız PENDING'de kod var)
      for (let k = 0; k < 3; k++) {
        const res = await resolve({ token: row.token }, ip);
        expect(res.statusCode).toBe(410);
        expect(errCode(res)).toBe(c.code);
      }
      const audits = await resolveAudits(row.id);
      expect(audits).toHaveLength(1); // aynı oturum + sebep için 10 dk'da tek satır
      expect(audits[0]).toMatchObject({ result: "fail", entity: "support_sessions", newValue: { reason: c.code } });
      const dump = JSON.stringify(audits, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
      expect(dump).not.toContain(row.token);
      if (row.code) expect(dump).not.toContain(row.code);
    }
  });

  it("geçersiz girdi 400, Origin yoksa 403, bilinmeyen token 404", async () => {
    expect((await resolve({ code: "123" }, "192.0.2.12")).statusCode).toBe(400);
    expect((await resolve({ code: "12345678" }, "192.0.2.12", null)).statusCode).toBe(403);
    expect((await resolve({ token: "A".repeat(43) }, "192.0.2.12")).statusCode).toBe(404);
  });

  it("AC-3, G-02: başarısız kod IP başına 10/dk; aşımda yalnız o IP 429 (15 dk), diğer IP etkilenmez", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < 10; i++) expect((await resolve({ code: "00000000" }, ip)).statusCode).toBe(404);
    const blocked = await resolve({ code: "00000000" }, ip);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBe(900);
    const { row } = await session();
    expect((await resolve({ code: row.code }, ip)).statusCode).toBe(429); // doğru kod da reddedilir
    expect((await resolve({ code: row.code }, "203.0.113.20")).statusCode).toBe(200);
  });

  it("AC-3, G-02: ağ öneki (/24) başına 30/dk; aşımda yalnız o önek 429", async () => {
    for (let i = 1; i <= 30; i++) expect((await resolve({ code: "00000001" }, `198.18.5.${i}`)).statusCode).toBe(404);
    expect((await resolve({ code: "00000001" }, "198.18.5.200")).statusCode).toBe(429);
    expect((await resolve({ code: "00000001" }, "198.18.5.201")).statusCode).toBe(429);
    expect((await resolve({ code: "00000001" }, "198.18.6.1")).statusCode).toBe(404);
  });

  it("G-02: token yolu 30/dk/IP", async () => {
    const ip = "198.51.100.40";
    for (let i = 0; i < 30; i++) expect((await resolve({ token: "B".repeat(43) }, ip)).statusCode).toBe(404);
    expect((await resolve({ token: "B".repeat(43) }, ip)).statusCode).toBe(429);
  });
});

describe("global başarısız kod alarmı (G-02, S-P2-3)", () => {
  it("AC-3: dağıtık denemede 100/dk aşılınca warn log; IP/kod yazılmaz, istek engellenmez", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(...chunk.toString().split("\n").filter(Boolean));
        cb();
      },
    });
    const own = makeApp({ logger: createLogger("warn", sink) });
    // 101 hata, 11 ayrı /24 önekine dağıtılmış: hiçbir ip (≤10) ya da önek (≤30) limiti aşılmaz.
    for (let i = 0; i < 101; i++) {
      const res = await own.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers: { origin: ORIGIN }, payload: { clientKind: "BROWSER", code: "00000002" }, remoteAddress: `198.19.${i % 11}.${Math.floor(i / 11) + 1}` });
      expect(res.statusCode).toBe(404);
    }
    await own.close();
    const alarms = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((p) => p.alarm === "resolve_failed");
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ level: 40, failed: 101, prefixes: 11, windowSec: 60 });
    expect(JSON.stringify(alarms)).not.toMatch(/198\.19|00000002/);
  });
});

describe("GET /public/sessions/status", () => {
  const status = (ref: string, ip: string) => app.inject({ method: "GET", url: `/api/v1/public/sessions/status?ref=${ref}`, remoteAddress: ip });

  it("AC-5 (QA-P2-2): yoklamada süresi dolmuş PENDING → EXPIRED döner, satır EXPIRED olur, session.expired audit", async () => {
    const { row } = await session("PENDING", past());
    const ref = sessionRef(app.sessionRefKey, row.id);
    const res = await status(ref, "192.0.2.70");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "EXPIRED" });
    const db = await testDb().supportSession.findUniqueOrThrow({ where: { id: row.id } });
    expect([db.status, db.activeCode, db.endedBy]).toEqual(["EXPIRED", null, "SYSTEM"]);
    expect(await testDb().auditLog.count({ where: { entityId: row.id, action: "session.expired" } })).toBe(1);
    expect((await status(ref, "192.0.2.70")).json()).toEqual({ status: "EXPIRED" });
  });

  it("AC-8 (QA-P2-2): yoklama 60/dk/IP; 61. istek 429 + Retry-After, diğer IP etkilenmez", async () => {
    const { row } = await session();
    const ref = sessionRef(app.sessionRefKey, row.id);
    const ip = "198.51.100.80";
    for (let i = 0; i < 60; i++) expect((await status(ref, ip)).statusCode).toBe(200);
    const blocked = await status(ref, ip);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await status(ref, "198.51.100.81")).statusCode).toBe(200);
  });

  it("AC-8: geçersiz/sahte ref 404 (id bilinse de HMAC'siz erişilemez)", async () => {
    const { row } = await session();
    const fake = `${"A".repeat(43)}${row.id}`;
    for (const ref of [fake, "x", ""]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/public/sessions/status?ref=${ref}`, remoteAddress: "192.0.2.50" });
      expect(res.statusCode).toBe(404);
    }
  });

  it("S-P2-T2-1: istemci IP'si güvenilen proxy ise (XFF yok) dakikada en çok 1 warn; IP/token yazılmaz, engellemez", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(...chunk.toString().split("\n").filter(Boolean));
        cb();
      },
    });
    const own = makeApp({ env: { TRUSTED_PROXY_CIDR: "172.30.0.2/31" }, logger: createLogger("warn", sink) });
    const { row } = await session();
    const req = (remoteAddress: string, headers: Record<string, string> = {}) =>
      own.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers: { origin: ORIGIN, ...headers }, payload: { clientKind: "BROWSER", token: row.token }, remoteAddress });
    // XFF'li (doğru yapılandırma): istemci IP'si proxy değil → alarm yok
    expect((await req("172.30.0.3", { "x-forwarded-for": "203.0.113.9" })).statusCode).toBe(200);
    // Proxy dışı doğrudan istemci → alarm yok
    expect((await req("198.18.7.1")).statusCode).toBe(200);
    // XFF'siz web isteği (sır uyuşmazlığı): 3 istek, tek alarm, hepsi 200
    for (let i = 0; i < 3; i++) expect((await req("172.30.0.3")).statusCode).toBe(200);
    await own.close();
    const alarms = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((p) => p.alarm === "client_ip_is_proxy");
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ level: 40 });
    expect(JSON.stringify(alarms)).not.toMatch(/172\.30|203\.0|198\.18/);
    expect(JSON.stringify(alarms)).not.toContain(row.token);
  });
});
