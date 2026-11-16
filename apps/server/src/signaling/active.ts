// ACTIVE oda zamanlayıcıları ve hello mesajları: max süre (AC-13), 120 sn kopma (AC-24/25),
// TURN credential yenileme (`ice.servers`, G-13). iceServers yalnız admit sonrası (G-01).
import type { SessionEndedReason } from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { newSecretToken, sha256Hex } from "../lib/ids.ts";
import * as repo from "../sessions/repo.ts";
import { offerBinding } from "./binding.ts";
import { capsFor, featureList, fileModeOf, guestFeatures, hasFsrv } from "./rooms-features.ts";
import type { Rooms } from "./rooms.ts";
import { iceServersFor, type IceGrant } from "./turn.ts";
import type { Guest, Room } from "./types.ts";
import { recHelloGuest, recHelloTech } from "./rec.ts";

const HOUR_MS = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * G-P13b-1: oda başına TURN credential önbelleği. Yeniden bağlanma (hello) yeni username üretmez; credential yenileme
 * eşiğine (`iceRefreshBeforeMs`) gelene kadar aynısı verilir → coturn `user-quota` oturum başına çoğalmaz. Yeni credential
 * yalnız yenileme zamanlayıcısında (ya da eşik geçince) üretilir; bu yüzden aynı anda en çok 2 geçerli credential olur
 * (yeni + bitmekte olan). TURN ayarı değişince (`rooms.turn` yeni nesne) önbellek kullanılmaz.
 */
function grant(rooms: Rooms, room: Room, fresh = false): IceGrant {
  const now = rooms.clock.now();
  const c = room.iceGrant;
  if (!fresh && c && c.cfg === rooms.turn && c.grant.expiresAt !== null && c.grant.expiresAt - now > rooms.timing.iceRefreshBeforeMs)
    return c.grant;
  const g = iceServersFor(rooms.turn, room.sessionId, now, room.maxEndsAt ?? now);
  room.iceGrant = g.expiresAt === null ? undefined : { cfg: rooms.turn, grant: g };
  return g;
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
    ...unattendedHello(rooms, room),
    ...(g ? { fileMode: fileModeOf(room) } : {}), // P28b §5.1: teknisyene her zaman (admit sonrası)
    ...clipPrintFields(room),
    ...recHelloTech(rooms, room), // P28e §6.2: kayıt durumu; kaydediciye yeni belirteç
  });
}

/** P27 + P28u (§6.4): konsol rozeti + kip (`ask` odasında onay sonucuna kadar yok) + müdahale düğmeleri (cihaz `consent1`). */
function unattendedHello(rooms: Rooms, room: Room) {
  const u = room.unattended;
  if (!u) return {};
  return {
    unattended: {
      deviceId: u.deviceId,
      deviceName: u.deviceName,
      ...(u.consentMode ? { consentMode: u.consentMode } : {}),
      intervene: rooms.devices?.has(u.deviceId, "consent1") ?? false,
      ...(u.recordOutdated ? { recordOutdated: true as const } : {}), // P28e §6.1: "Cihaz istemcisi eski" uyarısı
    },
  };
}

/**
 * P28a (§4.2): misafir özellik bildirdiyse teknisyene `guestFeatures` (+ hello'da `clipConsent`); yoksa alan yok (= `[]`).
 * P28b (§5.4 c): `fsrv` yalnız bağlı misafir `hasFsrv` ise; `clipConsent` yalnız pano/yazdırma özelliği varken.
 */
function clipPrintFields(room: Room, withConsent = true) {
  const f = guestFeatures(room);
  const list = featureList(f, hasFsrv(room, room.admitted?.peer));
  if (list.length === 0) return {};
  return { guestFeatures: list, ...(withConsent && f.size > 0 ? { clipConsent: room.clipPrint.consent } : {}) };
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
    caps: capsFor(room.caps, guestFeatures(room), fileModeOf(room)), // P28a T7 + P28b §5.4 a
    ...(room.maxFileMb ? { maxFileMb: room.maxFileMb } : {}),
    ...(hasFsrv(room, guest.peer) ? { fileMode: fileModeOf(room) } : {}), // P28b §5.1: eski istemciye yeni alan gitmez
    reconnectToken: token,
    ...recHelloGuest(rooms, room, guest), // P28e §6.2: rıza penceresi + `rec1` sokete kayıt durumu
  });
  offerBinding(rooms, guest);
}

/** Teknisyene misafir katıldı (admit ve misafir yeniden bağlanması): ad + ACTIVE bitiş zamanı (TEST-P4-2). */
export function sendGuestJoined(room: Room, guest: Guest): void {
  room.tech?.peer.send({
    t: "peer.joined",
    role: "guest",
    guestKind: guest.kind,
    guestName: guest.name,
    ...(room.maxEndsAt ? { maxEndsAt: iso(room.maxEndsAt) } : {}),
    ...(room.maxFileMb ? { maxFileMb: room.maxFileMb } : {}),
    fileMode: fileModeOf(room), // P28b §5.1
    ...clipPrintFields(room, false),
  });
}

function scheduleIceRefresh(rooms: Rooms, room: Room): void {
  const exp = grant(rooms, room).expiresAt;
  if (exp === null) return;
  const at = exp - rooms.timing.iceRefreshBeforeMs;
  if (room.maxEndsAt !== undefined && exp >= room.maxEndsAt) return; // credential oturum sonuna kadar geçerli
  room.timers.iceRefresh = rooms.clock.setTimeout(
    () => {
      if (!rooms.live(room)) return;
      const { iceServers } = grant(rooms, room, true);
      room.tech?.peer.send({ t: "ice.servers", iceServers });
      room.admitted?.peer?.send({ t: "ice.servers", iceServers });
      scheduleIceRefresh(rooms, room);
    },
    Math.max(0, at - rooms.clock.now()),
  );
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
  room.timers.warn = rooms.clock.setTimeout(
    () => {
      if (!rooms.live(room) || room.maxEndsAt === undefined) return;
      const msg = { t: "session.warning", kind: "max_duration_5min", endsAt: iso(room.maxEndsAt) } as const;
      room.tech?.peer.send(msg);
      room.admitted?.peer?.send(msg);
    },
    Math.max(0, warnAt - now),
  );
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

/** `Rooms.finish`: ACTIVE oturum → DB ENDED + audit `session.ended` (tek TX); hata loglanır, teardown yine yapılır. */
export async function recordEnded(
  rooms: Rooms,
  room: Room,
  reason: SessionEndedReason,
  endedBy: "TECH" | "CUSTOMER" | "SYSTEM",
  ctx: AuditContext,
): Promise<void> {
  try {
    await rooms.db.$transaction(async (tx) => {
      if ((await repo.endActive(tx, room.sessionId, new Date(rooms.clock.now()), endedBy, reason)) === 0) return;
      const actor =
        endedBy === "TECH" && room.tech
          ? { userId: room.tech.userId, username: room.tech.username }
          : { username: endedBy === "CUSTOMER" ? "customer" : "system" };
      await writeAudit(tx, ctx, {
        tenantId: room.tenantId,
        ...actor,
        action: "session.ended",
        entity: "support_sessions",
        entityId: room.sessionId,
        result: "success",
        oldValue: { status: "ACTIVE" },
        newValue: { status: "ENDED", endedBy, reason },
      });
    });
  } catch (err) {
    rooms.log.error({ err, sessionId: room.sessionId }, "oturum bitişi DB'ye yazılamadı");
  }
}
