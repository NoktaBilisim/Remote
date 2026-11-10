import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resolveSession } from "../../src/auth/session.ts";
import { sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSession } from "../../src/sessions/service.ts";
import { ORIGIN, createSupportSessionRow, createTenant, createUser, loginAs, makeApp, testDb, uniqueCode, type Session } from "../helpers/app.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

async function adminSession() {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  return { tenantId: t.id, admin, s: await loginAs(app, admin) };
}
const create = (s: Session) => app.inject({ method: "POST", url: "/api/v1/sessions", headers: s.headers, payload: {} });
const ctx = { ip: "127.0.0.1", userAgent: "test", requestId: "r" };

describe("POST /sessions", () => {
  it("AC-1, AC-2: 256 bit base64url link; DB ve audit dökümünde düz token yok, yalnız SHA-256", async () => {
    const { s, tenantId } = await adminSession();
    const res = await create(s);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; link: string; code: string; techVerifyCode: string; status: string }>();
    const m = new RegExp(`^${ORIGIN}/session/([A-Za-z0-9_-]{43})$`).exec(body.link);
    expect(m).not.toBeNull();
    const token = m?.[1] ?? "";
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(body.code).toMatch(/^\d{8}$/);
    expect(body.techVerifyCode).toMatch(/^\d{4}$/);
    expect(body.status).toBe("PENDING");
    const rows = await testDb().$queryRaw<unknown[]>`SELECT * FROM support_sessions WHERE tenant_id = ${tenantId}`;
    const audits = await testDb().$queryRaw<unknown[]>`SELECT * FROM audit_logs WHERE tenant_id = ${tenantId}`;
    const ser = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x));
    const dump = ser([rows, audits]);
    expect(dump).not.toContain(token);
    expect(dump).toContain(sha256Hex(token));
    expect(ser(audits)).toContain("session.created");
    expect(ser(audits)).not.toContain(body.code);
  });

  it("AC-4: expiresAt = oluşturma + tenant session_ttl_min", async () => {
    const { s, tenantId } = await adminSession();
    await testDb().tenantSettings.update({ where: { tenantId }, data: { sessionTtlMin: 30 } });
    const before = Date.now();
    const body = (await create(s)).json<{ expiresAt: string }>();
    const ttl = new Date(body.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
    expect(ttl).toBeLessThan(30 * 60_000 + 5000);
  });

  it("AC-3: active_code çakışmasında yeni kodla yeniden denenir; 5 çakışmada vazgeçilir", async () => {
    const { s, tenantId, admin } = await adminSession();
    const other = await createSupportSessionRow({ tenantId, technicianId: admin.id });
    const auth = await resolveSession(testDb(), s.token, new Date());
    if (!auth || !other.code) throw new Error("kurulum");
    const fresh = uniqueCode();
    const codes = [other.code, other.code, fresh];
    const gen = { token: () => `t${uniqueCode()}`.padEnd(43, "x"), code: () => codes.shift() ?? uniqueCode(), verify: () => "0000" };
    const out = await createSupportSession(testDb(), ctx, auth, tenantId, ORIGIN, gen);
    expect(out.code).toBe(fresh);
    const always = { ...gen, token: () => `u${uniqueCode()}`.padEnd(43, "y"), code: () => other.code ?? "" };
    await expect(createSupportSession(testDb(), ctx, auth, tenantId, ORIGIN, always)).rejects.toThrow();
  });

  it("AC-11: eşzamanlı oluşturmada açık oturum sınırı aşılmaz (yarış), aşımda 409 OPEN_SESSION_LIMIT", async () => {
    const { s, admin } = await adminSession(); // varsayılan max_open_sessions = 3
    const results = await Promise.all(Array.from({ length: 6 }, () => create(s)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 201, 201, 409, 409, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json<{ error: { code: string } }>().error.code).toBe("OPEN_SESSION_LIMIT");
    expect(await testDb().supportSession.count({ where: { technicianId: admin.id, status: "PENDING" } })).toBe(3);
  });

  it("AC-11 (QA-P2-3): süresi dolmuş ama henüz süpürülmemiş PENDING oturumlar açık sayılmaz", async () => {
    const { s, admin, tenantId } = await adminSession();
    const past = new Date(Date.now() - 16 * 60_000);
    for (let i = 0; i < 3; i++) await createSupportSessionRow({ tenantId, technicianId: admin.id, createdAt: past });
    expect((await create(s)).statusCode).toBe(201);
  });

  it("AC-12: teknisyen saatte 20 oturum açabilir; 21. → 429 + Retry-After", async () => {
    const { s, tenantId, admin } = await adminSession();
    const at = new Date(Date.now() - 10 * 60_000);
    for (let i = 0; i < 20; i++) await createSupportSessionRow({ tenantId, technicianId: admin.id, status: "EXPIRED", createdAt: at });
    const res = await create(s);
    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("RATE_LIMITED");
    const retry = Number(res.headers["retry-after"]);
    expect(retry).toBeGreaterThan(49 * 60);
    expect(retry).toBeLessThanOrEqual(50 * 60);
  });

  it("AC-61: sessions.create yetkisi olmayan USER → 403", async () => {
    const t = await createTenant();
    const user = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
    expect((await create(await loginAs(app, user))).statusCode).toBe(403);
  });
});
