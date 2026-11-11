// E2E sahte WS sinyalizasyonu (yalnız test). docs/mimari-protokol.md §3 akışının asgari taklidi:
// /ws/tech (çerez yok sayılır), /ws/guest (rs.ticket.* / rs.reconnect.*), lobi, admit, relay, bitiş.
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { byId, tickets, ulid } from "./mock-sessions.mjs";

const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has("rs.v1") ? "rs.v1" : false) });
const rooms = new Map();
const room = (id) => rooms.get(id) ?? rooms.set(id, { tech: null, guest: null, lobby: new Map(), token: null }).get(id);
const send = (ws, m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const iso = (ms) => new Date(Date.now() + ms).toISOString();

export function endRoom(id, reason) {
  const r = rooms.get(id);
  if (!r) return;
  for (const ws of [r.tech, r.guest, ...[...r.lobby.values()].map((e) => e.ws)]) {
    send(ws, { t: "session.ended", reason });
    ws?.close(1000);
  }
  rooms.delete(id);
}

function end(rec, reason) {
  Object.assign(rec.view, { status: "ENDED", code: null, endedAt: iso(0), endedBy: reason === "tech" ? "TECH" : "CUSTOMER", endReason: reason });
  endRoom(rec.view.id, reason);
}

function admitted(r, rec, ws) {
  const first = !r.maxEndsAt;
  r.maxEndsAt ??= iso(8 * 3600_000);
  r.guest = ws;
  r.token = randomBytes(32).toString("base64url");
  send(ws, { t: "hello", role: "guest", sessionId: rec.view.id, peerPresent: Boolean(r.tech), iceServers: [], maxEndsAt: r.maxEndsAt, reconnectToken: r.token });
  send(r.tech, { t: "peer.joined", role: "guest", guestKind: "BROWSER", ...(first ? { maxEndsAt: r.maxEndsAt } : {}) });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === "sdp.answer") send(r.tech, { t: m.t, sdp: m.sdp });
    else if (m.t === "ice") send(r.tech, { t: "ice", candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex });
    else if (m.t === "share.state") send(r.tech, { t: "share.state", state: m.state });
    else if (m.t === "session.end") end(rec, "customer");
  });
  ws.on("close", () => {
    if (r.guest !== ws) return;
    r.guest = null;
    send(r.tech, { t: "peer.left", role: "guest", reason: "disconnect" });
  });
}

function onTech(ws, rec) {
  const r = room(rec.view.id);
  if (r.tech) r.tech.close(4409);
  r.tech = ws;
  const active = rec.view.status === "ACTIVE";
  send(ws, { t: "hello", role: "tech", sessionId: rec.view.id, peerPresent: Boolean(r.guest), iceServers: [], maxEndsAt: active ? iso(8 * 3600_000) : null });
  for (const [guestId, e] of r.lobby) send(ws, { t: "peer.pending", guestId, name: e.name, guestKind: "BROWSER", since: e.since });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === "guest.admit") {
      const hit = [...r.lobby.entries()].find(([, e]) => e.admitCode === m.admitCode);
      if (!hit) return send(ws, { t: "error", code: "ADMIT_CODE_INVALID", message: "Kod eşleşmedi." });
      Object.assign(rec.view, { status: "ACTIVE", code: null });
      for (const [id, e] of r.lobby) {
        if (id === hit[0]) continue;
        send(e.ws, { t: "session.ended", reason: "rejected" });
        e.ws.close(1000);
      }
      r.lobby.clear();
      admitted(r, rec, hit[1].ws);
      send(ws, { t: "ice.servers", iceServers: [] });
    } else if (m.t === "guest.reject") {
      const e = r.lobby.get(m.guestId);
      if (!e) return;
      r.lobby.delete(m.guestId);
      send(e.ws, { t: "session.ended", reason: "rejected" });
      e.ws.close(1000);
      send(ws, { t: "peer.pending.left", guestId: m.guestId, reason: "rejected" });
    } else if (m.t === "sdp.offer") send(r.guest, { t: m.t, sdp: m.sdp });
    else if (m.t === "ice") send(r.guest, { t: "ice", candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex });
    else if (m.t === "session.end") {
      if (rec.view.status !== "ACTIVE") return send(ws, { t: "error", code: "CONFLICT", message: "Oturum aktif değil." });
      end(rec, "tech");
    }
  });
  ws.on("close", () => r.tech === ws && (r.tech = null));
}

function onGuestTicket(ws, entry) {
  const r = room(entry.rec.view.id);
  const guestId = ulid();
  const e = { ws, name: entry.name, admitCode: entry.admitCode, since: iso(0) };
  r.lobby.set(guestId, e);
  send(ws, { t: "lobby.wait", expiresAt: iso(5 * 60_000) });
  send(r.tech, { t: "peer.pending", guestId, name: e.name, guestKind: "BROWSER", since: e.since });
  const onLobbyMsg = (raw) => {
    if (!r.lobby.has(guestId)) return;
    if (JSON.parse(String(raw)).t !== "session.end") return;
    r.lobby.delete(guestId);
    ws.close(1000);
  };
  ws.on("message", onLobbyMsg);
  ws.on("close", () => {
    if (r.lobby.delete(guestId)) send(r.tech, { t: "peer.pending.left", guestId, reason: "left" });
  });
}

export function attachWs(srv) {
  srv.on("upgrade", (req, sock, head) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const protos = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
    if (url.pathname === "/ws/tech") {
      const rec = byId.get(url.searchParams.get("sessionId"));
      if (!rec) return sock.destroy();
      return wss.handleUpgrade(req, sock, head, (ws) => onTech(ws, rec));
    }
    if (url.pathname !== "/ws/guest" || url.search) return sock.destroy();
    const tk = protos.find((p) => p.startsWith("rs.ticket."))?.slice(10);
    const rc = protos.find((p) => p.startsWith("rs.reconnect."))?.slice(13);
    const entry = tk && tickets.get(tk);
    if (entry) {
      tickets.delete(tk);
      return wss.handleUpgrade(req, sock, head, (ws) => onGuestTicket(ws, entry));
    }
    const hit = rc && [...rooms.entries()].find(([, r]) => r.token === rc && !r.guest);
    if (!hit) return sock.destroy();
    wss.handleUpgrade(req, sock, head, (ws) => admitted(hit[1], byId.get(hit[0]), ws));
  });
}
