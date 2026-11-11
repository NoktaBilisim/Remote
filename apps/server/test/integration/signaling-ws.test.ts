// P3 uçtan uca WS testleri (gerçek sunucu + iki sahte istemci). AC-14..20, 112; mimari-protokol §1–3.
import { WS_MAX_PAYLOAD } from "@remote/contracts/ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN } from "../helpers/app.ts";
import { admitted, joinGuest, startLive, techSession, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders } from "../helpers/ws.ts";

let live: Live;
beforeEach(async () => {
  live = await startLive();
});
afterEach(async () => live.close());

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";

describe("P3 sinyalizasyon — iki istemci", () => {
  it("AC-20: offer/answer/ICE yalnız aynı odanın karşı tarafına, alanlar yeniden kurularak aktarılır", async () => {
    const t = await techSession(live);
    const { guest, hello } = await admitted(live, t);
    expect(hello).toMatchObject({ role: "guest", sessionId: t.sessionId, peerPresent: true, guestKind: "BROWSER", caps: ["remote_control", "file_transfer"] });
    t.ws.send({ t: "sdp.offer", id: "1", sdp: OFFER });
    expect(await guest.waitFor("sdp.offer")).toEqual({ t: "sdp.offer", sdp: OFFER });
    guest.send({ t: "sdp.answer", sdp: "answer-sdp" });
    expect(await t.ws.waitFor("sdp.answer")).toEqual({ t: "sdp.answer", sdp: "answer-sdp" });
    t.ws.send({ t: "ice", candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 });
    expect(await guest.waitFor("ice")).toEqual({ t: "ice", candidate: "candidate:1 1 udp 1 10.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 });
    guest.send({ t: "ice", candidate: "c2" });
    expect(await t.ws.waitFor("ice")).toEqual({ t: "ice", candidate: "c2" });
    guest.send({ t: "share.state", state: "sharing" });
    expect(await t.ws.waitFor("share.state")).toEqual({ t: "share.state", state: "sharing" });
  });

  it("AC-20: çapraz oturum sızıntısı yok (iki eşzamanlı oda)", async () => {
    const a = await techSession(live);
    const b = await techSession(live);
    const ga = await admitted(live, a);
    const gb = await admitted(live, b);
    a.ws.send({ t: "sdp.offer", sdp: "A-offer" });
    b.ws.send({ t: "sdp.offer", sdp: "B-offer" });
    expect((await ga.guest.waitFor("sdp.offer")).sdp).toBe("A-offer");
    expect((await gb.guest.waitFor("sdp.offer")).sdp).toBe("B-offer");
    await new Promise((r) => setTimeout(r, 100));
    expect(ga.guest.msgs.filter((m) => m.t === "sdp.offer")).toHaveLength(0);
    expect(gb.guest.msgs.filter((m) => m.t === "sdp.offer")).toHaveLength(0);
  });

  it("AC-112: join yanıtında iceServers/reconnectToken yok; lobideki misafirin SDP'si 1008 ile kapanır", async () => {
    const t = await techSession(live);
    const g = await joinGuest(live, t);
    expect(g.admitCode).toMatch(/^\d{4}$/);
    g.ws.send({ t: "sdp.answer", sdp: "x" });
    expect((await g.ws.closed).code).toBe(1008);
    expect((await t.ws.waitFor("peer.pending.left")).reason).toBe("left");
  });

  it("AC-17/18: geçersiz JSON, ekstra alan, 50/sn aşımı → 1008; 64 KB (WS_MAX_PAYLOAD) aşımı → 1009 (S-P3-1)", async () => {
    const t = await techSession(live);
    const cases: [(s: (x: string) => void) => void, number][] = [
      [(s) => s("{bozuk"), 1008],
      [(s) => s(JSON.stringify({ t: "sdp.answer", sdp: "x", extra: 1 })), 1008],
      [(s) => s(JSON.stringify({ t: "ice", candidate: "a".repeat(WS_MAX_PAYLOAD) })), 1009],
      [(s) => { for (let i = 0; i < 80; i++) s(JSON.stringify({ t: "ice", candidate: "c" })); }, 1008],
    ];
    for (const [c, code] of cases) {
      const { guest } = await admitted(live, t);
      c((x) => guest.ws.send(x));
      expect((await guest.closed).code).toBe(code);
      await t.ws.waitFor("peer.left");
      t.ws.send({ t: "session.end" });
      await t.ws.waitFor("session.ended");
      Object.assign(t, await techSession(live));
    }
  });
});

describe("P3 upgrade doğrulaması (G-10, AC-14, AC-15, ADR-0012)", () => {
  it("AC-14: sorgu dizesi, rs.v1 eksik, tekrar kullanılan ticket ve izinsiz Origin → 403", async () => {
    const t = await techSession(live);
    const headers = { origin: ORIGIN };
    const r = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers, payload: { token: t.token, clientKind: "BROWSER" } });
    const j = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/join", headers, payload: { joinNonce: r.json<{ joinNonce: string }>().joinNonce, customerName: "Ali", consentAccepted: true, consentTextId: t.consentTextId } });
    const ticket = `rs.ticket.${j.json<{ wsTicket: string }>().wsTicket}`;
    await expect(connect(`${live.base}/ws/guest?ticket=x`, ["rs.v1", ticket], headers)).rejects.toThrow("HTTP 403");
    await expect(connect(`${live.base}/ws/guest`, [ticket], headers)).rejects.toThrow("HTTP 403");
    await expect(connect(`${live.base}/ws/guest`, ["rs.v1", ticket], { origin: "https://evil.test" })).rejects.toThrow("HTTP 403");
    await expect(connect(`${live.base}/ws/guest`, ["rs.v1", ticket], headers)).rejects.toThrow("HTTP 403"); // tek kullanımlık
    const again = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/join", headers, payload: { joinNonce: r.json<{ joinNonce: string }>().joinNonce, customerName: "Ali", consentAccepted: true, consentTextId: t.consentTextId } });
    expect(again.json<{ error: { code: string } }>().error.code).toBe("NONCE_INVALID");
  });

  it("AC-15: teknisyen soketi yalnız oturum sahibine; yanlış Origin/çerezsiz 403", async () => {
    const t = await techSession(live);
    const other = await techSession(live, t.tenantId);
    const url = `${live.base}/ws/tech?sessionId=${t.sessionId}`;
    await expect(connect(url, ["rs.v1"], techHeaders(other.techAuth.token, ORIGIN))).rejects.toThrow("HTTP 403");
    await expect(connect(url, ["rs.v1"], techHeaders(t.techAuth.token, "https://evil.test"))).rejects.toThrow("HTTP 403");
    await expect(connect(url, ["rs.v1"], { origin: ORIGIN })).rejects.toThrow("HTTP 403");
  });

  it("ADR-0012: AGENT Origin'siz resolve/join/WS geçer; Origin'li AGENT, Origin'siz BROWSER, Sec-Fetch'li AGENT 403", async () => {
    const t = await techSession(live);
    const resolve = (headers: Record<string, string>, clientKind: string) =>
      live.app.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers, payload: { code: t.code, clientKind } });
    expect((await resolve({ origin: ORIGIN }, "AGENT")).statusCode).toBe(403);
    expect((await resolve({}, "BROWSER")).statusCode).toBe(403);
    expect((await resolve({ "sec-fetch-site": "cross-site" }, "AGENT")).statusCode).toBe(403);
    const ok = await resolve({}, "AGENT");
    expect(ok.statusCode).toBe(200);
    const nonce = ok.json<{ joinNonce: string }>().joinNonce;
    const join = (headers: Record<string, string>) => live.app.inject({ method: "POST", url: "/api/v1/public/sessions/join", headers, payload: { joinNonce: nonce, customerName: "Ali", consentAccepted: true, consentTextId: t.consentTextId } });
    expect((await join({ origin: ORIGIN })).statusCode).toBe(403); // nonce kind=AGENT; Origin'li istek reddedilir (nonce da yanar)
    const ok2 = await resolve({}, "AGENT");
    const j = await live.app.inject({ method: "POST", url: "/api/v1/public/sessions/join", payload: { joinNonce: ok2.json<{ joinNonce: string }>().joinNonce, customerName: "Ali", consentAccepted: true, consentTextId: t.consentTextId } });
    expect(j.statusCode).toBe(200);
    const ws = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${j.json<{ wsTicket: string }>().wsTicket}`]);
    expect((await ws.waitFor("lobby.wait")).t).toBe("lobby.wait");
    expect((await t.ws.waitFor("peer.pending")).guestKind).toBe("AGENT");
  });
});
