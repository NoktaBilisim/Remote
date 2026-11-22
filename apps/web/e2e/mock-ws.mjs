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
import { createHash, randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import { techsRosterSchema } from "@remote/contracts/ws-multi";
import {
  VOICE_DENY_COOLDOWN_MS,
  VOICE_REQUEST_TIMEOUT_MS,
  VOICE_REQUESTS_PER_SESSION,
  voiceRequestGuestSchema,
  voiceStateSchema,
} from "@remote/contracts/ws-voice";
import { SESSION_COOKIE as SESSION_COOKIE_NAME } from "@remote/contracts/api/auth";
import { panelUpgrade } from "./mock-requests.mjs";
import { p18PanelUpgrade } from "./mock-p18.mjs";
import { p19Upgrade } from "./mock-p19.mjs";
import { byId, tickets, ulid } from "./mock-sessions.mjs";
import { newUploadToken } from "./mock-p28e.mjs";
import { chatAdmit, chatGuest, chatHelloFields, chatLogOf, chatTech, chatTechHello, hasSchat } from "./mock-p22.mjs";
import { fsrvCreate, fsrvDownloadToken, fsrvFiles, fsrvStored, setUploadedHook } from "./mock-p28b.mjs";

const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has("rs.v1") ? "rs.v1" : false) });
const rooms = new Map();
const room = (id) => rooms.get(id) ?? rooms.set(id, { tech: null, guest: null, lobby: new Map(), token: null }).get(id);
const send = (ws, m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const iso = (ms) => new Date(Date.now() + ms).toISOString();
/** P5: sunucuya giden file.meta / quality.summary kaydı (oturum id → [{ from, m }]); test GET /__e2e/ws-log/:id ile okur. */
export const wsLog = new Map();
const LOGGED = new Set([
  "file.meta",
  "quality.summary",
  "control.request",
  "control.release",
  "control.cancel",
  "monitor.request",
  "clip.push",
  "clip.pull",
  "print.request",
  "print.cancel",
  "rec.consent",
  "rec.revoke",
  "rec.error",
  "voice.request",
  "voice.answer",
  "voice.join",
  "voice.end",
]);
const log = (id, from, m) => LOGGED.has(m.t) && (wsLog.get(id) ?? wsLog.set(id, []).get(id)).push({ from, m });

/** P7 test kancası: yetki kaldırıldı → misafire control.revoke + caps.update, teknisyene control.state{VIEW, SYSTEM}. */
/**
 * P28c K2b test kancası (/__e2e/guest-roster/<oturum>): misafire iki teknisyenli `techs.roster` (sahip + katılımcı) gönderir;
 * misafirin `tech.remove{tid}`'i roster'dan düşürür (müşteri "Çıkar", AC-366). Kayıt: oda `removed` listesi.
 */
const GUEST_ROSTER = [
  { tid: "OOOOOOOOOOO", name: "Ayşe Sahip", role: "controller", owner: true, connected: true },
  { tid: "PPPPPPPPPPP", name: "Burak Katılımcı", role: "participant", owner: false, connected: true },
];
export function guestRoster(id) {
  const r = rooms.get(id);
  if (!r?.guest) return false;
  r.guestRoster = GUEST_ROSTER.map((e) => ({ ...e }));
  send(r.guest, { t: "techs.roster", techs: r.guestRoster });
  return true;
}

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
  endVoice(r, "session_ended");
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

function admitted(r, rec, ws, kind = "BROWSER", guestName, features = [], schat = false, voice1 = false) {
  const first = !r.maxEndsAt;
  // P28b (§5.1): tarayıcı misafiri SERVER odasında `fsrv` yeteneklidir (K-P28b-20)
  if (rec.fileMode === "SERVER" && kind === "BROWSER" && !features.includes("fsrv")) features = [...features, "fsrv"];
  // P28a (§4.2): misafirin bildirdiği özellikler teknisyene peer.joined/hello ile; pano anahtarı kapalı başlar
  r.guestFeatures = features;
  r.clipConsent = false;
  r.printPending = null;
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
    // P28b (§5.1): yalnız yetenekli sokete (tarayıcı misafiri her zaman, AGENT rs.cap.fsrv1)
    ...(rec.fileMode && (kind === "BROWSER" || features.includes("fsrv")) ? { fileMode: rec.fileMode } : {}),
  });
  // P28d (K1 active.ts): ses odasında tarayıcı misafire hello'dan hemen sonra roster (teklif `from`'u buna göre), ardından
  // callId'siz `voice.state{idle}`. Misafir hello'sunda `guestVoice` YOK (sözleşme).
  // sunucu hasVoice: BROWSER ya da rs.cap.voice1 — yalnız yetenek, işletim sistemi değil (AC-541). Sahte istemci varsayılanda
  // bildirmez → eski istemci (AC-379); P33 sahte Mac misafiri `rs.cap.voice1` ile açar.
  r.guestVoice = kind === "BROWSER" || voice1;
  if (rec.voice) r.voiceRec = rec;
  if (voiceRoom(r, rec)) {
    send(ws, techsRosterSchema.parse({ t: "techs.roster", techs: [voiceEntry(r)] }));
    send(ws, voiceStateSchema.parse(stateOf(r)));
  }
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
    guestFeatures: features,
    ...(rec.fileMode ? { fileMode: rec.fileMode } : {}),
    guestVoice: r.guestVoice,
    guestChat: schat ? "on" : "outdated",
  });
  // P22 (§4.1): misafir sohbeti yalnız `rs.cap.schat1` sokette; eski istemci → teknisyende `outdated`
  chatAdmit(r, schat);
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    log(rec.view.id, "guest", m);
    if (chatGuest(r, m)) return;
    if (p28Guest(r, m)) return;
    if (voiceGuest(r, m)) return;
    if (recGuest(r, rec, m)) return;
    if (fsrvMsg(r, rec, "guest", m)) return;
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
        p28ControlClosed(r);
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
    endVoice(r, "disconnect"); // V-PD-7: misafir kopması anında biter (bekleme başlatmaz)
    r.guest = null;
    send(r.tech, { t: "peer.left", role: "guest", reason: "disconnect" });
  });
}

