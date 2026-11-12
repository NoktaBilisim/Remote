// P8 oturum geçmişi uçları (AC-60..63, 124): GET /sessions filtreleri, historyScope (5 uç, IDOR), GET /:id/history,
// PATCH /:id, GET /export.csv; 10.000 kayıtta ilk sayfa < 500 ms. Gerçek MySQL (TEST_DATABASE_URL, app kullanıcısı).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSessionsQuerySchema, type SessionHistoryDetail, type SessionListResponse } from "@remote/contracts/api/sessions";
import { seedPerfSessions } from "../../scripts/perf-sessions.ts";
import type { AuthContext } from "../../src/auth/session.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import * as repo from "../../src/sessions/repo.ts";
import { listHistorySessions } from "../../src/sessions/history.ts";
import { createSupportSessionRow, createTenant, createUser, loginAs, makeApp, testDb, type Session, type TestUser } from "../helpers/app.ts";

const HIST = { "sessions.view": true, "session_history.view": true, "session_history.edit": true, "session_history.export": true };

let app: FastifyInstance;
let A: string;
let B: string;
let adminA: TestUser;
let u1: TestUser;
let u2: TestUser;
let superAdmin: TestUser;
let s1: string; // u1'in oturumu (A)
let s2: string; // u2'nin oturumu (A)
let sB: string; // B tenant'ı
const sess: Record<string, Session> = {};

interface Mk {
  tenantId: string;
  technicianId: string;
  createdAt: Date;
  status?: "ENDED" | "CANCELLED" | "EXPIRED";
  mode?: "AGENT" | "BROWSER";
  customerName?: string;
  ticketNo?: string;
  note?: string;
}
async function mk(o: Mk): Promise<string> {
  const id = newId();
  const status = o.status ?? "ENDED";
  const consumed = status === "ENDED";
  await testDb().supportSession.create({
    data: {
      id,
      tenantId: o.tenantId,
      technicianId: o.technicianId,
      tokenHash: sha256Hex(newId()),
      techVerifyCode: "1234",
      status,
      createdAt: o.createdAt,
      expiresAt: new Date(o.createdAt.getTime() + 15 * 60_000),
      endedAt: new Date(o.createdAt.getTime() + 3725_000),
      endedBy: consumed ? "CUSTOMER" : "SYSTEM",
      endReason: consumed ? "customer" : status.toLowerCase(),
      ...(consumed ? { consumedAt: new Date(o.createdAt.getTime() + 5_000), mode: o.mode ?? "BROWSER", customerName: o.customerName ?? null } : {}),
      ...(o.ticketNo ? { ticketNo: o.ticketNo } : {}),
      ...(o.note ? { note: o.note } : {}),
    },
  });
  return id;
}

const get = (who: string, url: string) => app.inject({ method: "GET", url, headers: sess[who]?.headers });
const patch = (who: string, id: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "PATCH", url: `/api/v1/sessions/${id}`, headers: { ...sess[who]?.headers, ...headers }, payload: payload as object });

beforeAll(async () => {
  app = makeApp();
  await app.ready();
  A = (await createTenant()).id;
  B = (await createTenant()).id;
  adminA = await createUser({ tenantId: A, role: "ADMIN" });
  u1 = await createUser({ tenantId: A, perms: HIST });
  u2 = await createUser({ tenantId: A, perms: HIST });
  const uB = await createUser({ tenantId: B, perms: HIST });
  superAdmin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
  s1 = await mk({ tenantId: A, technicianId: u1.id, createdAt: new Date("2020-03-01T10:00:00Z"), customerName: "Ayşe Yılmaz" });
  s2 = await mk({ tenantId: A, technicianId: u2.id, createdAt: new Date("2020-03-02T10:00:00Z"), customerName: "Mehmet Kaya" });
  sB = await mk({ tenantId: B, technicianId: uB.id, createdAt: new Date("2020-03-03T10:00:00Z"), customerName: "Ayşe B" });
  for (const [k, u] of [["admin", adminA], ["u1", u1], ["u2", u2], ["super", superAdmin]] as const) sess[k] = await loginAs(app, u);
});
afterAll(() => app.close());

