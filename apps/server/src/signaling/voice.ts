// P28d sesli görüşme sunucu durum makinesi (mimari-p28d r2 §3, §4.2, §6; ADR-0036; AC-373..379). Medya yok, yalnız sinyal.
// Oda başına tek görüşme: idle → pending (60 sn) → active → idle. `callId` sunucu üretir (Y-PD-1); eşleşmeyen mesaj sessiz düşer.
// Tek bitiş yolu `endVoice`; tüm oda olayları (teknisyen/misafir bağlanma-kopma, üye ayrılma, yetki, devir) `voiceSync` çağırır:
// dinleyenler yeniden hesaplanır, konuşanlar dinleyenlerle kesişir (`talkers ⊆ listeners`), konuşan kalmazsa `left`, misafir sesi
// artık desteklemiyorsa (koptu / değişti / gözetimsiz) `disconnect`. Ses içeriği ve aygıt adı hiçbir yere yazılmaz (T6).
import { randomBytes } from "node:crypto";
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import { VOICE_AUDIT, type VoiceAuditAction, type VoiceRejectReason } from "@remote/contracts/audit";
import type { PermissionKey } from "@remote/contracts/permissions";
import {
  VOICE_DENY_COOLDOWN_MS,
  VOICE_REQUEST_TIMEOUT_MS,
  VOICE_REQUESTS_PER_SESSION,
  type VoiceEndReason,
  type VoiceGuestEndReason,
  type VoiceStateMessage,
} from "@remote/contracts/ws-voice";
import type { AuditContext } from "../audit/service.ts";
import type { JsonObject } from "../audit/mask.ts";
import { techActor } from "./control-record.ts";
import { ensureGuestKnows, techConns, tidOf } from "./members.ts";
import { auditMulti, CUSTOMER_ACTOR, MULTI_SYSTEM_CTX, SYSTEM_ACTOR, type MultiActor } from "./multi-audit.ts";
import { hasVoice } from "./rooms-features.ts";
import type { Rooms } from "./rooms.ts";
import type { Guest, Room, TechConn, VoiceRoom } from "./types.ts";

const PERM: PermissionKey = "sessions.voice";
/** Ret / zaman aşımı / müşteri ya da aygıt bitişinden sonra 30 sn bekleme (AC-116 / G-03, D-PD-2). */
const COOLDOWN: ReadonlySet<VoiceEndReason> = new Set(["customer", "device", "timeout"]);

interface Who {
  actor: MultiActor;
  ctx: AuditContext;
}
const SYSTEM: Who = { actor: SYSTEM_ACTOR, ctx: MULTI_SYSTEM_CTX };
const techWho = (c: TechConn): Who => ({ actor: techActor(c), ctx: c.ctx });
const guestWho = (g: Guest): Who => ({ actor: CUSTOMER_ACTOR, ctx: g.ctx ?? MULTI_SYSTEM_CTX });

export function newVoice(): VoiceRoom {
  return {
    phase: "idle",
    callId: null,
    by: null,
    startedAt: null,
    talkers: new Set(),
    talkerIds: new Set(),
    listenerIds: new Set(),
    cooldownUntil: 0,
    requests: 0,
    sentKey: "",
    guestVoice: false,
  };
}

/** Teknisyen `hello.guestVoice`: bağlı misafirde `hasVoice`, kısa kopuklukta son değer; gözetimsiz odada her zaman false. */
export const guestVoiceOf = (room: Room): boolean =>
  !room.unattended && (room.admitted?.peer ? hasVoice(room, room.admitted.peer) : room.voice.guestVoice);

/** V-PD-3 (Y-PD-3): odada bağlı, rolü olan (sahip / katılmış üye) ve `sessions.voice` yetkili teknisyenler. Sıra: sahip, üyeler. */
export function listenersOf(room: Room): { tid: string; userId: string }[] {
  const out: { tid: string; userId: string }[] = [];
  const add = (c: TechConn | undefined): void => {
    if (c?.permissions.has(PERM)) out.push({ tid: tidOf(room, c.userId), userId: c.userId });
  };
  add(room.tech);
  for (const m of room.multi.members.values()) if (m.joinedAudited) add(m.conn);
  return out;
}

