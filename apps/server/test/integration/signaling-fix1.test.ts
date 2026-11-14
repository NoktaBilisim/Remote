// P3 düzeltme turu 1: AC-7 (join 410 audit), AC-19 (ping/pong), AC-113 (guest.pending audit), AC-115
// (endByTechnician), AC-120 (sinyalizasyon log taraması), S-P3-4 (expiry → oda kapanışı, sınırlı oda ömrü),
// S-P3-7 (/ws/tech IP limiti), AC-89 (gösterge serileri).
import { Writable } from "node:stream";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.ts";
import { rejectGuest } from "../../src/signaling/admit.ts";
import { expireDue } from "../../src/sessions/service.ts";
import { ORIGIN, testDb } from "../helpers/app.ts";
import { admitted, joinGuest, startLive, techSession, type Live } from "../helpers/signal-flow.ts";
import { connect, FakeClock, makeRooms, roomFixture, techHeaders } from "../helpers/ws.ts";

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});
const row = (id: string) => testDb().supportSession.findUniqueOrThrow({ where: { id } });
const big = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? String(v) : v);
const CTX = { ip: "", userAgent: "test", requestId: "r" };

describe("P3 düzeltme 1 — audit", () => {
  it("AC-7 (QA-P3-1): tüketilmiş oturumda join → 410 SESSION_CONSUMED + session.join result=fail audit (token/kod yok)", async () => {
    live = await startLive();
    const t = await techSession(live);
    const headers = { origin: ORIGIN, "x-forwarded-for": "203.0.113.50" };
    const r = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers, payload: { token: t.token, clientKind: "BROWSER" } });
    const { joinNonce } = r.json<{ joinNonce: string }>();
    await admitted(live, t); // oturum ACTIVE
    const j = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/join", headers, payload: { joinNonce, customerName: "Geç Kalan", consentAccepted: true, consentTextId: t.consentTextId } });
    expect(j.statusCode).toBe(410);
    expect(j.json<{ error: { code: string } }>().error.code).toBe("SESSION_CONSUMED");
    const logs = await testDb().auditLog.findMany({ where: { entityId: t.sessionId, action: "session.join" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ result: "fail", newValue: { reason: "SESSION_CONSUMED" } });
    const dump = JSON.stringify(logs, big);
    for (const s of [joinNonce, t.token, t.code]) expect(dump).not.toContain(s);
  });

  it("AC-113 (QA-P3-4, S-P13a-1): join → tek guest.pending audit; yalnız guestId/tür/onay, admitCode ve ticket yok", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await joinGuest(live, t);
    const logs = await testDb().auditLog.findMany({ where: { entityId: t.sessionId, action: "guest.pending" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ result: "success", username: "customer" });
    // S-P13a-1: ad audit'e yazılmaz (oturum satırında, saklama işiyle silinir)
    expect(Object.keys(logs[0]?.newValue as object).sort()).toEqual(["consentTextId", "consentVersion", "guestId", "guestKind"]);
    expect(JSON.stringify(logs, big)).not.toContain(`"${g.admitCode}"`);
  });

  it("AC-115 (QA-P3-5): endByTechnician → iki odada session.ended{auth_revoked}, teknisyene 4401, DB ENDED/SYSTEM + audit", async () => {
    live = await startLive();
    const a = await techSession(live);
    const res = await live.app.inject({ method: "POST", url: "/api/v1/sessions", headers: a.techAuth.headers, payload: {} });
    const created = res.json<{ id: string; link: string; code: string }>();
    const bWs = await connect(`${live.base}/ws/tech?sessionId=${created.id}`, ["rs.v1"], techHeaders(a.techAuth.token, ORIGIN));
    await bWs.waitFor("hello");
    const b = { ...a, sessionId: created.id, token: created.link.split("/").pop() ?? "", code: created.code, ws: bWs };
    const ga = await admitted(live, a);
    const gb = await admitted(live, b);
    await live.app.rooms.endByTechnician(a.tech.id);
    for (const ws of [a.ws, b.ws, ga.guest, gb.guest]) expect((await ws.waitFor("session.ended")).reason).toBe("auth_revoked");
    expect((await a.ws.closed).code).toBe(4401);
    expect((await b.ws.closed).code).toBe(4401);
    for (const id of [a.sessionId, b.sessionId]) {
      expect(await row(id)).toMatchObject({ status: "ENDED", endedBy: "SYSTEM", endReason: "auth_revoked" });
      expect(await testDb().auditLog.count({ where: { entityId: id, action: "session.ended", result: "success" } })).toBe(1);
    }
    expect(live.app.rooms.size).toBe(0);
  });
});

