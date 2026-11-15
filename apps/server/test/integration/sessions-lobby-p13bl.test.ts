// P13b-L lobi göstergesi uçları (mimari-lobi §4, §9.1; AC-304, 305, 309, 310, 311, 314). Gerçek MySQL (TEST_DATABASE_URL).
// Lobi durumu uygulamanın kendi `app.rooms` örneğine bellek içi kurulur (join + ticket → LOBBY), DB'de PENDING satır vardır.
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { waitingSessionsResponseSchema, type SessionListResponse, type WaitingSessionsResponse } from "@remote/contracts/api/sessions";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSession } from "../../src/auth/session.ts";
import type { GuestConsent } from "../../src/public/consent.ts";
import * as repo from "../../src/sessions/repo.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  makeApp,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { fakePeer } from "../helpers/ws.ts";

const TECH = { "sessions.create": true, "sessions.view": true };
const URL_WAITING = "/api/v1/sessions/waiting";
const consent: GuestConsent = { textId: "C", version: 1, sha256: "0".repeat(64), at: new Date(), ip: "", userAgent: "" };

/** Odaya (uygulamanın bellek durumu) `n` LOBBY misafiri ekler; TICKETED aşaması atlanmaz (addGuest → ticket → attachGuest). */
async function seatGuests(app: FastifyInstance, sessionId: string, n: number, ipBase = Math.floor(Math.random() * 200)): Promise<void> {
  const row = await repo.findForSignal(testDb(), sessionId);
  if (!row) throw new Error("oturum yok");
  for (let i = 0; i < n; i++) {
    const g = app.rooms.addGuest(row, {
      name: "Ayşe Yılmaz",
      email: "ayse@example.test",
      kind: "BROWSER",
      ipKey: `198.51.${ipBase}.${i + 1}`,
      consent,
    });
    const room = app.rooms.get(sessionId);
    const t = app.rooms.tickets.take(g.wsTicket);
    const entry = t ? room?.lobby.get(t.guestId) : undefined;
    if (!room || !entry) throw new Error("ticket geçersiz");
    app.rooms.attachGuest(room, entry, fakePeer());
  }
}