/** P28e (§6.2) asgari taklit: rıza → kayıt açılır (teknisyene upload); revoke → (recAck) off{revoked}. */
function recGuest(r, rec, m) {
  if (m.t === "rec.consent") {
    if (!rec.recOffer || r.rec) return true;
    r.rec = { rid: ulid(), series: 0, on: true };
    send(r.guest, { t: "rec.state", on: true });
    send(r.tech, {
      t: "rec.state",
      on: true,
      rid: r.rec.rid,
      basis: "consent",
      upload: { token: newUploadToken(r.rec.rid), series: 0, nextPart: 0 },
    });
    return true;
  }
  if (m.t === "rec.revoke") {
    if (!r.rec?.on || rec.recAck === false) return true;
    recOff(r, "revoked");
    return true;
  }
  return false;
}
function recOff(r, reason) {
  r.rec.on = false;
  send(r.guest, { t: "rec.state", on: false, reason });
  send(r.tech, { t: "rec.state", on: false, reason, rid: r.rec.rid, basis: "consent" });
}
/** Test kancası: teknisyene yeni yükleme belirteci + bölüm (`series`) ya da kayıt durdurma (`off=<neden>`). */
export function recHook(id, q) {
  const r = rooms.get(id);
  if (!r?.rec) return null;
  if (q.get("off")) {
    recOff(r, q.get("off"));
    return { rid: r.rec.rid };
  }
  const series = Number(q.get("series") ?? 1);
  send(r.tech, {
    t: "rec.state",
    on: true,
    rid: r.rec.rid,
    basis: "consent",
    upload: { token: newUploadToken(r.rec.rid), series, nextPart: 0 },
  });
  return { rid: r.rec.rid };
}
export const recRid = (id) => rooms.get(id)?.rec?.rid ?? null;

