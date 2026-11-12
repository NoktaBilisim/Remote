// ACTIVE oda zamanlayıcıları ve hello mesajları: max süre (AC-13), 120 sn kopma (AC-24/25),
// TURN credential yenileme (`ice.servers`, G-13). iceServers yalnız admit sonrası (G-01).
import { newSecretToken, sha256Hex } from "../lib/ids.ts";
import { offerBinding } from "./binding.ts";
import type { Rooms } from "./rooms.ts";
import { iceServersFor } from "./turn.ts";
import type { Guest, Room } from "./types.ts";

const HOUR_MS = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

function grant(rooms: Rooms, room: Room) {
  return iceServersFor(rooms.turn, room.sessionId, rooms.clock.now(), room.maxEndsAt ?? rooms.clock.now());
}

/** Teknisyen hello'su: PENDING'de iceServers boş + maxEndsAt null (TURN yalnız admit sonrası). */
export function sendHelloTech(rooms: Rooms, room: Room): void {
  const g = room.admitted;
  room.tech?.peer.send({
    t: "hello",
    role: "tech",
    sessionId: room.sessionId,
    peerPresent: Boolean(g?.peer),
    ...(g ? { guestKind: g.kind } : {}),
    iceServers: g ? grant(rooms, room).iceServers : [],
    maxEndsAt: room.maxEndsAt ? iso(room.maxEndsAt) : null,
    ...(g && room.maxFileMb ? { maxFileMb: room.maxFileMb } : {}),
    ...(g ? { guestName: g.name } : {}), // QA-P4-12: yeniden bağlanan teknisyen misafiri tanır
    ...(g && room.share ? { share: room.share } : {}),
  });
}

/** Misafir hello'su (admit ve yeniden bağlanma): yeni reconnectToken (eskisi geçersiz), caps. */
export function sendHelloGuest(rooms: Rooms, room: Room, guest: Guest): void {
  if (room.reconnectHash) rooms.reconnect.delete(room.reconnectHash);
  const token = newSecretToken();
  room.reconnectHash = sha256Hex(token);
  rooms.reconnect.set(room.reconnectHash, room.sessionId);
  guest.peer?.send({
    t: "hello",
    role: "guest",
    sessionId: room.sessionId,
    peerPresent: Boolean(room.tech),
    guestKind: guest.kind,
    iceServers: grant(rooms, room).iceServers,
    maxEndsAt: iso(room.maxEndsAt ?? rooms.clock.now()),
    caps: room.caps,
    ...(room.maxFileMb ? { maxFileMb: room.maxFileMb } : {}),
    reconnectToken: token,
  });
  offerBinding(rooms, guest);
}

/** Teknisyene misafir katıldı (admit ve misafir yeniden bağlanması): ad + ACTIVE bitiş zamanı (TEST-P4-2). */
export function sendGuestJoined(room: Room, guest: Guest): void {
  room.tech?.peer.send({ t: "peer.joined", role: "guest", guestKind: guest.kind, guestName: guest.name, ...(room.maxEndsAt ? { maxEndsAt: iso(room.maxEndsAt) } : {}), ...(room.maxFileMb ? { maxFileMb: room.maxFileMb } : {}) });
}

function scheduleIceRefresh(rooms: Rooms, room: Room): void {
  const exp = grant(rooms, room).expiresAt;
  if (exp === null) return;
  const at = exp - rooms.timing.iceRefreshBeforeMs;
  if (room.maxEndsAt !== undefined && exp >= room.maxEndsAt) return; // credential oturum sonuna kadar geçerli
  room.timers.iceRefresh = rooms.clock.setTimeout(() => {
    if (!rooms.live(room)) return;
    const { iceServers } = grant(rooms, room);
    room.tech?.peer.send({ t: "ice.servers", iceServers });
    room.admitted?.peer?.send({ t: "ice.servers", iceServers });
    scheduleIceRefresh(rooms, room);
  }, Math.max(0, at - rooms.clock.now()));
}

/**
 * Admit commit'i sonrası: max süre, uyarı, TURN yenileme; misafire hello, teknisyene ice.servers + peer.joined.
 * Sıra bağlayıcı: teknisyen `peer.joined` ile hemen offer üretir; PENDING hello'su boş ICE taşıdığından (G-01)
 * `ice.servers` ondan ÖNCE gitmezse ilk teklif TURN/STUN'suz toplanır (farklı NAT'ta siyah ekran).
 */
export function scheduleActive(rooms: Rooms, room: Room, guest: Guest, consumedAt: number, maxHours: number): void {
  room.maxEndsAt = consumedAt + maxHours * HOUR_MS;
  const now = rooms.clock.now();
  const warnAt = room.maxEndsAt - rooms.timing.warnBeforeMs;
  room.timers.warn = rooms.clock.setTimeout(() => {
    if (!rooms.live(room) || room.maxEndsAt === undefined) return;
    const msg = { t: "session.warning", kind: "max_duration_5min", endsAt: iso(room.maxEndsAt) } as const;
    room.tech?.peer.send(msg);
    room.admitted?.peer?.send(msg);
  }, Math.max(0, warnAt - now));
  room.timers.maxEnd = rooms.clock.setTimeout(() => void rooms.finish(room, "max_duration", "SYSTEM"), Math.max(0, room.maxEndsAt - now));
  scheduleIceRefresh(rooms, room);
  sendHelloGuest(rooms, room, guest);
  room.tech?.peer.send({ t: "ice.servers", iceServers: grant(rooms, room).iceServers });
  sendGuestJoined(room, guest);
}

/** İki taraf da bağlıysa kopma sayacı iptal; biri yoksa 120 sn sonra oturum `timeout` ile biter (AC-25). */
export function syncDisconnect(rooms: Rooms, room: Room): void {
  if (!room.admitted) return;
  const both = Boolean(room.tech && room.admitted.peer);
  if (both) {
    rooms.clock.clearTimeout(room.timers.disconnect);
    room.timers.disconnect = undefined;
    return;
  }
  if (room.timers.disconnect !== undefined) return;
  room.timers.disconnect = rooms.clock.setTimeout(() => {
    room.timers.disconnect = undefined;
    if (!(room.tech && room.admitted?.peer)) void rooms.finish(room, "timeout", "SYSTEM");
  }, rooms.timing.reconnectMs);
}