/** Tek `voice.state` kurucusu: konuşanlar her zaman dinleyenlerle kesişir (şema refine'ı; Go misafir ihlalde soketi kapatır). */
function stateOf(room: Room): VoiceStateMessage {
  const v = room.voice;
  if (v.phase === "idle" || v.callId === null) return { t: "voice.state", phase: "idle", talkers: [], listeners: [] };
  const listeners = listenersOf(room).map((l) => l.tid);
  return {
    t: "voice.state",
    phase: v.phase,
    callId: v.callId,
    ...(v.by !== null ? { by: v.by } : {}),
    talkers: [...v.talkers].filter((t) => listeners.includes(t)),
    listeners,
  };
}

/** Tüm teknisyenler + ses destekli misafir (eski Go misafire hiçbir `voice.*` gitmez, P28 §0 m.3). */
function broadcast(room: Room, msg: VoiceStateMessage): void {
  for (const c of techConns(room)) c.peer.send(msg);
  const g = room.admitted?.peer;
  if (hasVoice(room, g)) g?.send(msg);
}

/** Durum değiştiyse yayınlar (aynı durum yeniden gitmez; tekrarlayan join no-op, D-PD-2). Yayın yapıldıysa true. */
function publish(room: Room): boolean {
  const msg = stateOf(room);
  const key = JSON.stringify(msg);
  if (key === room.voice.sentKey) return false;
  room.voice.sentKey = key;
  broadcast(room, msg);
  return true;
}

function auditVoice(rooms: Rooms, room: Room, who: Who, action: VoiceAuditAction, value: JsonObject, result?: "fail"): void {
  void auditMulti(rooms, room, who.ctx, who.actor, action, value, result);
}

const deny = (rooms: Rooms, tech: TechConn, code: string, err: { code: WsDenyCode; message: string }): void => {
  rooms.metrics.inc("rs_voice_denied_total", { code });
  tech.peer.send({ t: "error", ...err });
};
type WsDenyCode = "FORBIDDEN" | "CONFLICT" | "RATE_LIMITED" | "CLIENT_UNSUPPORTED";
const stale = (rooms: Rooms): void => rooms.metrics.inc("rs_voice_denied_total", { code: "stale_call" });

/** Pending bitişinin audit nedeni: müşteri / zaman aşımı; misafir kopması ve oturum bitişi `disconnect`. */
const rejectReason = (r: VoiceEndReason): VoiceRejectReason => (r === "customer" || r === "timeout" ? r : "disconnect");

/**
 * TEK bitiş yolu (§4.2 "Bitiş tetikleyicileri"): idle'da no-op. active → audit `voice.end{durationSec, reason, talkerIds,
 * listenerIds}`; pending → `voice.reject{reason}` (fail). Bitiş yayını biten `callId` + `endReason` taşır. Oda bitişinde
 * (`ending`) de çalışır.
 */
export function endVoice(rooms: Rooms, room: Room, reason: VoiceEndReason, who: Who = SYSTEM): void {
  const v = room.voice;
  if (v.phase === "idle" || v.callId === null) return;
  rooms.clock.clearTimeout(v.pendingTimer);
  const now = rooms.clock.now();
  const callId = v.callId;
  if (v.phase === "active") {
    for (const l of listenersOf(room)) v.listenerIds.add(l.userId);
    const durationSec = Math.max(0, Math.round((now - (v.startedAt ?? now)) / 1000));
    auditVoice(rooms, room, who, VOICE_AUDIT.END, { durationSec, reason, talkerIds: [...v.talkerIds], listenerIds: [...v.listenerIds] });
  } else {
    auditVoice(rooms, room, who, VOICE_AUDIT.REJECT, { reason: rejectReason(reason) }, "fail");
    if (reason === "customer" || reason === "timeout")
      rooms.metrics.inc("rs_voice_calls_total", { result: reason === "customer" ? "rejected" : "timeout" });
  }
  room.voice = { ...newVoice(), requests: v.requests, guestVoice: v.guestVoice, cooldownUntil: v.cooldownUntil };
  if (COOLDOWN.has(reason)) room.voice.cooldownUntil = now + VOICE_DENY_COOLDOWN_MS;
  broadcast(room, { t: "voice.state", phase: "idle", callId, endReason: reason, talkers: [], listeners: [] });
}