/*
 * P28d (mimari-p28d r2 §4.2; K1 apps/server/src/signaling/voice.ts) asgari taklit — yalnız `rec.voice` odası (u-p28d*):
 * tek teknisyen (sahip, VOICE_TID) + tarayıcı misafir. Kapı sırası K1 ile aynı: yetki → misafir bağlı (CONFLICT) →
 * hasVoice (CLIENT_UNSUPPORTED) → faz (CONFLICT) → bekleme / 10 istek (RATE_LIMITED). İstekte önce misafire
 * `voice.request`, sonra iki tarafa `voice.state{pending, callId, by, listeners:[by]}`. Bitiş yayını `idle + callId +
 * endReason`; ret / zaman aşımı / customer / device 30 sn bekleme başlatır, kopma başlatmaz. Eşleşmeyen `callId` sessiz düşer.
 * Her çıkış contracts şemasından geçer. 60 sn zaman aşımı gerçek zamanlayıcı; test `/__e2e/voice/<oturum>?timeout` ile
 * sahte saat gibi hemen doldurur.
 */
const VOICE_TID = "OOOOOOOOOOO";
const voiceRoom = (r, rec) => Boolean(rec.voice) && r.guestKind === "BROWSER";
const fromOf = (r, rec) => (voiceRoom(r, rec) ? { from: VOICE_TID } : {});
const voiceEntry = (r) => ({ tid: VOICE_TID, name: "Mehmet Kaya", role: "controller", owner: true, connected: Boolean(r.tech) });
const vstate = (r) =>
  (r.voice ??= { phase: "idle", callId: null, by: null, talkers: new Set(), requests: 0, cooldownUntil: 0, timer: null, sentKey: null });
/** K1 listenersOf: bağlı + `sessions.voice`. */
const listenersOf = (r) => (r.tech && r.voiceRec?.canVoice ? [VOICE_TID] : []);

function stateOf(r) {
  const v = vstate(r);
  if (v.phase === "idle" || !v.callId) return { t: "voice.state", phase: "idle", talkers: [], listeners: [] };
  const listeners = listenersOf(r);
  const talkers = [...v.talkers].filter((t) => listeners.includes(t));
  return { t: "voice.state", phase: v.phase, callId: v.callId, ...(v.by ? { by: v.by } : {}), talkers, listeners };
}
function broadcast(r, msg) {
  const m = voiceStateSchema.parse(msg);
  send(r.tech, m);
  if (r.guestVoice) send(r.guest, m);
}
/** Değişmeyen durum yeniden gitmez (D-PD-2). */
function publish(r) {
  if (!r.voiceRec) return;
  const msg = stateOf(r);
  const key = JSON.stringify(msg);
  if (key === vstate(r).sentKey) return;
  r.voice.sentKey = key;
  broadcast(r, msg);
}
/** TEK bitiş yolu (K1 endVoice): idle'da no-op. */
function endVoice(r, reason) {
  const v = r.voice;
  if (!v || v.phase === "idle") return;
  clearTimeout(v.timer);
  const callId = v.callId;
  Object.assign(v, { phase: "idle", callId: null, by: null, talkers: new Set(), timer: null });
  if (["customer", "device", "timeout"].includes(reason)) v.cooldownUntil = Date.now() + VOICE_DENY_COOLDOWN_MS;
  v.sentKey = JSON.stringify(stateOf(r));
  broadcast(r, { t: "voice.state", phase: "idle", callId, endReason: reason, talkers: [], listeners: [] });
}

function voiceTech(r, rec, ws, m) {
  const v = vstate(r);
  const deny = (code, message) => send(ws, { t: "error", code, message });
  if (m.t === "voice.request") {
    if (!rec.canVoice) return deny("FORBIDDEN", "Sesli görüşme yetkiniz yok.");
    if (!r.guest) return deny("CONFLICT", "Müşteri bağlı değil.");
    if (!r.guestVoice) return deny("CLIENT_UNSUPPORTED", MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED);
    if (v.phase !== "idle") return deny("CONFLICT", "Sürmekte olan bir sesli görüşme var.");
    if (Date.now() < v.cooldownUntil) return deny("RATE_LIMITED", "Sesli görüşme için 30 sn sonra tekrar deneyebilirsiniz.");
    if (v.requests >= VOICE_REQUESTS_PER_SESSION) return deny("RATE_LIMITED", "Bu oturumda sesli görüşme isteği sınırına ulaşıldı.");
    const callId = randomBytes(16).toString("base64url");
    Object.assign(v, { requests: v.requests + 1, phase: "pending", callId, by: VOICE_TID });
    v.timer = setTimeout(() => v.phase === "pending" && v.callId === callId && endVoice(r, "timeout"), VOICE_REQUEST_TIMEOUT_MS);
    send(r.guest, voiceRequestGuestSchema.parse({ t: "voice.request", callId, by: VOICE_TID }));
    return publish(r);
  }
  if (m.t === "voice.join") {
    if (!rec.canVoice) return deny("FORBIDDEN", "Sesli görüşme yetkiniz yok.");
    if (m.callId !== v.callId) return;
    if (v.phase !== "active") return deny("CONFLICT", "Sesli görüşme henüz başlamadı.");
    v.talkers.add(VOICE_TID);
    return publish(r);
  }
  if (m.t === "voice.end") {
    if (m.callId !== v.callId || v.phase === "idle") return;
    if (!v.talkers.has(VOICE_TID)) return deny("FORBIDDEN", "Görüşmede değilsiniz.");
    endVoice(r, "tech");
  }
}