describe("P3 düzeltme 1 — bağlantı ve oda ömrü", () => {
  it("AC-19 (QA-P3-2a): pong vermeyen soket 2 ping sonra terminate; pong veren açık kalır", async () => {
    live = await startLive({ signaling: { pingMs: 50 } });
    const ok = await techSession(live);
    const t = await techSession(live);
    const raw = await connect(`${live.base}/ws/tech?sessionId=${t.sessionId}`, ["rs.v1"], techHeaders(t.techAuth.token, ORIGIN), { autoPong: false });
    const started = Date.now();
    expect((await raw.closed).code).toBe(1006); // terminate: kapanış çerçevesi yok
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(ok.ws.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("S-P3-7: /ws/tech upgrade'i IP başına 31/dk; aşınca DB'ye gitmeden 429", async () => {
    live = await startLive();
    const url = `${live.base}/ws/tech?sessionId=01ARZ3NDEKTSV4RRFFQ69G5FAV`;
    for (let i = 0; i < 30; i++) await expect(connect(url, ["rs.v1"], { origin: ORIGIN })).rejects.toThrow("HTTP 403");
    await expect(connect(url, ["rs.v1"], { origin: ORIGIN })).rejects.toThrow("HTTP 429");
    await expect(connect(url, ["rs.v1"], { origin: ORIGIN })).rejects.toThrow("HTTP 429");
  });

  it("S-P3-4: expiry işi PENDING oturumu EXPIRED yapınca teknisyen + lobi session.ended{timeout}, oda bellekten silinir", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await joinGuest(live, t);
    const n = await expireDue(testDb(), CTX, new Date(Date.now() + 48 * 3600_000), live.app.rooms);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await t.ws.waitFor("session.ended")).reason).toBe("timeout");
    expect((await g.ws.waitFor("session.ended")).reason).toBe("timeout");
    expect(live.app.rooms.get(t.sessionId)).toBeUndefined();
    expect((await row(t.sessionId)).status).toBe("EXPIRED");
  });

  it("S-P3-4: ret listesi olan boş oda PENDING süresi bitene kadar tutulur (AC-113), sonra silinir", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const f = await roomFixture(rooms);
    const g = f.guest();
    await rejectGuest(rooms, f.room, f.tech, g.guestId);
    rooms.detachTech(f.room, f.techPeer);
    expect(rooms.get(f.session.id)).toBe(f.room); // tekrar katılım hâlâ reddedilmeli
    clock.advance(f.row.expiresAt.getTime() - clock.now() + 1);
    expect(rooms.get(f.session.id)).toBeUndefined();
  });
});

describe("P3 düzeltme 1 — log tarama (AC-120, QA-P3-2b)", () => {
  it("AC-120: join → ticket WS → admit → reconnect (çakışan + geçerli) ve sorguda sızmış ticket; logda nonce/ticket/token/kod yok", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    live = await startLive({ logger: createLogger("trace", sink) });
    const t = await techSession(live);
    const headers = { origin: ORIGIN, "x-forwarded-for": "203.0.113.60" };
    const r = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers, payload: { token: t.token, clientKind: "BROWSER" } });
    const { joinNonce } = r.json<{ joinNonce: string }>();
    const j = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/join", headers, payload: { joinNonce, customerName: "Ayşe", consentAccepted: true, consentTextId: t.consentTextId } });
    const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
    await expect(connect(`${live.base}/ws/guest?ticket=${wsTicket}`, ["rs.v1"], { origin: ORIGIN })).rejects.toThrow("HTTP 403");
    const guest = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`], { origin: ORIGIN });
    await guest.waitFor("lobby.wait");
    await t.ws.waitFor("peer.pending");
    t.ws.send({ t: "guest.admit", admitCode: "0000" === admitCode ? "0001" : "0000" }); // hatalı kod da loglanmamalı
    await t.ws.waitFor("error");
    t.ws.send({ t: "guest.admit", admitCode });
    const hello = await guest.waitFor("hello");
    const token1 = hello.reconnectToken ?? "";
    await expect(connect(`${live.base}/ws/guest`, ["rs.v1", `rs.reconnect.${token1}`], { origin: ORIGIN })).rejects.toThrow("HTTP 403");
    guest.ws.close();
    await t.ws.waitFor("peer.left");
    const again = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.reconnect.${token1}`], { origin: ORIGIN });
    const token2 = (await again.waitFor("hello")).reconnectToken ?? "";
    await live.close();
    live = undefined;

    const all = lines.join("");
    expect(all).toContain("ws upgrade reddedildi");
    for (const s of [joinNonce, wsTicket, token1, token2, t.token, t.techAuth.token]) {
      expect(s.length).toBeGreaterThan(10);
      expect(all).not.toContain(s);
    }
    expect(all).not.toContain(`"${admitCode}"`);
    expect(all).not.toMatch(/admitCode|wsTicket|reconnectToken|joinNonce/);
  });
});