describe("AC-60 liste filtreleri ve sayfalama", () => {
  let T: string;
  let tech1: TestUser;
  let tech2: TestUser;
  beforeAll(async () => {
    T = (await createTenant()).id;
    tech1 = await createUser({ tenantId: T, perms: HIST });
    tech2 = await createUser({ tenantId: T, perms: HIST });
    sess.adminT = await loginAs(app, await createUser({ tenantId: T, role: "ADMIN" }));
    // İstanbul günü sınırı: 2026-01-10T21:00Z = 11 Ocak 00:00 (dahil); 20:59:59.999Z = 10 Ocak (hariç).
    await mk({ tenantId: T, technicianId: tech1.id, createdAt: new Date("2026-01-10T20:59:59.999Z"), customerName: "Önceki Gün", mode: "AGENT" });
    await mk({ tenantId: T, technicianId: tech1.id, createdAt: new Date("2026-01-10T21:00:00.000Z"), customerName: "Ayşe Yılmaz", mode: "AGENT" });
    await mk({ tenantId: T, technicianId: tech2.id, createdAt: new Date("2026-01-11T20:59:59.999Z"), customerName: "AYŞE yılmaz", mode: "BROWSER" });
    await mk({ tenantId: T, technicianId: tech2.id, createdAt: new Date("2026-01-11T21:00:00.000Z"), customerName: "Ertesi Gün", mode: "BROWSER" });
    await mk({ tenantId: T, technicianId: tech1.id, createdAt: new Date("2026-01-12T10:00:00Z"), status: "CANCELLED" });
    await mk({ tenantId: T, technicianId: tech2.id, createdAt: new Date("2026-01-12T11:00:00Z"), customerName: "Yüzde%Ali_x", mode: "AGENT" });
  });
  const list = async (qs: string) => {
    const r = await get("adminT", `/api/v1/sessions${qs}`);
    expect(r.statusCode, r.body).toBe(200);
    return r.json<SessionListResponse>();
  };

  it("AC-60: varsayılan sayfa 25, created_at azalan; öğe şekli (mode, startedAt, durationSec, customerName, ticketNo, tenant null)", async () => {
    const r = await get("adminT", "/api/v1/sessions");
    expect(r.headers["cache-control"]).toBe("no-store");
    const body = r.json<SessionListResponse>();
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 6 });
    const times = body.items.map((i) => i.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const ended = body.items.find((i) => i.customerName === "Ertesi Gün");
    expect(ended).toMatchObject({ mode: "BROWSER", durationSec: 3720, ticketNo: null, tenant: null, status: "ENDED" });
    expect(ended?.startedAt).toBe(new Date(new Date("2026-01-11T21:00:00Z").getTime() + 5000).toISOString());
    expect(JSON.stringify(body)).not.toMatch(/customerEmail|"note"/); // listede e-posta/not yok
    const cancelled = body.items.find((i) => i.status === "CANCELLED");
    expect(cancelled).toMatchObject({ mode: null, startedAt: null, durationSec: null, customerName: null });
  });

  it("AC-60: tarih aralığı Europe/Istanbul günü (from dahil, to ertesi gün 00:00 hariç)", async () => {
    const b = await list("?from=2026-01-11&to=2026-01-11");
    expect(b.items.map((i) => i.customerName).sort()).toEqual(["AYŞE yılmaz", "Ayşe Yılmaz"]);
  });

  it("AC-60: durum, mod, teknisyen ve müşteri (büyük/küçük harf duyarsız; % _ literal) filtreleri", async () => {
    expect((await list("?status=CANCELLED")).total).toBe(1);
    expect((await list("?mode=AGENT")).total).toBe(3);
    expect((await list(`?technicianId=${tech1.id}`)).total).toBe(3);
    expect((await list(`?customer=${encodeURIComponent("yılmaz")}`)).total).toBe(2);
    expect((await list(`?customer=${encodeURIComponent("%A")}`)).items.map((i) => i.customerName)).toEqual(["Yüzde%Ali_x"]);
    expect((await list(`?customer=${encodeURIComponent("_x")}`)).total).toBe(1);
    expect((await list(`?customer=${encodeURIComponent("%%")}`)).total).toBe(0);
    expect((await list(`?mode=AGENT&technicianId=${tech1.id}&from=2026-01-11`)).total).toBe(1);
  });

  it("AC-60: sayfalama kararlı (asc/desc), toplamı aşan sayfa boş, pageSize üst sınırı 100", async () => {
    const p1 = await list("?pageSize=4&sort=createdAt:asc");
    const p2 = await list("?pageSize=4&page=2&sort=createdAt:asc");
    expect(p1.items).toHaveLength(4);
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(6);
    expect(p1.items[0]?.customerName).toBe("Önceki Gün");
    expect((await list("?page=50")).items).toEqual([]);
    for (const qs of ["?pageSize=101", "?foo=1", "?from=2026-02-30", "?from=2026-02-02&to=2026-02-01", "?customer=A", "?mode=x"]) {
      const r = await get("adminT", `/api/v1/sessions${qs}`);
      expect(r.statusCode, qs).toBe(400);
      expect(r.json<{ error: { code: string } }>().error.code).toBe("VALIDATION");
    }
    expect((await get("adminT", "/api/v1/sessions?from=2026-02-02&to=2026-02-01")).json<{ error: { fields: Record<string, string> } }>().error.fields).toHaveProperty("to");
  });
});