function voiceGuest(r, m) {
  if (m.t !== "voice.answer" && m.t !== "voice.end") return false;
  const v = vstate(r);
  if (!r.guestVoice || m.callId !== v.callId) return true; // bayat / sahte callId sessiz düşer
  if (m.t === "voice.end") {
    if (v.phase === "active") endVoice(r, m.reason);
    return true;
  }
  if (v.phase !== "pending") return true;
  if (!m.accept) return (endVoice(r, "customer"), true);
  clearTimeout(v.timer);
  Object.assign(v, { phase: "active", timer: null });
  if (listenersOf(r).includes(v.by)) v.talkers.add(v.by);
  publish(r);
  if (v.talkers.size === 0) endVoice(r, "left"); // K1 sapma 2: isteyen artık dinleyen değil
  return true;
}

/**
 * Test kancası (/__e2e/voice/<oturum>?…): `timeout` bekleyen isteği 60 sn dolmuş gibi bitirir; `cool` bekleme süresini
 * sıfırlar; `stray` misafire rızasız (isteksiz) `voice.state{active}` gönderir (K-PD-2 negatif). Dönüş: oda ses durumu.
 */
export function voiceHook(id, q) {
  const r = rooms.get(id);
  if (!r?.voiceRec) return null;
  const v = vstate(r);
  if (q.has("timeout") && v.phase === "pending") endVoice(r, "timeout");
  if (q.has("cool")) v.cooldownUntil = 0;
  if (q.has("stray")) {
    const callId = randomBytes(16).toString("base64url");
    const m = { t: "voice.state", phase: "active", callId, by: VOICE_TID, talkers: [VOICE_TID], listeners: [VOICE_TID] };
    send(r.guest, voiceStateSchema.parse(m));
    return { callId };
  }
  return { phase: v.phase, callId: v.callId, requests: v.requests };
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
    ...(rec.fileMode ? { fileMode: rec.fileMode } : {}),
    ...(r.guest
      ? {
          guestKind: r.guestKind,
          ...(r.guestName ? { guestName: r.guestName } : {}),
          guestFeatures: r.guestFeatures ?? [],
          guestVoice: r.guestVoice,
        }
      : {}),
    // P28c-K2 (mock-p28c.mjs): üye/sahip konsolu için tid/techRole/roster
    ...(rec.multiHello ?? {}),
    // P28d: ses odasında sahip kimliği (tid olmadan konsol ses arayüzü gizli)
    ...(rec.voice ? { tid: VOICE_TID, techRole: "owner", roster: [voiceEntry(r)] } : {}),
    ...chatHelloFields(r),
  });
  chatTechHello(r, ws, active);
  if (rec.voice) {
    r.voiceRec = rec;
    send(ws, voiceStateSchema.parse(stateOf(r)));
  }
  for (const [guestId, e] of r.lobby) send(ws, { t: "peer.pending", guestId, name: e.name, guestKind: "BROWSER", since: e.since });
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    log(rec.view.id, "tech", m);
    if (typeof m.t === "string" && m.t.startsWith("voice.")) return voiceTech(r, rec, ws, m);
    if (chatTech(r, ws, m)) return;
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
      admitted(r, rec, hit[1].ws, undefined, undefined, undefined, hit[1].schat);
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
    } else if (m.t === "control.release" || m.t === "control.cancel") {
      techClose(r, m.t);
      p28ControlClosed(r);
    } else if (p28Tech(r, rec, ws, m)) return;
    else if (fsrvMsg(r, rec, "tech", m)) return;
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
    } else if (m.t === "sdp.offer") send(r.guest, { t: m.t, sdp: m.sdp, ...fromOf(r, rec) });
    else if (m.t === "ice")
      send(r.guest, { t: "ice", candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex, ...fromOf(r, rec) });
    else if (m.t === "session.end") {
      if (rec.view.status !== "ACTIVE") return send(ws, { t: "error", code: "CONFLICT", message: "Oturum aktif değil." });
      end(rec, "tech");
    }
  });
  ws.on("close", () => {
    if (r.tech !== ws) return;
    r.tech = null;
    techGone(r);
    // K1 voiceSync: tek teknisyen gitti → dinleyen/konuşan boş; etkin görüşme `left` ile biter (pending sürer)
    if (r.voice?.phase === "active") endVoice(r, "left");
    else publish(r);
  });
}

