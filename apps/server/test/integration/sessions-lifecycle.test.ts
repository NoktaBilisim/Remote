import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { expireDue } from "../../src/sessions/service.ts";
import { ORIGIN, createSupportSessionRow, createTenant, createUser, loginAs, makeApp, testDb, type Session } from "../helpers/app.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

let ipSeq = 0;
const freshIp = () => `10.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}.7`; // her testte ayrı /24 + /32
const resolve = (payload: object, ip: string, extra: Partial<InjectOptions> = {}) =>
  app.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers: { origin: ORIGIN }, payload: { clientKind: "BROWSER", ...payload }, remoteAddress: ip, ...extra });
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;

async function fixture() {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const user = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true, "sessions.delete": true } });
  const other = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
  return { tenantId: t.id, admin, user, other };
}
const get = (s: Session, url: string) => app.inject({ method: "GET", url, headers: s.headers });
const cancel = (s: Session, id: string) => app.inject({ method: "POST", url: `/api/v1/sessions/${id}/cancel`, headers: s.headers });

describe("GET /sessions, /sessions/:id", () => {
  it("AC-61, G-22: USER yalnız kendi oturumunu görür; başkasınınki 404; detayda link yok, PENDING iken kod var", async () => {
    const f = await fixture();
    const mine = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.user.id });
    const theirs = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.other.id });
    const s = await loginAs(app, f.user);
    const list = (await get(s, "/api/v1/sessions?pageSize=100")).json<{ items: { id: string }[]; total: number }>();
    expect(list.items.map((i) => i.id)).toEqual([mine.id]);
    expect(list.total).toBe(1);
    expect((await get(s, `/api/v1/sessions?technicianId=${f.other.id}`)).json<{ total: number }>().total).toBe(1); // filtre kapsamı ezemez
    expect((await get(s, `/api/v1/sessions/${theirs.id}`)).statusCode).toBe(404);
    const detail = await get(s, `/api/v1/sessions/${mine.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ code: string }>().code).toBe(mine.code);
    expect(detail.body).not.toContain("link");
    expect(detail.body).not.toContain(mine.token);
    const adminList = (await get(await loginAs(app, f.admin), "/api/v1/sessions")).json<{ total: number }>();
    expect(adminList.total).toBe(2);
  });

  it("AC-61: boş liste, sayfa üst sınırı 100, geçersiz durum 400", async () => {
    const f = await fixture();
    const s = await loginAs(app, f.user);
    expect((await get(s, "/api/v1/sessions")).json()).toEqual({ items: [], page: 1, pageSize: 25, total: 0 });
    expect((await get(s, "/api/v1/sessions?pageSize=101")).statusCode).toBe(400);
    expect((await get(s, "/api/v1/sessions?status=FOO")).statusCode).toBe(400);
    expect((await get(s, "/api/v1/sessions/bozuk-id")).statusCode).toBe(404);
  });
});

describe("iptal (AC-8)", () => {
  it("AC-8: iptal anında link ve kod geçersiz; yoklama CANCELLED; ikinci iptal 409; audit", async () => {
    const f = await fixture();
    const row = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.user.id });
    const ip = freshIp();
    const ok = await resolve({ token: row.token }, ip);
    expect(ok.statusCode).toBe(200);
    const ref = ok.json<{ sessionRef: string }>().sessionRef;
    const status = () => app.inject({ method: "GET", url: `/api/v1/public/sessions/status?ref=${ref}`, remoteAddress: ip });
    expect((await status()).json()).toEqual({ status: "PENDING" });

    const s = await loginAs(app, f.user);
    const started = Date.now();
    const res = await cancel(s, row.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "CANCELLED" });
    const r1 = await resolve({ token: row.token }, ip);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r1.statusCode).toBe(410);
    expect(errCode(r1)).toBe("SESSION_CANCELLED");
    expect((await resolve({ code: row.code }, ip)).statusCode).toBe(404);
    expect((await status()).json()).toEqual({ status: "CANCELLED" });
    expect((await cancel(s, row.id)).statusCode).toBe(409);
    const db = await testDb().supportSession.findUniqueOrThrow({ where: { id: row.id } });
    expect([db.status, db.activeCode, db.endedBy]).toEqual(["CANCELLED", null, "TECH"]);
    expect(await testDb().auditLog.count({ where: { entityId: row.id, action: "session.cancelled" } })).toBe(1);
  });

  it("AC-8, AC-61: yetkisiz USER başkasının oturumunu iptal edemez (404), yetkisi yoksa 403", async () => {
    const f = await fixture();
    const theirs = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.other.id });
    expect((await cancel(await loginAs(app, f.user), theirs.id)).statusCode).toBe(404);
    expect((await cancel(await loginAs(app, f.other), theirs.id)).statusCode).toBe(403);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("PENDING");
  });
});

describe("süre dolumu (AC-5)", () => {
  const past = () => new Date(Date.now() - 16 * 60_000);

  it("AC-5: resolve yolu — süresi dolmuş PENDING aynı istekte EXPIRED olur, 410 SESSION_EXPIRED", async () => {
    const f = await fixture();
    const row = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.user.id, createdAt: past() });
    const res = await resolve({ code: row.code }, freshIp());
    expect(res.statusCode).toBe(410);
    expect(errCode(res)).toBe("SESSION_EXPIRED");
    const db = await testDb().supportSession.findUniqueOrThrow({ where: { id: row.id } });
    expect([db.status, db.activeCode, db.endedBy, db.endReason]).toEqual(["EXPIRED", null, "SYSTEM", "expired"]);
    expect(errCode(await resolve({ token: row.token }, freshIp()))).toBe("SESSION_EXPIRED");
  });

  it("AC-5: expiry işi süresi dolanları EXPIRED/SYSTEM yapar ve audit yazar; dolmamışa dokunmaz", async () => {
    const f = await fixture();
    const old = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.user.id, createdAt: past() });
    const live = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.user.id });
    await expireDue(testDb(), { ip: "", userAgent: "test", requestId: "r" }, new Date());
    const [a, b] = await Promise.all([old, live].map((r) => testDb().supportSession.findUniqueOrThrow({ where: { id: r.id } })));
    expect(a?.status).toBe("EXPIRED");
    expect(b?.status).toBe("PENDING");
    expect(await testDb().auditLog.count({ where: { entityId: old.id, action: "session.expired" } })).toBe(1);
  });
});