/**
 * Oda olayı sonrası tek yeniden hesaplama (V-PD-5, V-PD-7, Y-PD-3): misafir sesi desteklemiyorsa `disconnect`; konuşanlar
 * dinleyenlerle kesişir; active'de konuşan kalmazsa `left`; aksi halde dinleyen birleşimi güncellenir ve değişiklik yayınlanır.
 * Yayın yapıldıysa true.
 */
export function voiceSync(rooms: Rooms, room: Room): boolean {
  const v = room.voice;
  if (v.phase === "idle") return false;
  if (!hasVoice(room, room.admitted?.peer)) return (endVoice(rooms, room, "disconnect"), true);
  const ls = listenersOf(room);
  const tids = new Set(ls.map((l) => l.tid));
  for (const t of v.talkers) if (!tids.has(t)) v.talkers.delete(t);
  if (v.phase === "active") {
    if (v.talkers.size === 0) return (endVoice(rooms, room, "left"), true);
    for (const l of ls) v.listenerIds.add(l.userId);
  }
  return publish(room);
}

/** Konuşanın soketi koptu ya da yenisiyle değişti (V-PD-5): tid konuşanlardan HEMEN çıkar; üyelik payı sesi korumaz. */
export function voiceDropTalker(room: Room, userId: string): void {
  const tid = room.multi.tids.get(userId);
  if (tid !== undefined) room.voice.talkers.delete(tid);
}

/** Teknisyen soketi bağlandı (sahip / üye): değişim yayını; değişim yoksa yalnız bu sokete güncel durum. Yalnız kabul sonrası. */
export function voiceTechAttached(rooms: Rooms, room: Room, conn: TechConn): void {
  if (!room.admitted) return;
  if (!voiceSync(rooms, room)) conn.peer.send(stateOf(room));
}

/** Misafir hello'sundan (roster) hemen sonra: ses destekli misafire güncel durum; son değer teknisyen hello'su için tutulur. */
export function voiceGuestHello(room: Room): void {
  const g = room.admitted?.peer;
  room.voice.guestVoice = hasVoice(room, g);
  if (hasVoice(room, g)) g?.send(stateOf(room));
}

/** r2 Y-PD-3: `applyPermChange` İKİ yolu da (üye + sahip) buradan; `sessions.voice` düştüyse tid konuşan + dinleyenden çıkar. */
export function voicePermChange(rooms: Rooms, room: Room, userId: string, perms: ReadonlySet<PermissionKey>): void {
  if (!perms.has(PERM)) voiceDropTalker(room, userId);
  voiceSync(rooms, room);
}

type TechVoiceMsg = { t: "voice.request" } | { t: "voice.join" | "voice.end"; callId: string };
type GuestVoiceMsg =
  { t: "voice.answer"; callId: string; accept: boolean } | { t: "voice.end"; callId: string; reason: VoiceGuestEndReason };

/** Teknisyen `voice.*` (rol kapısı `ROLE_MAY` talker handlers.ts'te önce: izleyici → FORBIDDEN, AC-378). */
export function handleTechVoice(rooms: Rooms, room: Room, tech: TechConn, m: TechVoiceMsg): void {
  if (m.t === "voice.request") return voiceRequest(rooms, room, tech);
  const v = room.voice;
  if (m.t === "voice.join" && !tech.permissions.has(PERM))
    return deny(rooms, tech, "permission", { code: "FORBIDDEN", message: "Sesli görüşme yetkiniz yok." });
  if (v.phase === "idle" || m.callId !== v.callId) return stale(rooms); // idle'da join/end no-op (D-PD-2)
  const tid = tidOf(room, tech.userId);
  if (m.t === "voice.end") {
    if (!v.talkers.has(tid)) return deny(rooms, tech, "not_talker", { code: "FORBIDDEN", message: "Görüşmede konuşan değilsiniz." });
    return endVoice(rooms, room, "tech", techWho(tech));
  }
  if (v.phase !== "active") return deny(rooms, tech, "conflict", { code: "CONFLICT", message: "Görüşme henüz başlamadı." });
  if (v.talkers.has(tid)) return; // zaten konuşan: no-op, yayın yok
  v.talkers.add(tid);
  v.talkerIds.add(tech.userId);
  auditVoice(rooms, room, techWho(tech), VOICE_AUDIT.JOIN, {});
  voiceSync(rooms, room);
}