/*
 * P28a (mimari-p28 §4.3) asgari taklit — K2 sunucusu paralel yazılıyor: kapı (yetki → özellik → GRANTED → anahtar →
 * bekleyen), misafire iletim, rapor → teknisyene clip.status / print.status, kontrol VIEW'da bekleyen yazdırma iptali.
 */
function p28Tech(r, rec, ws, m) {
  if (!["clip.push", "clip.pull", "print.request", "print.cancel"].includes(m.t)) return false;
  const deny = (code, message) => send(ws, { t: "error", code, message });
  if (m.t === "print.cancel") {
    if (r.printPending === m.pid) send(r.guest, { t: "print.cancel", pid: m.pid });
    return true;
  }
  const clip = m.t.startsWith("clip.");
  if (!(clip ? rec.canClip : rec.canPrint)) return (deny("FORBIDDEN", "Yetkiniz yok."), true);
  if (!r.guest) return (deny("CONFLICT", "Müşteri bağlı değil."), true);
  if (!(r.guestFeatures ?? []).includes(clip ? "clipboard" : "print"))
    return (deny("FORBIDDEN", "Müşterinin uygulaması bu özelliği desteklemiyor"), true);
  if (r.ctl?.state !== "GRANTED") return (deny("FORBIDDEN", "Kontrol izni yok"), true);
  if (clip && !r.clipConsent) return (deny("FORBIDDEN", "Müşteri pano iznini açmadı"), true);
  if (clip) send(r.guest, m.t === "clip.push" ? { t: m.t, cid: m.cid, bytes: m.bytes } : { t: m.t, cid: m.cid });
  else {
    if (r.printPending) return (deny("CONFLICT", "Bekleyen yazdırma var."), true);
    r.printPending = m.pid;
    send(r.guest, { t: "print.request", pid: m.pid, sizeBytes: m.sizeBytes });
  }
  return true;
}

function p28Guest(r, m) {
  if (m.t === "tech.remove" && r.guestRoster) {
    r.guestRoster = r.guestRoster.filter((e) => e.tid !== m.tid);
    send(r.guest, { t: "techs.roster", techs: r.guestRoster });
    return true;
  }
  if (m.t === "clip.consent") {
    r.clipConsent = m.on && r.ctl?.state === "GRANTED";
    if (m.on && !r.clipConsent) send(r.guest, { t: "clip.consent", on: false });
    send(r.tech, { t: "clip.consent", on: r.clipConsent });
  } else if (m.t === "clip.report") send(r.tech, { t: "clip.status", cid: m.cid, result: m.result, bytes: m.bytes });
  else if (m.t === "print.report") {
    if (r.printPending !== m.pid) return true;
    r.printPending = null;
    send(r.tech, { t: "print.status", pid: m.pid, result: m.result, ...(m.pages ? { pages: m.pages } : {}) });
  } else return false;
  return true;
}

