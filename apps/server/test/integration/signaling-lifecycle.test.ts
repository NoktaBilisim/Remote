// P3 yaşam döngüsü: reconnect (G-10, AC-24/25), max süre (AC-13, sahte saat), terminate (AC-114),
// 60 sn yeniden doğrulama (G-04), session.end, /metrics (AC-89).
import { afterEach, describe, expect, it } from "vitest";
import { createUser, loginAs, ORIGIN, testDb } from "../helpers/app.ts";
import { admitted, joinGuest, startLive, techSession, type Live } from "../helpers/signal-flow.ts";
import { connect, FakeClock, makeRooms, roomFixture } from "../helpers/ws.ts";
import { FAKE_METRICS_TOKEN, FAKE_TURN_SECRET } from "../helpers/secrets.ts";
import { admitGuest } from "../../src/signaling/admit.ts";

let live: Live | undefined;
afterEach(async () => live?.close());
const row = (id: string) => testDb().supportSession.findUniqueOrThrow({ where: { id } });

describe("P3 reconnect + bitiş (gerçek WS)", () => {
  it("AC-24/G-10: misafir bağlıyken reconnect 403 + audit; koptuktan sonra yeni token ile hello, teknisyene peer.joined", async () => {
    live = await startLive({ env: { TURN_URLS: "stun:turn.test:3478,turn:turn.test:3478", TURN_SECRET: FAKE_TURN_SECRET } });
    const t = await techSession(live);
    const { guest, hello } = await admitted(live, t);
    const proto = ["rs.v1", `rs.reconnect.${hello.reconnectToken ?? ""}`];
    await expect(connect(`${live.base}/ws/guest`, proto, { origin: ORIGIN })).rejects.toThrow("HTTP 403");
    expect(await testDb().auditLog.count({ where: { entityId: t.sessionId, action: "reconnect.conflict" } })).toBe(1);
    guest.ws.close();
    expect(await t.ws.waitFor("peer.left")).toMatchObject({ role: "guest", reason: "disconnect" });
    const again = await connect(`${live.base}/ws/guest`, proto, { origin: ORIGIN });
    const h2 = await again.waitFor("hello");
    expect(h2.reconnectToken).not.toBe(hello.reconnectToken);
    expect(h2.iceServers.find((x) => x.username)?.credential).toBeTruthy(); // AC-21: TURN HMAC admit sonrası
    expect((await t.ws.waitFor("peer.joined")).role).toBe("guest");
    await expect(connect(`${live.base}/ws/guest`, proto, { origin: ORIGIN })).rejects.toThrow("HTTP 403"); // eski token geçersiz
  });

  it("AC-13/TEST-P4-2: admit sonrası teknisyene peer.joined maxEndsAt = consumedAt + max_active_hours; misafir dönünce de gelir", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await joinGuest(live, t);
    await t.ws.waitFor("peer.pending");
    t.ws.send({ t: "guest.admit", admitCode: g.admitCode });
    const hello = await g.ws.waitFor("hello");
    const joined = await t.ws.waitFor("peer.joined");
    const db = await row(t.sessionId);
    const hours = (await testDb().tenantSettings.findUniqueOrThrow({ where: { tenantId: t.tenantId } })).maxActiveHours;
    const expected = new Date((db.consumedAt?.getTime() ?? 0) + hours * 3_600_000).toISOString();
    expect(joined).toMatchObject({ role: "guest", guestName: "Ayşe Müşteri", maxEndsAt: expected });
    expect(hello.maxEndsAt).toBe(expected);

    g.ws.ws.close();
    await t.ws.waitFor("peer.left");
    const again = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.reconnect.${hello.reconnectToken ?? ""}`], { origin: ORIGIN });
    await again.waitFor("hello");
    expect((await t.ws.waitFor("peer.joined")).maxEndsAt).toBe(expected);
    again.ws.close();
  });

  it("AC-24/TEST-P4-1: misafir soketi kapanır kapanmaz (close işlenmeden) reconnect → 403 değil, hello + yeni token; teknisyene peer.left + peer.joined", async () => {
    live = await startLive();
    const t = await techSession(live);
    const { guest, hello } = await admitted(live, t);
    // F5: tarayıcı 1001 kapanış çerçevesi gönderir ve hemen yeni bağlantı açar; sunucu soketi o an CLOSING'dir.
    guest.ws.close(1001);
    const again = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.reconnect.${hello.reconnectToken ?? ""}`], { origin: ORIGIN });
    const h2 = await again.waitFor("hello");
    expect(h2.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h2.reconnectToken).not.toBe(hello.reconnectToken);
    expect(h2.maxEndsAt).toBe(hello.maxEndsAt);
    expect((await t.ws.waitFor("peer.joined")).maxEndsAt).toBe(hello.maxEndsAt);
    await guest.closed;
    // Eski soketin geç gelen close'u yeni misafiri düşürmez: oturum ACTIVE, conflict audit yok, yeni soket çalışır.
    await new Promise((r) => setTimeout(r, 100));
    expect(t.ws.msgs.filter((m) => m.t === "peer.left")).toHaveLength(1);
    expect(await testDb().auditLog.count({ where: { entityId: t.sessionId, action: "reconnect.conflict" } })).toBe(0);
    expect((await row(t.sessionId)).status).toBe("ACTIVE");
    again.send({ t: "share.state", state: "stopped" });
    expect((await t.ws.waitFor("share.state")).state).toBe("stopped");
    again.ws.close();
  });

  it("AC-59: teknisyen session.end → iki tarafa session.ended{tech}, DB ENDED/TECH + audit", async () => {
    live = await startLive();
    const t = await techSession(live);
    const { guest } = await admitted(live, t);
    t.ws.send({ t: "session.end" });
    expect((await guest.waitFor("session.ended")).reason).toBe("tech");
    expect((await t.ws.waitFor("session.ended")).reason).toBe("tech");
    expect(await row(t.sessionId)).toMatchObject({ status: "ENDED", endedBy: "TECH", endReason: "tech" });
    expect(await testDb().auditLog.count({ where: { entityId: t.sessionId, action: "session.ended" } })).toBe(1);
  });

  it("AC-114: terminate → session.ended{admin}, DB ADMIN + terminated_by; yetkisiz 403, PENDING 409", async () => {
    live = await startLive();
    const t = await techSession(live);
    const admin = await createUser({ tenantId: t.tenantId, role: "ADMIN" });
    const a = await loginAs(live.app, admin);
    const url = `/api/v1/sessions/${t.sessionId}/terminate`;
    expect((await live.app.inject({ method: "POST", url, headers: a.headers, payload: {} })).statusCode).toBe(409);
    const { guest } = await admitted(live, t);
    expect((await live.app.inject({ method: "POST", url, headers: t.techAuth.headers, payload: {} })).statusCode).toBe(403);
    const res = await live.app.inject({ method: "POST", url, headers: a.headers, payload: { reason: "şüpheli" } });
    expect(res.json()).toEqual({ status: "ENDED", endedBy: "ADMIN" });
    expect((await guest.waitFor("session.ended")).reason).toBe("admin");
    expect((await t.ws.waitFor("session.ended")).reason).toBe("admin");
    expect(await row(t.sessionId)).toMatchObject({ status: "ENDED", endedBy: "ADMIN", terminatedBy: admin.id });
    expect(await testDb().auditLog.count({ where: { entityId: t.sessionId, action: "session.terminated" } })).toBe(1);
  });

  it("AC-115/G-04: auth oturumu iptal edilince teknisyen soketi auth_revoked + 4401, oturum ENDED", async () => {
    live = await startLive({ signaling: { revalidateMs: 100 } });
    const t = await techSession(live);
    const { guest } = await admitted(live, t);
    await testDb().authSession.updateMany({ where: { userId: t.tech.id }, data: { revokedAt: new Date() } });
    expect((await t.ws.waitFor("session.ended")).reason).toBe("auth_revoked");
    expect((await t.ws.closed).code).toBe(4401);
    expect((await guest.waitFor("session.ended")).reason).toBe("auth_revoked");
    expect((await row(t.sessionId)).status).toBe("ENDED");
  });

  it("AC-89: /metrics token yoksa 404; yanlış token 401; doğru token Prometheus metni", async () => {
    live = await startLive();
    expect((await live.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(404);
    await live.close();
    live = await startLive({ env: { METRICS_TOKEN: FAKE_METRICS_TOKEN } });
    expect((await live.app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer yanlis-token-000000" } })).statusCode).toBe(401);
    const ok = await live.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${FAKE_METRICS_TOKEN}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain("rs_active_rooms");
    for (const m of ["rs_resolve_failed ", "rs_ws_connections ", "rs_active_sessions ", "rs_ws_connections_total"]) expect(ok.body).toContain(m);
    expect(ok.body).not.toContain("rs_resolve_failed_total");
  });
});

describe("P3 zamanlayıcılar (sahte saat)", () => {
  it("AC-13: max süre 5 dk kala session.warning, sonunda session.ended{max_duration} + DB ENDED/SYSTEM", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await roomFixture(rooms);
    const g = fx.guest();
    await admitGuest(rooms, fx.room, fx.tech, g.admitCode);
    clock.advance(4 * 3_600_000 - 5 * 60_000);
    expect(g.peer.of("session.warning")).toHaveLength(1);
    expect(fx.techPeer.of("session.warning")[0]?.kind).toBe("max_duration_5min");
    expect(g.peer.of("ice.servers").length).toBeGreaterThan(0); // AC-22: credential 60 dk'da bir yenilenir
    clock.advance(5 * 60_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(g.peer.of("session.ended")[0]?.reason).toBe("max_duration");
    expect(await row(fx.session.id)).toMatchObject({ status: "ENDED", endedBy: "SYSTEM", endReason: "max_duration" });
  });

  it("AC-25: misafir 120 sn içinde dönmezse ENDED{timeout}; dönerse sayaç iptal", async () => {
    const clock = new FakeClock();
    const rooms = makeRooms(clock);
    const fx = await roomFixture(rooms);
    const g = fx.guest();
    await admitGuest(rooms, fx.room, fx.tech, g.admitCode);
    rooms.detachGuest(fx.room, g.entry, g.peer);
    clock.advance(100_000);
    rooms.reattachGuest(fx.room, g.peer);
    clock.advance(60_000);
    expect(rooms.live(fx.room)).toBe(true);
    rooms.detachGuest(fx.room, g.entry, g.peer);
    clock.advance(120_000);
    await new Promise((r) => setTimeout(r, 200));
    expect(fx.techPeer.of("session.ended")[0]?.reason).toBe("timeout");
    expect(await row(fx.session.id)).toMatchObject({ status: "ENDED", endReason: "timeout" });
  });
});
