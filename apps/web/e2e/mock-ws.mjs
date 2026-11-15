// E2E sahte WS sinyalizasyonu (yalnız test). docs/mimari-protokol.md §3 akışının asgari taklidi:
// /ws/tech (çerez yok sayılır), /ws/guest (rs.ticket.* / rs.reconnect.*), lobi, admit, relay, bitiş.
// P7: sahte Hızlı Destek istemcisi `rs.e2eagent.<sessionId>` alt protokolüyle doğrudan AGENT olarak kabul edilir
// (lobi/admit kodu yok — yalnız konsol kontrol akışı testi); control.* / monitor.request / env.state aktarımı ve
// sunucu kuralları (FORBIDDEN, ret sonrası 30 sn, ≤5 istek) asgari taklit.
// P7 düzeltme 1 (§3.3 K1–K4): oda kontrol durumu VIEW/REQUESTED/GRANTED; control.release/cancel → misafire aynı mesaj
// + teknisyene {VIEW, TECH}; GRANTED yalnız REQUESTED'da iletilir (VIEW'da misafire control.revoke{stale});
// monitor.denied aktarımı; teknisyen kopması/değişimi → misafire control.revoke{reconnect}.
// P7 düzeltme 2: K6 (REQUESTED'de VIEW UI|HOTKEY|SYSTEM → VIEW + teknisyene iletim), monitör kuralları (bekleyen varken
// CONFLICT, ret sonrası 30 sn RATE_LIMITED, zaten paylaşılan → VALIDATION — S7-15), env.state.selfElevated (K8).
// TEST-P7-3 (sunucuyla hizalama): teknisyen hello'su misafir varken guestKind/guestName taşır (active.ts sendHelloTech);
// yanıtsız monitör isteği 30 sn sonra düşer, bekleme `at + 30 sn`den başlar (control.ts). Test zamanı `ageRoom` ile ilerletir.
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { SESSION_COOKIE as SESSION_COOKIE_NAME } from "@remote/contracts/api/auth";
import { panelUpgrade } from "./mock-requests.mjs";
import { p18PanelUpgrade } from "./mock-p18.mjs";
import { byId, tickets, ulid } from "./mock-sessions.mjs";

const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has("rs.v1") ? "rs.v1" : false) });
const rooms = new Map();
const room = (id) => rooms.get(id) ?? rooms.set(id, { tech: null, guest: null, lobby: new Map(), token: null }).get(id);
const send = (ws, m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const iso = (ms) => new Date(Date.now() + ms).toISOString();
/** P5: sunucuya giden file.meta / quality.summary kaydı (oturum id → [{ from, m }]); test GET /__e2e/ws-log/:id ile okur. */
export const wsLog = new Map();
const LOGGED = new Set(["file.meta", "quality.summary", "control.request", "control.release", "control.cancel", "monitor.request"]);
const log = (id, from, m) => LOGGED.has(m.t) && (wsLog.get(id) ?? wsLog.set(id, []).get(id)).push({ from, m });

/** P7 test kancası: yetki kaldırıldı → misafire control.revoke + caps.update, teknisyene control.state{VIEW, SYSTEM}. */
export function revokeControl(id) {
  const r = rooms.get(id);
  if (!r) return false;
  if (r.ctl) r.ctl.state = "VIEW";
  send(r.guest, { t: "control.revoke", reason: "permission" });
  send(r.guest, { t: "caps.update", caps: [] });
  send(r.tech, { t: "control.state", state: "VIEW", source: "SYSTEM" });
  return true;
}

/** TEST-P7-3 kancası: odanın kontrol/monitör zaman damgalarını `ms` kadar geçmişe çeker (30 sn'lik kuralları beklemeden sınamak için). */
export function ageRoom(id, ms) {
  const c = rooms.get(id)?.ctl;
  if (!c) return false;
  if (c.monPending) c.monPending.at -= ms;
  if (c.monDeniedAt) c.monDeniedAt -= ms;
  if (c.deniedAt) c.deniedAt -= ms;
  return true;
}

/** P7 test kancası (S7-2): sunucu kuralını atlayan "istenmemiş" izin — konsolun kendi savunmasını sınar. */
export function strayGrant(id) {
  const r = rooms.get(id);
  if (!r?.tech) return false;
  send(r.tech, { t: "control.state", state: "GRANTED", source: "UI" });
  return true;
}

/** §3.3 K1/K2: bırakma (GRANTED) ve iptal (REQUESTED) aynı kapanışa varır; VIEW'da yok sayılır. */
function techClose(r, kind) {
  const c = r.ctl;
  if (!c || c.state === "VIEW") return;
  const wire = c.state === "GRANTED" ? "control.release" : kind;
  c.state = "VIEW";
  send(r.guest, { t: wire });
  send(r.tech, { t: "control.state", state: "VIEW", source: "TECH" });
}

/** K3: teknisyen gitti / değişti → misafir kapısı kapansın (ADMITTED misafir bağlıysa). */
function techGone(r) {
  if (r.ctl) r.ctl.state = "VIEW";
  if (r.guest) send(r.guest, { t: "control.revoke", reason: "reconnect" });
}

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
  Object.assign(rec.view, {
    status: "ENDED",
    code: null,
    endedAt: iso(0),
    endedBy: reason === "tech" ? "TECH" : "CUSTOMER",
    endReason: reason,
  });
  endRoom(rec.view.id, reason);
}