describe("P13b-L GET /sessions/waiting + GET /sessions waitingGuests", () => {
  let app: FastifyInstance;
  let A: string;
  let B: string;
  let userA: TestUser;
  let userB: TestUser;
  let userC: TestUser;
  let sa: TestUser;
  const sess: Record<string, Session> = {};
  let sA1: string; // userA, 1 misafir
  let sA3: string; // userA, 3 misafir
  let sB: string; // userB (aynı tenant), 2 misafir
  let sC: string; // userC (tenant B), 1 misafir
  let sSa: string; // Super Admin'in A'daki oturumu, 1 misafir
  let sEnded: string;
  let histUser: TestUser;

  const get = (who: string, url: string) => app.inject({ method: "GET", url, headers: sess[who]?.headers });
  const waiting = async (who: string): Promise<WaitingSessionsResponse> => {
    const r = await get(who, URL_WAITING);
    expect(r.statusCode, r.body).toBe(200);
    return waitingSessionsResponseSchema.parse(r.json());
  };
  const listItems = async (who: string, qs = "?pageSize=100") => {
    const r = await get(who, `/api/v1/sessions${qs}`);
    expect(r.statusCode, r.body).toBe(200);
    return r.json<SessionListResponse>().items;
  };

  beforeAll(async () => {
    app = makeApp();
    await app.ready();
    A = (await createTenant()).id;
    B = (await createTenant()).id;
    userA = await createUser({ tenantId: A, perms: TECH });
    userB = await createUser({ tenantId: A, perms: TECH });
    userC = await createUser({ tenantId: B, perms: TECH });
    const adminA = await createUser({ tenantId: A, role: "ADMIN" });
    const histOnly = await createUser({
      tenantId: A,
      perms: { "sessions.view": false, "session_history.view": true, "customers.view": true },
    });
    histUser = histOnly;
    sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    sA1 = (await createSupportSessionRow({ tenantId: A, technicianId: userA.id })).id;
    sA3 = (await createSupportSessionRow({ tenantId: A, technicianId: userA.id })).id;
    sB = (await createSupportSessionRow({ tenantId: A, technicianId: userB.id })).id;
    sC = (await createSupportSessionRow({ tenantId: B, technicianId: userC.id })).id;
    sSa = (await createSupportSessionRow({ tenantId: A, technicianId: sa.id })).id;
    sEnded = (await createSupportSessionRow({ tenantId: A, technicianId: userA.id, status: "ENDED" })).id;
    await seatGuests(app, sA1, 1, 1);
    await seatGuests(app, sA3, 3, 2);
    await seatGuests(app, sB, 2, 3);
    await seatGuests(app, sC, 1, 4);
    await seatGuests(app, sSa, 1, 5);
    for (const [k, u] of [
      ["a", userA],
      ["b", userB],
      ["c", userC],
      ["admin", adminA],
      ["hist", histOnly],
      ["sa", sa],
    ] as const)
      sess[k] = await loginAs(app, u);
  });
  afterAll(async () => {
    await app.close();
  });

  it("AC-314: çerezsiz 401 UNAUTHENTICATED", async () => {
    const r = await app.inject({ method: "GET", url: URL_WAITING });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("AC-314/306: sessions.view yoksa 403 (session_history.view ile liste 200, uç 403)", async () => {
    expect((await get("hist", "/api/v1/sessions")).statusCode).toBe(200);
    const r = await get("hist", URL_WAITING);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("AC-314/S13L-1: sessions.view yoksa GET /sessions ve GET /customers/:id/sessions her satırda waitingGuests 0", async () => {
    const cust = await createCustomerRow(A);
    const s = (await createSupportSessionRow({ tenantId: A, technicianId: histUser.id })).id;
    await testDb().supportSession.update({ where: { id: s }, data: { customerId: cust.id } });
    await seatGuests(app, s, 2, 7);
    const own = (await listItems("hist")).find((i) => i.id === s);
    expect(own).toMatchObject({ status: "PENDING", waitingGuests: 0 });
    const tab = await get("hist", `/api/v1/customers/${cust.id}/sessions`);
    expect(tab.statusCode, tab.body).toBe(200);
    expect(tab.json<SessionListResponse>().items.find((i) => i.id === s)?.waitingGuests).toBe(0);
    // Karşılaştırma: sessions.view olan ADMIN aynı satırları lobi sayısıyla görür.
    expect((await listItems("admin")).find((i) => i.id === s)?.waitingGuests).toBe(2);
    const adminTab = await get("admin", `/api/v1/customers/${cust.id}/sessions`);
    expect(adminTab.json<SessionListResponse>().items.find((i) => i.id === s)?.waitingGuests).toBe(2);
  });

  it("AC-310: firma seçmemiş Super Admin → 403 'Önce bir firma seçin.'", async () => {
    const r = await get("sa", URL_WAITING);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: "FORBIDDEN", message: "Önce bir firma seçin." } });
  });

  it("AC-306/309: USER yalnız kendi oturumlarını sayar; id sıralı, count = Σ waiting; B ve C'nin misafiri yok", async () => {
    const a = await waiting("a");
    expect(a.count).toBe(4);
    expect(a.sessions).toEqual(
      [
        ...[
          { id: sA1, waiting: 1, arrivals: 1 },
          { id: sA3, waiting: 3, arrivals: 3 },
        ],
      ].sort((x, y) => (x.id < y.id ? -1 : 1)),
    );
    expect(await waiting("b")).toEqual({ count: 2, sessions: [{ id: sB, waiting: 2, arrivals: 2 }] });
    expect(await waiting("c")).toEqual({ count: 1, sessions: [{ id: sC, waiting: 1, arrivals: 1 }] });
  });

  it("AC-309: ADMIN'in sayacı yalnız kendi (0); listede B'nin satırında waitingGuests > 0; tenant-2 oturumu yok", async () => {
    expect(await waiting("admin")).toEqual({ count: 0, sessions: [] });
    const items = await listItems("admin");
    expect(items.find((i) => i.id === sB)?.waitingGuests).toBe(2);
    expect(items.find((i) => i.id === sA3)?.waitingGuests).toBe(3);
    expect(items.some((i) => i.id === sC)).toBe(false);
  });

  it("AC-305/309: USER listesinde yalnız kendi satırları; PENDING değer lobiden, PENDING dışı 0", async () => {
    const items = await listItems("a");
    expect(items.every((i) => i.technician.id === userA.id)).toBe(true);
    expect(items.find((i) => i.id === sA1)?.waitingGuests).toBe(1);
    expect(items.find((i) => i.id === sA3)?.waitingGuests).toBe(3);
    expect(items.find((i) => i.id === sEnded)).toMatchObject({ status: "ENDED", waitingGuests: 0 });
    expect(items.some((i) => i.id === sB)).toBe(false);
  });

  it("AC-310: firma seçmemiş Super Admin listesi tüm tenant'larda waitingGuests döner", async () => {
    const items = await listItems("sa", `?pageSize=100&tenantId=${A}`);
    expect(items.find((i) => i.id === sB)?.waitingGuests).toBe(2);
    const itemsB = await listItems("sa", `?pageSize=100&tenantId=${B}`);
    expect(itemsB.find((i) => i.id === sC)?.waitingGuests).toBe(1);
  });

  it("AC-310/309: Super Admin firma A'da kendi oturumu sayılır, firma B'ye geçince sayılmaz", async () => {
    const own = await loginAs(app, sa); // ayrı oturum: diğer testlerin firma seçmemiş "sa" oturumu bozulmaz
    const sw = (tenantId: string) =>
      app.inject({ method: "POST", url: "/api/v1/admin/switch-tenant", headers: own.headers, payload: { tenantId } });
    expect((await sw(A)).statusCode).toBe(200);
    const inA = await app.inject({ method: "GET", url: URL_WAITING, headers: own.headers });
    expect(inA.json()).toEqual({ count: 1, sessions: [{ id: sSa, waiting: 1, arrivals: 1 }] });
    expect((await sw(B)).statusCode).toBe(200);
    const inB = await app.inject({ method: "GET", url: URL_WAITING, headers: own.headers });
    expect(inB.json()).toEqual({ count: 0, sessions: [] });
  });

  it("AC-314/311: Cache-Control no-store; audit yazılmaz; strict şema; ad/e-posta/IP/kod gövdede yok; sorgu dizesi yok sayılır", async () => {
    const mine = () => testDb().auditLog.count({ where: { userId: userA.id } });
    const before = await mine();
    const r = await get("a", `${URL_WAITING}?technicianId=${userB.id}&tenantId=${B}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const body = waitingSessionsResponseSchema.parse(r.json());
    expect(body.sessions.map((s) => s.id).sort()).toEqual([sA1, sA3].sort());
    expect(r.body).not.toMatch(/Ayşe|ayse@|198\.51|admitCode|BROWSER/);
    expect(await mine()).toBe(before); // salt okuma: bu kullanıcıya yeni audit satırı yok
  });

  it("AC-305: ret ve iptal sonrası sayılar düşer (iptal → liste ve uç 0)", async () => {
    const s = (await createSupportSessionRow({ tenantId: A, technicianId: userA.id })).id;
    await seatGuests(app, s, 2, 6);
    expect((await waiting("a")).sessions.find((x) => x.id === s)?.waiting).toBe(2);
    const room = app.rooms.get(s);
    const first = room ? [...room.lobby.values()][0] : undefined;
    if (!room || !first) throw new Error("oda yok");
    app.rooms.leaveLobby(room, first, "rejected", "rejected");
    expect((await waiting("a")).sessions.find((x) => x.id === s)?.waiting).toBe(1);
    // ADMIN iptali: DB CANCELLED + RoomNotifier.closeSession → oda bellekten kalkar.
    const cancel = await app.inject({ method: "POST", url: `/api/v1/sessions/${s}/cancel`, headers: sess.admin?.headers });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect((await waiting("a")).sessions.some((x) => x.id === s)).toBe(false);
    expect((await listItems("a")).find((i) => i.id === s)).toMatchObject({ status: "CANCELLED", waitingGuests: 0 });
  });
});

describe("P13b-L hız sınırı (AC-314)", () => {
  it("AC-314: 60 istek/dk 200, 61. istek 429 RATE_LIMITED + Retry-After; başka kullanıcı etkilenmez", async () => {
    const app = makeApp();
    await app.ready();
    try {
      const t = (await createTenant()).id;
      const u1 = await loginAs(app, await createUser({ tenantId: t, perms: TECH }));
      const u2 = await loginAs(app, await createUser({ tenantId: t, perms: TECH }));
      const codes: number[] = [];
      for (let i = 0; i < 60; i++) codes.push((await app.inject({ method: "GET", url: URL_WAITING, headers: u1.headers })).statusCode);
      expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true); // 5 sekme × 6/dk = 30/dk
      expect(codes[59]).toBe(200);
      const over = await app.inject({ method: "GET", url: URL_WAITING, headers: u1.headers });
      expect(over.statusCode).toBe(429);
      expect(over.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
      expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
      expect((await app.inject({ method: "GET", url: URL_WAITING, headers: u2.headers })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("P13b-L performans (AC-314)", () => {
  it("AC-314: 100 açık oturum × 3 bekleyen (300) → 1000 istek p95 ≤ 100 ms", async () => {
    const app = makeApp();
    const elapsed: number[] = [];
    app.addHook("onResponse", async (req, reply) => {
      if (req.url === URL_WAITING && reply.statusCode === 200) elapsed.push(reply.elapsedTime);
    });
    await app.ready();
    try {
      const t = (await createTenant()).id;
      // 60/dk kullanıcı sınırı nedeniyle 1000 istek 20 ölçüm kullanıcısına bölünür (her biri 50); her kullanıcının 3 odası,
      // geri kalan 40 oda başka teknisyenindir → toplam 100 oda, 300 LOBBY misafir.
      const users = await Promise.all(Array.from({ length: 20 }, () => createUser({ tenantId: t, perms: TECH })));
      const other = await createUser({ tenantId: t, perms: TECH });
      const owners = [...users.flatMap((u) => [u.id, u.id, u.id]), ...Array.from({ length: 40 }, () => other.id)];
      let ipBase = 0;
      for (const technicianId of owners) {
        const s = await createSupportSessionRow({ tenantId: t, technicianId });
        await seatGuests(app, s.id, 3, ipBase++ % 250);
      }
      // Giriş IP sınırına (20/dk) takılmamak için oturumlar doğrudan açılır (login akışı başka testlerde).
      const cookies = await Promise.all(
        users.map(
          async (u) => `${SESSION_COOKIE}=${(await openSession(testDb(), u.id, { ip: "127.0.0.1", userAgent: "perf" }, new Date())).token}`,
        ),
      );
      for (const cookie of cookies) await app.inject({ method: "GET", url: URL_WAITING, headers: { cookie } }); // ısınma
      elapsed.length = 0;
      for (let i = 0; i < 1000; i++) {
        const cookie = cookies[i % cookies.length] ?? "";
        const r = await app.inject({ method: "GET", url: URL_WAITING, headers: { cookie } });
        if (r.statusCode !== 200) throw new Error(`istek ${i}: ${r.statusCode} ${r.body}`);
        if (i < cookies.length) expect(r.json<WaitingSessionsResponse>().count).toBe(9);
      }
      expect(elapsed).toHaveLength(1000);
      const sorted = [...elapsed].sort((x, y) => x - y);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity;
      const p50 = sorted[Math.ceil(sorted.length * 0.5) - 1] ?? Infinity;
      process.stdout.write(
        `[AC-314 perf] GET /sessions/waiting 1000 istek, 100 oda/300 misafir: p50=${p50.toFixed(2)} ms p95=${p95.toFixed(2)} ms\n`,
      );
      expect(p95).toBeLessThanOrEqual(100);
    } finally {
      await app.close();
    }
  });
});