/** r2 Y-P28a-1: kontrol VIEW'a döndü → pano anahtarı kapanır, bekleyen yazdırma iptal. */
function p28ControlClosed(r) {
  if (r.clipConsent) {
    r.clipConsent = false;
    send(r.guest, { t: "clip.consent", on: false });
    send(r.tech, { t: "clip.consent", on: false });
  }
  if (r.printPending) {
    send(r.guest, { t: "print.cancel", pid: r.printPending });
    send(r.tech, { t: "print.status", pid: r.printPending, result: "CANCELLED" });
    r.printPending = null;
  }
}

/*
 * P28b (mimari-p28b §5.2) asgari taklit: fsrv.init kapısı (MODE, UNSUPPORTED, TOO_LARGE) → fsrv.upload; son parça (mock-p28b
 * PUT) → SCANNING → ad "eicar" içeriyorsa INFECTED, "sifreli" içeriyorsa SCAN_FAILED/ENCRYPTED, aksi CLEAN + alıcıya fsrv.offer.
 * accept → fsrv.download; result{ok} → göndericiye DELIVERED; reject → REJECTED; cancel → CANCELLED.
 */
const fsrvSock = (r, side) => (side === "tech" ? r.tech : r.guest);
const other = (side) => (side === "tech" ? "guest" : "tech");
setUploadedHook((fid) => {
  const f = fsrvFiles.get(fid);
  const r = f && rooms.get(f.sessionId);
  if (!r) return;
  const both = (m) => (send(r.tech, m), send(r.guest, m));
  both({ t: "fsrv.status", fid, state: "SCANNING" });
  setTimeout(() => {
    if (/eicar/i.test(f.name)) return both({ t: "fsrv.status", fid, state: "INFECTED", signature: "Eicar-Test-Signature" });
    if (/sifreli/i.test(f.name)) return both({ t: "fsrv.status", fid, state: "SCAN_FAILED", reason: "ENCRYPTED" });
    f.state = "CLEAN";
    send(fsrvSock(r, f.from), { t: "fsrv.status", fid, state: "CLEAN" });
    send(fsrvSock(r, other(f.from)), {
      t: "fsrv.offer",
      fid,
      name: f.purpose === "PRINT" ? "belge.pdf" : f.name,
      size: f.size,
      sha256: f.sha256,
      purpose: f.purpose,
      ...(f.pid ? { pid: f.pid } : {}),
    });
  }, 300);
});

/** Test kancası: misafirden konsola hazır temiz dosya teklifi (/__e2e/fsrv-offer/<oturum>). */
export function fsrvOfferToTech(id, name, content) {
  const r = rooms.get(id);
  if (!r?.tech) return false;
  const fid = fsrvStored(id, name, content, "guest");
  const f = fsrvFiles.get(fid);
  f.state = "CLEAN";
  f.sha256 = createHash("sha256").update(Buffer.from(content)).digest("hex");
  send(r.tech, { t: "fsrv.offer", fid, name, size: f.size, sha256: f.sha256, purpose: "FILE" });
  return true;
}

function fsrvMsg(r, rec, side, m) {
  if (typeof m.t !== "string" || !m.t.startsWith("fsrv.")) return false;
  r.fsrvLog = [...(r.fsrvLog ?? []), { side, m }];
  const me = fsrvSock(r, side);
  if (m.t === "fsrv.init") {
    const deny = (reason) => send(me, { t: "fsrv.status", xid: m.xid, state: "REJECTED", reason });
    if (rec.fileMode !== "SERVER") return (deny("MODE"), true);
    if (!r.guest || !(r.guestFeatures ?? []).includes("fsrv")) return (deny("UNSUPPORTED"), true);
    if (m.size > (rec.maxFileMb ?? 100) * 1_048_576) return (deny("TOO_LARGE"), true);
    if (/kota/i.test(m.name)) return (deny("QUOTA"), true);
    const { fid, token, chunks } = fsrvCreate(rec.view.id, side, m);
    send(me, { t: "fsrv.upload", xid: m.xid, fid, token, chunkBytes: 1_048_576, chunks });
    return true;
  }
  const f = fsrvFiles.get(m.fid);
  if (!f) return true;
  const sender = fsrvSock(r, f.from);
  if (m.t === "fsrv.accept") {
    const token = fsrvDownloadToken(m.fid);
    send(me, { t: "fsrv.download", fid: m.fid, token, expiresAt: new Date(Date.now() + 300_000).toISOString() });
  } else if (m.t === "fsrv.result") {
    f.result = m.ok;
    if (m.ok) send(sender, { t: "fsrv.status", fid: m.fid, state: "DELIVERED" });
  } else if (m.t === "fsrv.reject") send(sender, { t: "fsrv.status", fid: m.fid, state: "REJECTED" });
  else if (m.t === "fsrv.cancel") send(fsrvSock(r, other(side)), { t: "fsrv.status", fid: m.fid, state: "CANCELLED" });
  return true;
}