function admitted(r, rec, ws, kind = "BROWSER", guestName) {
  const first = !r.maxEndsAt;
  r.guestKind = kind;
  r.guestName = guestName ?? null;
  r.ctl = { forwarded: 0, deniedAt: 0, monitors: 0, state: "VIEW", monPending: null, monDeniedAt: 0, active: null };
  r.maxEndsAt ??= iso(8 * 3600_000);
  r.guest = ws;
  r.token = randomBytes(32).toString("base64url");
  send(ws, {
    t: "hello",
    role: "guest",
    sessionId: rec.view.id,
    peerPresent: Boolean(r.tech),
    iceServers: [],
    maxEndsAt: r.maxEndsAt,
    reconnectToken: r.token,
    caps: rec.caps,
    maxFileMb: rec.maxFileMb,
  });
  // Gerçek sunucu sırası (active.ts scheduleActive): admit'te teknisyene ice.servers, peer.joined'dan ÖNCE.
  // Teknisyen ilk teklifi admit sonrası ICE listesi gelene kadar erteler (tech-machine iceGate); yeniden
  // bağlanmada (first=false) sunucu ice.servers göndermez, kapı aynı WS'te zaten açıktır.
  if (first) send(r.tech, { t: "ice.servers", iceServers: [] });
  send(r.tech, {
    t: "peer.joined",
    role: "guest",
    guestKind: kind,
    ...(guestName ? { guestName } : {}),
    ...(first ? { maxEndsAt: r.maxEndsAt } : {}),
    maxFileMb: rec.maxFileMb,
  });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    log(rec.view.id, "guest", m);
    if (m.t === "sdp.answer") send(r.tech, { t: m.t, sdp: m.sdp });
    else if (m.t === "ice") send(r.tech, { t: "ice", candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex });
    else if (m.t === "share.state") {
      if (m.activeMonitor !== undefined) {
        r.ctl.active = m.activeMonitor;
        if (r.ctl.monPending?.id === m.activeMonitor) r.ctl.monPending = null;
      }
      send(r.tech, {
        t: "share.state",
        state: m.state,
        ...(m.monitors ? { monitors: m.monitors } : {}),
        ...(m.activeMonitor !== undefined ? { activeMonitor: m.activeMonitor } : {}),
        // P15 (AC-234): neden/yöntem sunucu gibi aynen iletilir
        ...(m.reason !== undefined ? { reason: m.reason } : {}),
        ...(m.method !== undefined ? { method: m.method } : {}),
      });
    } else if (m.t === "control.state") {
      if (m.state === "GRANTED") {
        // K2: GRANTED yalnız bekleyen istekte işlenir; VIEW'da misafire stale, GRANTED'de yok say
        if (r.ctl.state !== "REQUESTED") return r.ctl.state === "VIEW" && send(ws, { t: "control.revoke", reason: "stale" });
        r.ctl.state = "GRANTED";
      } else {
        if (m.source === "DENIED") {
          if (r.ctl.state !== "REQUESTED") return;
          r.ctl.deniedAt = Date.now();
        } else if (r.ctl.state === "VIEW") return; // K6: REQUESTED'de UI|HOTKEY|SYSTEM = istek kapandı (ret değil)
        r.ctl.state = "VIEW";
      }
      send(r.tech, { t: "control.state", state: m.state, source: m.source });
    } else if (m.t === "monitor.denied") {
      if (r.ctl.monPending?.id !== m.monitorId) return;
      r.ctl.monPending = null;
      r.ctl.monDeniedAt = Date.now();
      send(r.tech, { t: "monitor.denied", monitorId: m.monitorId });
    } else if (m.t === "env.state")
      send(r.tech, {
        t: "env.state",
        elevatedForeground: m.elevatedForeground,
        secureDesktop: m.secureDesktop,
        selfElevated: m.selfElevated,
      });
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
  if (r.tech) {
    techGone(r);
    r.tech.close(4409);
  }
  r.tech = ws;
  const active = rec.view.status === "ACTIVE";
  send(ws, {
    t: "hello",
    role: "tech",
    sessionId: rec.view.id,
    peerPresent: Boolean(r.guest),
    iceServers: [],
    maxEndsAt: active ? iso(8 * 3600_000) : null,
    ...(active ? { maxFileMb: rec.maxFileMb } : {}),
    ...(r.guest ? { guestKind: r.guestKind, ...(r.guestName ? { guestName: r.guestName } : {}) } : {}),
  });
  for (const [guestId, e] of r.lobby) send(ws, { t: "peer.pending", guestId, name: e.name, guestKind: "BROWSER", since: e.since });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    log(rec.view.id, "tech", m);
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
    } else if (m.t === "guest.reject") {
      const e = r.lobby.get(m.guestId);
      if (!e) return;
      r.lobby.delete(m.guestId);
      send(e.ws, { t: "session.ended", reason: "rejected" });
      e.ws.close(1000);
      send(ws, { t: "peer.pending.left", guestId: m.guestId, reason: "rejected" });
    } else if (m.t === "control.request") {
      if (!rec.canControl || r.guestKind !== "AGENT")
        return send(ws, { t: "error", code: "FORBIDDEN", message: "Uzaktan kontrol yetkiniz yok." });
      if (r.ctl.forwarded >= 5 || Date.now() - r.ctl.deniedAt < 30_000)
        return send(ws, { t: "error", code: "RATE_LIMITED", message: "Çok sık istek." });
      if (r.ctl.state !== "VIEW") return send(ws, { t: "error", code: "CONFLICT", message: "Bekleyen istek var." });
      r.ctl.forwarded++;
      r.ctl.state = "REQUESTED";
      send(r.guest, { t: "control.request" });
    } else if (m.t === "control.release" || m.t === "control.cancel") techClose(r, m.t);
    else if (m.t === "monitor.request") {
      if (r.guestKind !== "AGENT") return send(ws, { t: "error", code: "FORBIDDEN", message: "Yalnız istemci." });
      if (r.ctl.active === m.monitorId) return send(ws, { t: "error", code: "VALIDATION", message: "Bu monitör zaten paylaşılıyor." });
      // Gerçek sunucu gibi: 30 sn yanıtsız bekleyen düşer, ret beklemesi `at + 30 sn`de başlar
      const now = Date.now();
      if (r.ctl.monPending && now - r.ctl.monPending.at >= 30_000) {
        r.ctl.monDeniedAt = r.ctl.monPending.at + 30_000;
        r.ctl.monPending = null;
      }
      if (r.ctl.monPending !== null)
        return send(ws, { t: "error", code: "CONFLICT", message: "Önceki monitör isteği müşteride bekliyor." });
      if (Date.now() - r.ctl.monDeniedAt < 30_000) return send(ws, { t: "error", code: "RATE_LIMITED", message: "Çok sık istek." });
      r.ctl.monPending = { id: m.monitorId, at: now };
      send(r.guest, { t: "monitor.request", monitorId: m.monitorId });
    } else if (m.t === "sdp.offer") send(r.guest, { t: m.t, sdp: m.sdp });
    else if (m.t === "ice") send(r.guest, { t: "ice", candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex });
    else if (m.t === "session.end") {
      if (rec.view.status !== "ACTIVE") return send(ws, { t: "error", code: "CONFLICT", message: "Oturum aktif değil." });
      end(rec, "tech");
    }
  });
  ws.on("close", () => {
    if (r.tech !== ws) return;
    r.tech = null;
    techGone(r);
  });
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
    const protos = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((s) => s.trim());
    if (url.pathname === "/ws/panel") {
      const cookie = String(req.headers.cookie ?? "")
        .split(";")
        .map((p) => p.trim().split("="))
        .find(([k]) => k === SESSION_COOKIE_NAME)?.[1];
      const c = cookie ? decodeURIComponent(cookie) : undefined;
      if (p18PanelUpgrade(req, sock, head, c)) return;
      return panelUpgrade(req, sock, head, c);
    }
    if (url.pathname === "/ws/tech") {
      const rec = byId.get(url.searchParams.get("sessionId"));
      if (!rec) return sock.destroy();
      return wss.handleUpgrade(req, sock, head, (ws) => onTech(ws, rec));
    }
    if (url.pathname !== "/ws/guest" || url.search) return sock.destroy();
    const agentFor = protos.find((p) => p.startsWith("rs.e2eagent."))?.slice(12);
    if (agentFor) {
      const rec = byId.get(agentFor);
      const r = rec && rooms.get(agentFor);
      if (!rec || !r?.tech || r.guest) return sock.destroy();
      Object.assign(rec.view, { status: "ACTIVE", code: null });
      return wss.handleUpgrade(req, sock, head, (ws) => admitted(r, rec, ws, "AGENT", "Ayşe Yılmaz"));
    }
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
