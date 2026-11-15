// P8b-1 test turu 3 — zamanlayıcılar/süpürücü, ön-kabullü misafir ve asgari istemci sürümü (426).
// AC-141, AC-142, AC-145, AC-152 (§13.4), AC-154 (§13.3), AC-155; mimari-e9 §13.2. Zamanlayıcılar sahte saatle ilerletilir.
import { afterEach, describe, expect, it } from "vitest";
import { sweepRequests } from "../../src/requests/jobs.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import { createRequestRow, createRequestSettings, hasMsg, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, techSession, type Live } from "../helpers/signal-flow.ts";
import { FakeClock } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;
const tick = (ms = 100) => new Promise((r) => setTimeout(r, ms));

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

async function boot(o: { clock?: FakeClock; env?: Record<string, string> } = {}) {
  live = await startLive({ env: { ...PROXY, ...o.env }, ...(o.clock ? { signaling: { clock: o.clock } } : {}) });
  return { live, rc: requestClient(live.app, live.base) };
}

let ipSeq = 0;
const nextIp = () => `198.51.${100 + (Math.floor(ipSeq / 200) % 50)}.${(ipSeq++ % 200) + 20}`;

async function tech(app: Live["app"], tenantId: string, perms: Record<string, boolean> = REQ_PERMS): Promise<{ id: string; s: Session }> {
  const user = await createUser({ tenantId, role: "USER", perms });
  return { id: user.id, s: await loginAs(app, user) };
}

const reqRow = (id: string) => testDb().supportRequest.findUniqueOrThrow({ where: { id } });
const sessRow = (requestId: string) => testDb().supportSession.findFirstOrThrow({ where: { requestId } });