/** P22 test kancası: odada saklanan sohbet mesajları (/__e2e/chat-log/<oturum>). */
export const chatLogFor = (id) => chatLogOf(rooms.get(id));

/** Test kancası: oda fsrv mesaj kaydı (/__e2e/fsrv-ws/<oturum>). */
export const fsrvWsLog = (id) => rooms.get(id)?.fsrvLog ?? [];

function onGuestTicket(ws, entry) {
  const r = room(entry.rec.view.id);
  const guestId = ulid();
  const e = { ws, name: entry.name, admitCode: entry.admitCode, since: iso(0), schat: entry.schat };
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
    if (url.pathname === "/ws/request") return void (p19Upgrade(req, sock, head, undefined, url, protos) || sock.destroy());
    if (url.pathname === "/ws/panel") {
      const cookie = String(req.headers.cookie ?? "")
        .split(";")
        .map((p) => p.trim().split("="))
        .find(([k]) => k === SESSION_COOKIE_NAME)?.[1];
      const c = cookie ? decodeURIComponent(cookie) : undefined;
      if (p19Upgrade(req, sock, head, c, url, protos)) return;
      if (p18PanelUpgrade(req, sock, head, c)) return;
      return panelUpgrade(req, sock, head, c);
    }
    if (url.pathname === "/ws/tech") {
      const rec = byId.get(url.searchParams.get("sessionId"));
      if (!rec) return sock.destroy();
      // P22 (r2 §15.2): belirteçsiz konsol soketi 4426 ile kapanır (sayfayı yenileyin). Playwright routeWebSocket alt
      // protokolü iletmeyebilir → boş liste yok sayılır; `rs.v1` var ama `rs.cap.schat1` yoksa eski konsol.
      if (protos.includes("rs.v1") && !hasSchat(protos))
        return wss.handleUpgrade(req, sock, head, (ws) => ws.close(4426, "console_outdated"));
      return wss.handleUpgrade(req, sock, head, (ws) => onTech(ws, rec));
    }
    if (url.pathname !== "/ws/guest" || url.search) return sock.destroy();
    const agentFor = protos.find((p) => p.startsWith("rs.e2eagent."))?.slice(12);
    if (agentFor) {
      const rec = byId.get(agentFor);
      const r = rec && rooms.get(agentFor);
      if (!rec || !r?.tech || r.guest) return sock.destroy();
      Object.assign(rec.view, { status: "ACTIVE", code: null });
      const features = [
        ...(protos.includes("rs.cap.clip1") ? ["clipboard"] : []),
        ...(protos.includes("rs.cap.print1") ? ["print"] : []),
        ...(protos.includes("rs.cap.fsrv1") ? ["fsrv"] : []),
      ];
      const voice1 = protos.includes("rs.cap.voice1");
      return wss.handleUpgrade(req, sock, head, (ws) => admitted(r, rec, ws, "AGENT", "Ayşe Yılmaz", features, hasSchat(protos), voice1));
    }
    const tk = protos.find((p) => p.startsWith("rs.ticket."))?.slice(10);
    const rc = protos.find((p) => p.startsWith("rs.reconnect."))?.slice(13);
    const entry = tk && tickets.get(tk);
    if (entry) {
      tickets.delete(tk);
      return wss.handleUpgrade(req, sock, head, (ws) => onGuestTicket(ws, { ...entry, schat: hasSchat(protos) }));
    }
    const hit = rc && [...rooms.entries()].find(([, r]) => r.token === rc && !r.guest);
    if (!hit) return sock.destroy();
    wss.handleUpgrade(req, sock, head, (ws) => admitted(hit[1], byId.get(hit[0]), ws, undefined, undefined, undefined, hasSchat(protos)));
  });
}