/** Kapı sırası §4.2: yetki → gözetimsiz → misafir bağlı → `hasVoice` → faz → bekleme / oturum sayacı. Ret audit'e yazılmaz. */
function voiceRequest(rooms: Rooms, room: Room, tech: TechConn): void {
  const v = room.voice;
  const g = room.admitted?.peer;
  if (!tech.permissions.has(PERM)) return deny(rooms, tech, "permission", { code: "FORBIDDEN", message: "Sesli görüşme yetkiniz yok." });
  if (room.unattended)
    return deny(rooms, tech, "unattended", { code: "CLIENT_UNSUPPORTED", message: "Gözetimsiz oturumda sesli görüşme yapılamaz." });
  if (!g) return deny(rooms, tech, "no_guest", { code: "CONFLICT", message: "Müşteri bağlı değil." });
  if (!hasVoice(room, g))
    return deny(rooms, tech, "client_unsupported", { code: "CLIENT_UNSUPPORTED", message: MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED });
  if (v.phase !== "idle") return deny(rooms, tech, "conflict", { code: "CONFLICT", message: "Sürmekte olan bir sesli görüşme var." });
  if (rooms.clock.now() < v.cooldownUntil)
    return deny(rooms, tech, "cooldown", { code: "RATE_LIMITED", message: "Sesli görüşme için 30 sn sonra tekrar deneyebilirsiniz." });
  if (v.requests >= VOICE_REQUESTS_PER_SESSION)
    return deny(rooms, tech, "limit", { code: "RATE_LIMITED", message: "Bu oturumda sesli görüşme isteği sınırına ulaşıldı." });
  const callId = randomBytes(16).toString("base64url");
  const by = tidOf(room, tech.userId);
  Object.assign(v, { requests: v.requests + 1, phase: "pending", callId, by });
  v.pendingTimer = rooms.clock.setTimeout(() => {
    if (rooms.live(room) && room.voice.phase === "pending" && room.voice.callId === callId) endVoice(rooms, room, "timeout");
  }, VOICE_REQUEST_TIMEOUT_MS);
  auditVoice(rooms, room, techWho(tech), VOICE_AUDIT.REQUEST, {});
  if (g.multi) ensureGuestKnows(room, g, by); // Y-PC-4: `by` önce roster'da
  g.send({ t: "voice.request", callId, by });
  publish(room);
}

/**
 * Misafir `voice.answer` / `voice.end` (şemada yalnız `hasVoice` sokette). Eşleşmeyen `callId` ve fazı uymayan mesaj sessiz
 * düşer. Kabul: konuşan = isteyen (hâlâ dinleyen değilse kabulün ardından `left` ile biter).
 */
export function handleGuestVoice(rooms: Rooms, room: Room, guest: Guest, m: GuestVoiceMsg): void {
  const v = room.voice;
  if (m.callId !== v.callId) return stale(rooms);
  if (m.t === "voice.end") return v.phase === "active" ? endVoice(rooms, room, m.reason, guestWho(guest)) : stale(rooms);
  if (v.phase !== "pending") return stale(rooms);
  if (!m.accept) return endVoice(rooms, room, "customer", guestWho(guest));
  rooms.clock.clearTimeout(v.pendingTimer);
  v.pendingTimer = undefined;
  v.phase = "active";
  v.startedAt = rooms.clock.now();
  const req = listenersOf(room).find((l) => l.tid === v.by);
  if (req) {
    v.talkers.add(req.tid);
    v.talkerIds.add(req.userId);
  }
  rooms.metrics.inc("rs_voice_calls_total", { result: "accepted" });
  auditVoice(rooms, room, guestWho(guest), VOICE_AUDIT.ACCEPT, {});
  voiceSync(rooms, room);
}

/** `rs_voice_active` göstergesi (ws.ts kaydeder). */
export function activeVoiceCount(rooms: Iterable<Room>): number {
  let n = 0;
  for (const r of rooms) if (r.voice.phase === "active") n++;
  return n;
}