describe("P8b-1 zamanlayıcılar ve süpürücü", () => {
  it("AC-141: /ws/request 120 sn kopukluk → CANCELLED(DISCONNECTED) + panele request.removed; 120 sn içinde yeniden bağlanan talep iptal olmaz", async () => {
    const clock = new FakeClock();
    const { live: l, rc } = await boot({ clock });
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const c = (await rc.createReq(ref, nextIp())).json<{ requestId: string; requestSecret: string }>();
    const x = await tech(l.app, t.id);
    const panel = await rc.panelWs(x.s.token);
    await waitMsg(panel, "queue.count");

    const ws1 = await rc.reqWs(c.requestSecret);
    await waitMsg(ws1, "request.state");
    ws1.ws.terminate();
    await expect.poll(() => clock.hasTimerIn(120_000)).toBe(true);
    clock.advance(60_000);
    const ws2 = await rc.reqWs(c.requestSecret); // tolerans içinde yeniden bağlandı → zamanlayıcı iptal
    await waitMsg(ws2, "request.state");
    clock.advance(120_000);
    await tick();
    expect((await reqRow(c.requestId)).status).toBe("PENDING");

    ws2.ws.terminate();
    await expect.poll(() => clock.hasTimerIn(120_000)).toBe(true);
    clock.advance(119_999);
    await tick();
    expect((await reqRow(c.requestId)).status).toBe("PENDING");
    clock.advance(1);
    await expect.poll(async () => (await reqRow(c.requestId)).cancelReason).toBe("DISCONNECTED");
    expect((await reqRow(c.requestId)).status).toBe("CANCELLED");
    expect(await waitMsg(panel, "request.removed")).toEqual({ t: "request.removed", id: c.requestId, status: "CANCELLED" });
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.cancelled" } });
    expect(a).toMatchObject({ username: "system", newValue: { status: "CANCELLED", reason: "DISCONNECTED" } });
  });

  it("AC-155: kabulden sonra 60 sn bağlanılmazsa talep CONNECT_FAILED, oturum CANCELLED(connect_timeout); yalnız kabul edene request.connect_failed, istemciye request.closed", async () => {
    const clock = new FakeClock();
    const { live: l, rc } = await boot({ clock });
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const c = (await rc.createReq(ref, nextIp())).json<{ requestId: string; requestSecret: string }>();
    const ws = await rc.reqWs(c.requestSecret);
    await waitMsg(ws, "request.state");
    const x = await tech(l.app, t.id);
    const y = await tech(l.app, t.id);
    const px = await rc.panelWs(x.s.token);
    const py = await rc.panelWs(y.s.token);
    await waitMsg(px, "queue.count");
    await waitMsg(py, "queue.count");

    const acc = await rc.accept(x.s.headers, c.requestId);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    await waitMsg(ws, "request.accepted");
    clock.advance(59_999);
    await tick();
    expect((await reqRow(c.requestId)).status).toBe("ACCEPTED");
    clock.advance(1);
    await expect.poll(async () => (await reqRow(c.requestId)).status).toBe("CONNECT_FAILED");
    expect(await sessRow(c.requestId)).toMatchObject({
      id: sessionId,
      status: "CANCELLED",
      endReason: "connect_timeout",
      endedBy: "SYSTEM",
    });
    expect(await waitMsg(px, "request.connect_failed")).toEqual({ t: "request.connect_failed", id: c.requestId, sessionId });
    expect(await waitMsg(ws, "request.closed")).toMatchObject({ status: "CONNECT_FAILED" });
    await tick();
    expect(hasMsg(py, "request.connect_failed")).toBe(false);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.connect_failed" } });
    expect(a.newValue).toMatchObject({ status: "CONNECT_FAILED", sessionId, reason: "connect_timeout" });
  });

  it("AC-155: süpürücü yedek yolu — oturumu süresi dolmuş ACCEPTED talep CONNECT_FAILED olur", async () => {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const { id } = await createRequestRow(t.id);
    const x = await tech(l.app, t.id);
    expect((await rc.accept(x.s.headers, id)).statusCode).toBe(200);
    l.app.requests.clearConnectTimer(id); // bellek zamanlayıcısı kaybolmuş (ör. yeniden başlatma) varsayımı
    await testDb().supportSession.updateMany({
      where: { requestId: id },
      data: { createdAt: new Date(Date.now() - 61_000), expiresAt: new Date(Date.now() - 1000) },
    });
    const out = await sweepRequests(l.app.requests);
    expect(out.connectFailed).toBeGreaterThanOrEqual(1);
    expect((await reqRow(id)).status).toBe("CONNECT_FAILED");
    expect(await sessRow(id)).toMatchObject({ status: "CANCELLED", endReason: "connect_timeout" });
  });

  it("AC-145: tenant pasife alınınca süpürücü bekleyen talebi CANCELLED(TENANT_PASSIVE) yapar; istemciye request.closed; ref artık aynı 404", async () => {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const ip = nextIp();
    const c = (await rc.createReq(ref, ip)).json<{ requestId: string; requestSecret: string }>();
    const ws = await rc.reqWs(c.requestSecret);
    await waitMsg(ws, "request.state");
    await testDb().tenant.update({ where: { id: t.id }, data: { status: "PASSIVE" } });
    const out = await sweepRequests(l.app.requests);
    expect(out.tenantPassive).toBeGreaterThanOrEqual(1);
    expect(await reqRow(c.requestId)).toMatchObject({ status: "CANCELLED", cancelReason: "TENANT_PASSIVE" });
    expect(await waitMsg(ws, "request.closed")).toMatchObject({ status: "CANCELLED", reason: "TENANT_PASSIVE" });
    expect((await ws.closed).code).toBe(1000);
    const info = await rc.tenantInfo(ref, ip);
    const unknown = await rc.tenantInfo("abcdefghijklmnop", ip);
    expect(info.statusCode).toBe(404);
    const strip = (b: string) => b.replace(/"requestId":"[0-9A-Z]{26}"/, "");
    expect(strip(info.body)).toBe(strip(unknown.body));
    const again = await rc.createReq(ref, ip, { consentTextId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(again.statusCode).toBe(404);
  });

  it("AC-154 / §13.3: ACCEPTED iken müşteri request.decline → talep CANCELLED(CUSTOMER), oturum CANCELLED(customer_declined), kabul edene request.declined; 60 sn penceresi iptal", async () => {
    const clock = new FakeClock();
    const { live: l, rc } = await boot({ clock });
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const c = (await rc.createReq(ref, nextIp())).json<{ requestId: string; requestSecret: string }>();
    const ws = await rc.reqWs(c.requestSecret);
    await waitMsg(ws, "request.state");
    const x = await tech(l.app, t.id);
    const panel = await rc.panelWs(x.s.token);
    await waitMsg(panel, "queue.count");
    const { sessionId } = (await rc.accept(x.s.headers, c.requestId)).json<{ sessionId: string }>();
    await waitMsg(ws, "request.accepted");

    ws.send({ t: "request.decline" });
    expect(await waitMsg(panel, "request.declined")).toEqual({ t: "request.declined", id: c.requestId, sessionId });
    expect(await waitMsg(ws, "request.closed")).toMatchObject({ status: "CANCELLED", reason: "CUSTOMER" });
    expect(await reqRow(c.requestId)).toMatchObject({ status: "CANCELLED", cancelReason: "CUSTOMER", acceptedBy: x.id });
    expect(await sessRow(c.requestId)).toMatchObject({ status: "CANCELLED", endReason: "customer_declined", endedBy: "CUSTOMER" });
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.cancelled" } });
    expect(a.newValue).toMatchObject({ status: "CANCELLED", reason: "CUSTOMER", phase: "accepted", sessionId });

    clock.advance(60_000);
    await tick();
    expect((await reqRow(c.requestId)).status).toBe("CANCELLED"); // CONNECT_FAILED'e dönmez
    expect(hasMsg(panel, "request.connect_failed")).toBe(false);
    // kapanmış talep yeniden kabul edilemez (AC-153)
    const again = await rc.accept(x.s.headers, c.requestId);
    expect(again.statusCode).toBe(409);
  });

  it("AC-142: bekleme süresi dolan talep süpürücüde EXPIRED; istemciye request.closed EXPIRED, panele request.removed; kabul 409", async () => {
    const clock = new FakeClock();
    clock.t = Date.now() - 10 * 60_000 - 2_000; // talep "10 dk 2 sn önce" açılmış gibi (sahte saat geride)
    const { live: l, rc } = await boot({ clock });
    const t = await createTenant();
    const ref = await createRequestSettings(t.id, { waitMinutes: 10 });
    const c = (await rc.createReq(ref, nextIp())).json<{ requestId: string; requestSecret: string; expiresAt: string }>();
    expect(Date.parse(c.expiresAt)).toBeLessThan(Date.now());
    const ws = await rc.reqWs(c.requestSecret);
    await waitMsg(ws, "request.state");
    const x = await tech(l.app, t.id);
    const panel = await rc.panelWs(x.s.token);
    await waitMsg(panel, "queue.count");
    clock.t = Date.now();
    const out = await sweepRequests(l.app.requests);
    expect(out.expired).toBeGreaterThanOrEqual(1);
    expect((await reqRow(c.requestId)).status).toBe("EXPIRED");
    expect(await waitMsg(ws, "request.closed")).toMatchObject({ status: "EXPIRED" });
    expect(await waitMsg(panel, "request.removed")).toEqual({ t: "request.removed", id: c.requestId, status: "EXPIRED" });
    expect(await testDb().auditLog.count({ where: { entityId: c.requestId, action: "request.expired", result: "success" } })).toBe(1);
    const acc = await rc.accept(x.s.headers, c.requestId);
    expect(acc.statusCode).toBe(409);
    expect(errCode(acc)).toBe("REQUEST_CLOSED");
  });
});

describe("P8b-1 ön-kabullü talep misafiri (§13.2)", () => {
  async function acceptedTicket(perms: Record<string, boolean> = REQ_PERMS) {
    const { live: l, rc } = await boot();
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const c = (await rc.createReq(ref, nextIp())).json<{ requestId: string; requestSecret: string }>();
    const ws = await rc.reqWs(c.requestSecret);
    await waitMsg(ws, "request.state");
    const x = await tech(l.app, t.id, perms);
    const acc = await rc.accept(x.s.headers, c.requestId);
    expect(acc.statusCode).toBe(200);
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(ws, "request.accepted");
    return { l, rc, x, c, ws, wsTicket, sessionId: acc.json<{ sessionId: string }>().sessionId };
  }

  it("§13.2: teknisyen pasif olunca ticket'lı misafir session.ended{auth_revoked}; oturum CANCELLED(auth_revoked), talep CONNECT_FAILED, istemciye request.closed", async () => {
    const { rc, x, c, ws, wsTicket, sessionId } = await acceptedTicket();
    await testDb().user.update({ where: { id: x.id }, data: { status: "PASSIVE" } });
    const g = await rc.guestWs(wsTicket);
    expect(await waitMsg(g, "session.ended")).toMatchObject({ reason: "auth_revoked" });
    await expect.poll(async () => (await reqRow(c.requestId)).status).toBe("CONNECT_FAILED");
    expect(await sessRow(c.requestId)).toMatchObject({ id: sessionId, status: "CANCELLED", endReason: "auth_revoked", consumedAt: null });
    expect(await waitMsg(ws, "request.closed")).toMatchObject({ status: "CONNECT_FAILED" });
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.connect_failed" } });
    expect(a.newValue).toMatchObject({ reason: "auth_revoked", sessionId });
    expect(await testDb().auditLog.count({ where: { entityId: sessionId, action: "guest.admitted" } })).toBe(0);
  });

  it("§13.2: caps kabul anındaki değil admit anındaki DB yetkilerinden — file_transfer.use kaldırılınca hello.caps = [remote_control]", async () => {
    const { x, rc, wsTicket } = await acceptedTicket();
    await testDb().userPermission.update({
      where: { userId_permKey: { userId: x.id, permKey: "file_transfer.use" } },
      data: { granted: false },
    });
    const g = await rc.guestWs(wsTicket);
    expect(await waitMsg(g, "hello")).toMatchObject({ role: "guest", guestKind: "AGENT", caps: ["remote_control"], peerPresent: false });
  });

  it("§13.2: uzak kontrol / dosya yetkisi olmayan kabulcüde hello.caps = []", async () => {
    const { rc, wsTicket, sessionId } = await acceptedTicket({ "support_requests.view": true, "support_requests.accept": true });
    const g = await rc.guestWs(wsTicket);
    expect(await waitMsg(g, "hello")).toMatchObject({ sessionId, caps: [] });
    await expect.poll(async () => (await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("ACTIVE");
  });
});

describe("P8b-1 asgari istemci sürümü — 426 CLIENT_OUTDATED (§13.4)", () => {
  const MIN = { MIN_AGENT_VERSION: "1.0.0" };

  it("AC-133 / §13.4: resolve — AGENT sürümsüz (0.0.0) ve 0.9.9 → 426 + minVersion; 1.0.0 → 200; BROWSER sürümden etkilenmez", async () => {
    const { live: l } = await boot({ env: MIN });
    const t = await techSession(l);
    const resolve = (payload: object, headers: Record<string, string> = {}) =>
      l.app.inject({
        method: "POST",
        url: "/api/v1/public/sessions/resolve",
        headers: { "x-forwarded-for": nextIp(), ...headers },
        payload: { token: t.token, ...payload },
      });
    for (const body of [{ clientKind: "AGENT" }, { clientKind: "AGENT", clientVersion: "0.9.9" }]) {
      const r = await resolve(body);
      expect(r.statusCode).toBe(426);
      expect(r.json()).toMatchObject({ error: { code: "CLIENT_OUTDATED", fields: { minVersion: "1.0.0" } } });
    }
    expect((await resolve({ clientKind: "AGENT", clientVersion: "1.0.0" })).statusCode).toBe(200);
    expect((await resolve({ clientKind: "AGENT", clientVersion: "1.10.0" })).statusCode).toBe(200);
    expect((await resolve({ clientKind: "BROWSER" }, { origin: ORIGIN })).statusCode).toBe(200);
  });

  it("§13.4: join — sürüm nonce kaydından; eski sürümlü AGENT nonce'u 426, güncel olan 200", async () => {
    const { live: l } = await boot({ env: MIN });
    const t = await techSession(l);
    const rooms = l.app.requests.d.rooms;
    const join = (clientVersion: string) => {
      const { token } = rooms.nonces.issue({ sessionId: t.sessionId, kind: "AGENT", clientVersion });
      return l.app.inject({
        method: "POST",
        url: "/api/v1/public/sessions/join",
        headers: { "x-forwarded-for": nextIp() },
        payload: { joinNonce: token, customerName: "Ayşe Müşteri", consentAccepted: true, consentTextId: t.consentTextId },
      });
    };
    const old = await join("0.9.0");
    expect(old.statusCode).toBe(426);
    expect(errCode(old)).toBe("CLIENT_OUTDATED");
    expect((await join("1.0.0")).statusCode).toBe(200);
  });

  it("§13.4: /ws/guest — eski sürümlü talep misafirinin ticket'ı 426; /ws/request — eski sürümlü talebin sırrı 426, güncel sürüm bağlanır", async () => {
    const { live: l, rc } = await boot({ env: MIN });
    const t = await createTenant();
    const old = await createRequestRow(t.id); // clientVersion 0.9.0 (MIN öncesi açılmış talep)
    await expect(rc.reqWs(old.secret)).rejects.toThrow("HTTP 426");

    const x = await tech(l.app, t.id);
    const acc = await rc.accept(x.s.headers, old.id);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const ticket = l.app.requests.d.rooms.reissueRequestTicket(sessionId, old.id);
    if (!ticket) throw new Error("ticket yok");
    await expect(rc.guestWs(ticket.wsTicket)).rejects.toThrow("HTTP 426");
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } })).consumedAt).toBeNull();

    const fresh = await createRequestRow(t.id);
    await testDb().supportRequest.update({ where: { id: fresh.id }, data: { clientVersion: "1.2.0" } });
    const ws = await rc.reqWs(fresh.secret);
    await waitMsg(ws, "request.state");
  });
});