describe("AC-61 historyScope — 5 uç, IDOR", () => {
  it("AC-61: USER yalnız kendi oturumlarını listeler; technicianId/tenantId filtresi kapsamı genişletmez", async () => {
    for (const qs of ["", `?technicianId=${u2.id}`, `?tenantId=${B}`]) {
      const b = (await get("u1", `/api/v1/sessions${qs}`)).json<SessionListResponse>();
      expect(b.items.map((i) => i.id), qs).toEqual([s1]);
    }
  });

  it("AC-61: USER başka teknisyenin oturumuna (aynı tenant) ve başka tenant'a 404 — :id, :id/history, PATCH", async () => {
    for (const id of [s2, sB, newId()]) {
      expect((await get("u1", `/api/v1/sessions/${id}`)).statusCode).toBe(404);
      expect((await get("u1", `/api/v1/sessions/${id}/history`)).statusCode).toBe(404);
      expect((await patch("u1", id, { note: "x" })).statusCode).toBe(404);
    }
    expect((await get("u1", `/api/v1/sessions/${s1}/history`)).statusCode).toBe(200);
    expect((await get("u1", "/api/v1/sessions/bozuk-id/history")).statusCode).toBe(404);
    // Değişmedi
    expect(await testDb().supportSession.findUnique({ where: { id: s2 }, select: { note: true } })).toEqual({ note: null });
  });

  it("AC-61: ADMIN tenant'ın tümü (200), başka tenant 404", async () => {
    expect((await get("admin", `/api/v1/sessions/${s2}/history`)).statusCode).toBe(200);
    expect((await get("admin", `/api/v1/sessions/${sB}/history`)).statusCode).toBe(404);
    expect((await get("admin", `/api/v1/sessions/${sB}`)).statusCode).toBe(404);
    expect((await patch("admin", sB, { note: "x" })).statusCode).toBe(404);
    const ids = (await get("admin", "/api/v1/sessions?pageSize=100")).json<SessionListResponse>().items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([s1, s2]));
    expect(ids).not.toContain(sB);
  });

  it("AC-61: SUPER_ADMIN firma seçmeden tüm tenant'lar (tenant alanı dolu, tenantId filtresi); firma seçiliyken yalnız o firma", async () => {
    const all = (await get("super", "/api/v1/sessions?pageSize=100&from=2020-03-01&to=2020-03-03")).json<SessionListResponse>();
    expect(all.items.map((i) => i.id)).toEqual(expect.arrayContaining([s1, s2, sB]));
    expect(all.items.find((i) => i.id === sB)?.tenant).toEqual({ id: B, name: expect.any(String) });
    const onlyB = (await get("super", `/api/v1/sessions?pageSize=100&tenantId=${B}`)).json<SessionListResponse>();
    expect(onlyB.items.map((i) => i.id)).toEqual([sB]);
    expect((await get("super", `/api/v1/sessions/${sB}/history`)).statusCode).toBe(200);
    expect((await get("super", `/api/v1/sessions/${sB}`)).statusCode).toBe(200);

    const acting = await loginAs(app, superAdmin);
    await testDb().authSession.update({ where: { tokenHash: sha256Hex(acting.token) }, data: { actingTenantId: A } });
    const scoped = (await app.inject({ method: "GET", url: `/api/v1/sessions?pageSize=100&tenantId=${B}`, headers: acting.headers })).json<SessionListResponse>();
    expect(scoped.items.map((i) => i.id)).toEqual(expect.arrayContaining([s1, s2]));
    expect(scoped.items.map((i) => i.id)).not.toContain(sB);
    expect(scoped.items[0]?.tenant).toBeNull();
    expect((await app.inject({ method: "GET", url: `/api/v1/sessions/${sB}/history`, headers: acting.headers })).statusCode).toBe(404);
  });

  it("AC-61: yetki — liste any-of (sessions.view | session_history.view); detay/PATCH/export kendi anahtarı", async () => {
    const onlyConsole = await loginAs(app, await createUser({ tenantId: A, perms: { "sessions.view": true } }));
    const onlyHistory = await loginAs(app, await createUser({ tenantId: A, perms: { "session_history.view": true } }));
    const none = await loginAs(app, await createUser({ tenantId: A }));
    const g = (s: Session, url: string) => app.inject({ method: "GET", url, headers: s.headers });
    expect((await g(onlyConsole, "/api/v1/sessions")).statusCode).toBe(200);
    expect((await g(onlyHistory, "/api/v1/sessions")).statusCode).toBe(200);
    expect((await g(none, "/api/v1/sessions")).statusCode).toBe(403);
    expect((await g(onlyConsole, `/api/v1/sessions/${s1}/history`)).statusCode).toBe(403);
    expect((await g(onlyHistory, "/api/v1/sessions/export.csv")).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/sessions/${s1}`, headers: onlyHistory.headers, payload: { note: "x" } })).statusCode).toBe(403);
  });
});

describe("S8-2 katılım kodu yalnız kendi teknisyenine; S8-3 müşteri araması hız sınırı", () => {
  it("S8-2: bekleyen oturumun kodu liste/detay/:id'de yalnız sahibine; ADMIN ve SUPER_ADMIN null görür", async () => {
    const p = await createSupportSessionRow({ tenantId: A, technicianId: u1.id });
    const codeIn = async (who: string) => {
      const list = (await get(who, `/api/v1/sessions?status=PENDING&pageSize=100${who === "super" ? `&tenantId=${A}` : ""}`)).json<SessionListResponse>();
      const item = list.items.find((i) => i.id === p.id);
      const det = (await get(who, `/api/v1/sessions/${p.id}/history`)).json<SessionHistoryDetail>();
      const one = (await get(who, `/api/v1/sessions/${p.id}`)).json<{ code: string | null }>();
      return [item?.code, det.code, one.code];
    };
    expect(await codeIn("u1")).toEqual([p.code, p.code, p.code]);
    expect(await codeIn("admin")).toEqual([null, null, null]);
    expect(await codeIn("super")).toEqual([null, null, null]);
  });

  it("S8-3: müşteri filtresiyle liste 60/dk/kullanıcı, 61. istek 429 + Retry-After; filtresiz liste etkilenmez", async () => {
    const s = await loginAs(app, await createUser({ tenantId: A, perms: HIST }));
    const g = (qs: string) => app.inject({ method: "GET", url: `/api/v1/sessions${qs}`, headers: s.headers });
    for (let i = 0; i < 60; i++) expect((await g("?customer=Ay")).statusCode).toBe(200);
    const r = await g("?customer=Ay");
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect((await g("")).statusCode).toBe(200);
  });
});

describe("AC-62 detay", () => {
  let id: string;
  let tech: TestUser;
  let admin: TestUser;
  let T: string;
  beforeAll(async () => {
    T = (await createTenant()).id;
    tech = await createUser({ tenantId: T, perms: HIST });
    admin = await createUser({ tenantId: T, role: "ADMIN" });
    await testDb().user.update({ where: { id: admin.id }, data: { fullName: "Yönetici Ünal" } });
    await testDb().user.update({ where: { id: tech.id }, data: { fullName: "Teknisyen Çağrı" } });
    sess.techT = await loginAs(app, tech);
    const base = new Date("2026-04-01T09:00:00Z");
    const at = (s: number) => new Date(base.getTime() + s * 1000);
    id = newId();
    await testDb().supportSession.create({
      data: {
        id, tenantId: T, technicianId: tech.id, tokenHash: sha256Hex(id), techVerifyCode: "1234", status: "ENDED", createdAt: base,
        expiresAt: at(900), consumedAt: at(10), mode: "AGENT", endedAt: at(130), endedBy: "ADMIN", endReason: "admin", terminatedBy: admin.id,
        customerName: "Ayşe Yılmaz", customerEmail: "ayse@example.test", ticketNo: "INC-7", note: "not",
        qualitySummary: { fps: { avg: 20, min: 10, max: 30 }, kbps: { avg: 900, min: 100, max: 2000 }, rttMs: { avg: 40, min: 20, max: 90 }, connType: "relay" },
      },
    });
    const text = await testDb().consentText.findFirstOrThrow({ where: { tenantId: T, isCurrent: true } });
    const consent = (s: number, level: string, decision: string, source: string, client = false) =>
      testDb().sessionConsent.create({
        data: { id: newId(), sessionId: id, tenantId: T, level, decision, source, createdAt: at(s), ...(client ? { ip: "203.0.113.77", userAgent: "GizliTarayici/1.0" } : {}), ...(level === "VIEW" ? { consentTextId: text.id, consentSha256: text.sha256 } : {}) },
      });
    await consent(10, "VIEW", "GRANTED", "UI", true);
    await consent(30, "CONTROL", "GRANTED", "UI", true);
    await consent(60, "CONTROL", "REVOKED", "TECH");
    await consent(90, "CONTROL", "GRANTED", "UI", true);
    const audit = (s: number, action: string, extra: { userId?: string; username?: string; newValue?: object; oldValue?: object; result?: string }) =>
      testDb().auditLog.create({ data: { createdAt: at(s), tenantId: T, entity: "support_sessions", entityId: id, action, result: extra.result ?? "success", userId: extra.userId ?? null, username: extra.username ?? null, ipAddress: "203.0.113.77", userAgent: "GizliTarayici/1.0", ...(extra.newValue ? { newValue: extra.newValue } : {}), ...(extra.oldValue ? { oldValue: extra.oldValue } : {}) } });
    await audit(0, "session.created", { userId: tech.id, username: tech.email, newValue: { status: "PENDING", ttlMin: 15, expiresAt: "x" } });
    await audit(5, "guest.pending", { username: "customer", newValue: { guestId: "g", name: "Ayşe Yılmaz", ip: "203.0.113.77", consentTextId: text.id } });
    await audit(10, "guest.admitted", { userId: tech.id, newValue: { guestId: "g", name: "Ayşe Yılmaz", guestKind: "AGENT", consentSha256: text.sha256 } });
    await audit(20, "control.requested", { userId: tech.id, newValue: { request: "1" } });
    await audit(30, "control.granted", { username: "customer", newValue: { decision: "GRANTED", source: "UI", selfElevated: "true" } });
    await audit(45, "file.transfer", { userId: tech.id, newValue: { fileName: "gizli.txt" } });
    await audit(60, "control.released", { userId: tech.id, newValue: { decision: "REVOKED", source: "TECH", via: "release" } });
    await audit(90, "control.granted", { username: "customer", newValue: { selfElevated: "unknown" } });
    await audit(100, "session.caps_changed", { username: "system", oldValue: { caps: "remote_control,file_transfer" }, newValue: { caps: "file_transfer" } });
    await audit(130, "session.terminated", { userId: admin.id, newValue: { status: "ENDED", endedBy: "ADMIN", reason: "Politika" } });
    // Başka tenant'a yazılmış aynı entity_id'li kayıt zaman çizelgesine girmez.
    await testDb().auditLog.create({ data: { tenantId: A, entity: "support_sessions", entityId: id, action: "session.cancelled", result: "success" } });
    await testDb().sessionFile.create({ data: { id: newId(), sessionId: id, tenantId: T, direction: "TO_CUSTOMER", fileName: "rapor.pdf", sizeBytes: 5_000_000n, sha256: "a".repeat(64), result: "OK", createdAt: at(45) } });
  });

  it("AC-62: başlangıç/bitiş/süre, müşteri, kalite, dosyalar, sonlandıran, not/ticket", async () => {
    const r = await get("techT", `/api/v1/sessions/${id}/history`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const d = r.json<SessionHistoryDetail>();
    expect(d).toMatchObject({
      id, mode: "AGENT", durationSec: 120, customerName: "Ayşe Yılmaz", customerEmail: "ayse@example.test", ticketNo: "INC-7", note: "not",
      endedBy: "ADMIN", endReason: "admin", terminatedBy: { id: admin.id, name: "Yönetici Ünal" }, timelineTruncated: false,
      quality: { connType: "relay", fps: { avg: 20, min: 10, max: 30 } },
    });
    expect(d.files).toEqual([{ id: expect.any(String), direction: "TO_CUSTOMER", fileName: "rapor.pdf", sizeBytes: 5_000_000, sha256: "a".repeat(64), result: "OK", createdAt: expect.any(String) }]);
  });

  it("AC-62: onay kayıtları (ip/UA yok) ve kontrol dönemleri (TECH kapanışı, selfElevated, kapanışsız dönem)", async () => {
    const r = await get("techT", `/api/v1/sessions/${id}/history`);
    expect(r.body).not.toContain("203.0.113.77");
    expect(r.body).not.toContain("GizliTarayici");
    const d = r.json<SessionHistoryDetail>();
    expect(d.consents.map((c) => `${c.level}/${c.decision}/${c.source}`)).toEqual(["VIEW/GRANTED/UI", "CONTROL/GRANTED/UI", "CONTROL/REVOKED/TECH", "CONTROL/GRANTED/UI"]);
    expect(Object.keys(d.consents[0] ?? {}).sort()).toEqual(["at", "consentText", "decision", "id", "level", "source"]);
    expect(d.consents[0]?.consentText).toMatchObject({ version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(d.controlPeriods).toEqual([
      { grantedAt: "2026-04-01T09:00:30.000Z", revokedAt: "2026-04-01T09:01:00.000Z", revokedSource: "TECH", revokedReason: "tech", selfElevated: true },
      { grantedAt: "2026-04-01T09:01:30.000Z", revokedAt: null, revokedSource: null, revokedReason: null, selfElevated: null },
    ]);
  });

  it("AC-62: zaman çizelgesi izin listesi + izdüşüm; actor/actorName; file.* ve başka tenant kaydı yok", async () => {
    const d = (await get("techT", `/api/v1/sessions/${id}/history`)).json<SessionHistoryDetail>();
    expect(d.timeline.map((e) => e.action)).toEqual(["session.created", "guest.pending", "guest.admitted", "control.requested", "control.granted", "control.released", "control.granted", "session.caps_changed", "session.terminated"]);
    const by = (a: string) => d.timeline.find((e) => e.action === a);
    expect(by("session.created")).toMatchObject({ actor: "TECH", actorName: "Teknisyen Çağrı", details: { ttlMin: 15 } });
    expect(by("guest.pending")).toMatchObject({ actor: "CUSTOMER", actorName: "Ayşe Yılmaz", details: { name: "Ayşe Yılmaz" } });
    expect(by("guest.pending")?.details).toEqual({ name: "Ayşe Yılmaz" });
    expect(by("guest.admitted")?.details).toEqual({ name: "Ayşe Yılmaz", guestKind: "AGENT" });
    expect(by("control.requested")?.details).toEqual({ request: 1 });
    expect(by("control.granted")).toMatchObject({ actor: "CUSTOMER", details: { selfElevated: true } });
    expect(by("control.released")?.details).toEqual({ via: "release" });
    expect(by("session.caps_changed")).toMatchObject({ actor: "SYSTEM", actorName: null, details: { oldCaps: "remote_control,file_transfer", newCaps: "file_transfer" } });
    expect(by("session.terminated")).toMatchObject({ actor: "ADMIN", actorName: "Yönetici Ünal", details: { reason: "Politika" } });
    expect(JSON.stringify(d.timeline)).not.toMatch(/gizli\.txt|consentSha256|guestId|expiresAt/);
  });

  it("AC-62: ayrıştırılamayan kalite özeti → null (500 değil); 500'ü aşan zaman çizelgesi kırpılır", async () => {
    const tid = (await createTenant()).id;
    const t = await createUser({ tenantId: tid, perms: HIST });
    const s = await createSupportSessionRow({ tenantId: tid, technicianId: t.id, status: "ENDED" });
    await testDb().supportSession.update({ where: { id: s.id }, data: { qualitySummary: { bozuk: true } } });
    await testDb().auditLog.createMany({ data: Array.from({ length: 501 }, () => ({ tenantId: tid, entity: "support_sessions", entityId: s.id, action: "control.requested", result: "success" })) });
    const r = await app.inject({ method: "GET", url: `/api/v1/sessions/${s.id}/history`, headers: (await loginAs(app, t)).headers });
    expect(r.statusCode).toBe(200);
    const d = r.json<SessionHistoryDetail>();
    expect(d.quality).toBeNull();
    expect(d.timeline).toHaveLength(500);
    expect(d.timelineTruncated).toBe(true);
    expect(d.controlPeriods).toEqual([]);
  });
});

describe("AC-63 PATCH /sessions/:id", () => {
  it("AC-63: ticketNo/not kaydedilir; yanıt detay; audit session.updated yalnız ticketNo + not uzunluğu", async () => {
    const note = "Satır 1\r\nSatır 2\tsekme — çğıöşü";
    const r = await patch("u1", s1, { ticketNo: "  INC-42 ", note });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<SessionHistoryDetail>()).toMatchObject({ id: s1, ticketNo: "INC-42", note: "Satır 1\nSatır 2\tsekme — çğıöşü" });
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: A, entityId: s1, action: "session.updated" }, orderBy: { id: "desc" } });
    expect(a).toMatchObject({ userId: u1.id, result: "success", oldValue: { ticketNo: null, noteLength: 0 }, newValue: { ticketNo: "INC-42", noteLength: 30 } });
    expect(JSON.stringify([a.oldValue, a.newValue])).not.toContain("Satır");
  });

  it("AC-63: yalnız gönderilen alan değişir; \"\" ve null → NULL; çift gönderim aynı sonucu verir", async () => {
    await patch("u1", s1, { ticketNo: "INC-1", note: "ilk" });
    expect((await patch("u1", s1, { note: "" })).json<SessionHistoryDetail>()).toMatchObject({ ticketNo: "INC-1", note: null });
    expect((await patch("u1", s1, { ticketNo: null })).json<SessionHistoryDetail>()).toMatchObject({ ticketNo: null, note: null });
    const [x, y] = await Promise.all([patch("u1", s1, { ticketNo: "INC-9" }), patch("u1", s1, { ticketNo: "INC-9" })]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    expect(await testDb().supportSession.findUnique({ where: { id: s1 }, select: { ticketNo: true } })).toEqual({ ticketNo: "INC-9" });
  });

  it("AC-63: geçersiz girdi 400 (boş, bilinmeyen alan, uzunluk, Cc/bidi); CSRF/Origin yoksa 403", async () => {
    for (const body of [{}, { foo: 1 }, { ticketNo: "x".repeat(51) }, { note: "n".repeat(4001) }, { ticketNo: "A\nB" }, { note: "a‮b" }, { note: "a\rb" }]) {
      const r = await patch("u1", s1, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await patch("u1", s1, { note: "n".repeat(4000) })).statusCode).toBe(200);
    expect((await patch("u1", s1, { note: "x" }, { "x-csrf-token": "yanlis" })).statusCode).toBe(403);
    expect((await patch("u1", s1, { note: "x" }, { origin: "https://evil.test" })).statusCode).toBe(403);
  });
});

describe("AC-63/124 CSV dışa aktarma", () => {
  let T: string;
  let csvSess: Session;
  let tech: TestUser;
  beforeAll(async () => {
    T = (await createTenant()).id;
    tech = await createUser({ tenantId: T, perms: HIST });
    await testDb().user.update({ where: { id: tech.id }, data: { fullName: "@Teknisyen" } });
    csvSess = await loginAs(app, await createUser({ tenantId: T, role: "ADMIN" }));
    await mk({ tenantId: T, technicianId: tech.id, createdAt: new Date("2026-01-10T21:00:00Z"), customerName: "=HYPERLINK(\"http://x\")", ticketNo: "+905551112233", note: "-2+3;\"alıntı\"\nikinci satır", mode: "AGENT" });
    await mk({ tenantId: T, technicianId: tech.id, createdAt: new Date("2026-01-12T08:00:00Z"), status: "CANCELLED" });
  });

  it("AC-63, AC-124: BOM, ; ayraç, CRLF, Türkçe başlık, Europe/Istanbul zaman, formül kaçışı → RFC 4180; audit session.exported", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/sessions/export.csv?sort=createdAt:asc&customer=hyper", headers: csvSess.headers });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(r.headers["content-disposition"]).toMatch(/^attachment; filename="oturumlar-\d{8}-\d{4}\.csv"$/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    const raw = r.rawPayload.toString("utf8");
    expect(raw.startsWith("﻿")).toBe(true);
    const lines = raw.slice(1).split("\r\n");
    expect(lines[0]).toBe("Oturum No;Oluşturma;Başlangıç;Bitiş;Süre;Durum;Mod;Kaynak;Müşteri firma;Bekleme;Teknisyen;Müşteri;Ticket No;Sonlandıran;Bitiş nedeni;Not");
    expect(raw.slice(1)).toContain(
      `;2026-01-11 00:00:00;2026-01-11 00:00:05;2026-01-11 01:02:05;01:02:00;Bitti;İstemci;Teknisyen;;;'@Teknisyen;"'=HYPERLINK(""http://x"")";'+905551112233;Müşteri;Müşteri bitirdi;"'-2+3;""alıntı""\nikinci satır"\r\n`,
    );
    expect(raw.slice(1).split("\r\n").filter(Boolean)).toHaveLength(2); // başlık + 1 satır (müşteri filtresi)
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: T, action: "session.exported" }, orderBy: { id: "desc" } });
    expect(a).toMatchObject({ entity: "support_sessions", entityId: null, result: "success", newValue: { customerFilter: true, rows: 1, status: null, mode: null } });
    expect(JSON.stringify(a.newValue)).not.toContain("hyper");
  });

  it("AC-61: USER export'u yalnız kendi satırları; SUPER_ADMIN tüm tenant'larda Firma sütunu", async () => {
    const own = (await get("u1", "/api/v1/sessions/export.csv")).rawPayload.toString("utf8");
    expect(own).toContain(s1);
    expect(own).not.toContain(s2);
    expect(own).not.toContain(sB);
    const all = (await get("super", "/api/v1/sessions/export.csv?from=2020-03-01&to=2020-03-03")).rawPayload.toString("utf8");
    expect(all.slice(1).split("\r\n")[0]).toMatch(/^Oturum No;Firma;Oluşturma;/);
    for (const id of [s1, s2, sB]) expect(all).toContain(id);
  });

  it("AC-63: boş sonuç yalnız başlık; dakikada 5 dışa aktarma, 6. istek 429 + Retry-After", async () => {
    const s = await loginAs(app, await createUser({ tenantId: T, perms: HIST }));
    const ex = () => app.inject({ method: "GET", url: "/api/v1/sessions/export.csv", headers: s.headers });
    const first = await ex();
    expect(first.rawPayload.toString("utf8").slice(1).split("\r\n").filter(Boolean)).toHaveLength(1);
    for (let i = 0; i < 4; i++) expect((await ex()).statusCode).toBe(200);
    const sixth = await ex();
    expect(sixth.statusCode).toBe(429);
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("CSV partiler arası keyset imleci: 1000'den fazla satır eksiksiz ve tekrarsız", async () => {
    const tid = (await createTenant()).id;
    const t = await createUser({ tenantId: tid, role: "ADMIN" });
    const same = new Date("2026-05-05T05:05:05Z"); // aynı created_at → ikincil sıra id
    await testDb().supportSession.createMany({
      data: Array.from({ length: 1205 }, (_, i) => ({
        id: newId(), tenantId: tid, technicianId: t.id, tokenHash: sha256Hex(`${tid}-${i}`), techVerifyCode: "1234", status: "EXPIRED",
        createdAt: i % 2 ? same : new Date(same.getTime() + i), expiresAt: new Date(same.getTime() + 900_000 + i), endedAt: new Date(same.getTime() + 900_000 + i), endedBy: "SYSTEM", endReason: "expired",
      })),
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/sessions/export.csv", headers: (await loginAs(app, t)).headers });
    const rows = r.rawPayload.toString("utf8").slice(1).split("\r\n").filter(Boolean).slice(1);
    expect(rows).toHaveLength(1205);
    expect(new Set(rows.map((l) => l.split(";")[0])).size).toBe(1205);
  });
});

describe("P8 admit: müşteri adı/e-postası tüketim UPDATE'inde yazılır", () => {
  it("AC-62: consumeForAdmit customer_name/customer_email'i aynı atomik UPDATE'te yazar", async () => {
    const tid = (await createTenant()).id;
    const t = await createUser({ tenantId: tid });
    const s = await createSupportSessionRow({ tenantId: tid, technicianId: t.id });
    expect(await repo.consumeForAdmit(testDb(), s.id, new Date(), "AGENT", { name: "Ayşe Yılmaz", email: "ayse@example.test" })).toBe(1);
    expect(await testDb().supportSession.findUnique({ where: { id: s.id }, select: { customerName: true, customerEmail: true, mode: true } })).toEqual({ customerName: "Ayşe Yılmaz", customerEmail: "ayse@example.test", mode: "AGENT" });
  });
});

describe("AC-60 performans: 10.000 kayıtta ilk sayfa < 500 ms (ADMIN, USER, SUPER_ADMIN tüm tenant'lar)", () => {
  it("AC-60: üç rolde ilk sayfa (findMany + count) < 500 ms", { timeout: 180_000 }, async () => {
    const slug = `perf-api-${newId().toLowerCase()}`;
    const seeded = await seedPerfSessions(testDb(), { slug, sessions: 10_000, technicians: 10 });
    expect(seeded.total).toBe(10_000);
    await testDb().$executeRawUnsafe("ANALYZE TABLE support_sessions");
    const mkAuth = (role: "ADMIN" | "USER" | "SUPER_ADMIN", userId: string, tenantId: string | null): AuthContext => ({
      sessionId: "perf", expiresAt: new Date(Date.now() + 60_000),
      user: { id: userId, email: "perf@example.test", username: null, fullName: "Perf", role, tenantId, theme: "SYSTEM", mustChangePassword: false },
      tenantId, tenant: null, actingTenant: null, mfaStage: "ok" as const, mfaRequired: false, totpEnabled: false, permissions: new Set(),
    });
    const q = listSessionsQuerySchema.parse({});
    const cases: [string, AuthContext][] = [
      ["ADMIN", mkAuth("ADMIN", newId(), seeded.tenantId)],
      ["USER", mkAuth("USER", seeded.technicianIds[0] ?? "", seeded.tenantId)],
      ["SUPER_ADMIN", mkAuth("SUPER_ADMIN", newId(), null)],
    ];
    const results: Record<string, number> = {};
    for (const [name, auth] of cases) {
      await listHistorySessions(testDb(), auth, q); // ısınma
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await listHistorySessions(testDb(), auth, q);
        times.push(performance.now() - t0);
        expect(r.items).toHaveLength(25);
      }
      times.sort((x, y) => x - y);
      results[name] = Math.round((times[2] ?? 0) * 10) / 10;
      expect(times[2], name).toBeLessThan(500);
    }
    // Ayrıca API üzerinden (ADMIN, perf tenant'ı) uçtan uca.
    const admin = await createUser({ tenantId: seeded.tenantId, role: "ADMIN" });
    const s = await loginAs(app, admin);
    const t0 = performance.now();
    const r = await app.inject({ method: "GET", url: "/api/v1/sessions", headers: s.headers });
    results.API_ADMIN = Math.round((performance.now() - t0) * 10) / 10;
    expect(r.json<SessionListResponse>().total).toBe(10_000);
    expect(results.API_ADMIN).toBeLessThan(500);
    process.stdout.write(`AC-60 ölçüm (ms, medyan): ${JSON.stringify(results)}\n`);
  });
});
