// P28u oturum kapatma sonrası yeniden katılım (mimari-p28u §7.5, §8.3; AC-443; K-P28u-5, D-P28u-2, O-P28u-2). Süreler tek
// tanım `@remote/contracts/rejoin-const` (pencere 45 sn komuttan, bilet 30 sn). Pencere açıkken eski misafirin kopuşu odayı
// bitirmez; pencere dolunca (misafir yoksa) `session_changed`. `ok:false` / 15 sn yanıtsızlık aynı temizlik yolu
// (`clearRejoinWindow`). Bilet tek kullanımlık, oturum başına 1, yalnız başarılı `logoff` sonrası. Yeniden katılım TX'i admit
// ile aynı kilit sırası (cihaz → grant → kapı → silent'ta politika + `unattended.silent`); onay/outbox YAZILMAZ.
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { REJOIN_TICKET_TTL_SEC, REJOIN_WINDOW_MS } from "@remote/contracts/rejoin-const";
import type { SessionEndedReason } from "@remote/contracts/ws";
import {
  deviceControlIndicatorText,
  deviceIndicatorText,
  deviceSilentIndicatorText,
  type DeviceConsentOutbound,
} from "@remote/contracts/ws-device";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { newId } from "../lib/ids.ts";
import { sendGuestJoined, sendHelloGuest, syncDisconnect } from "./active.ts";
import { activeTechPerms } from "./admit.ts";
import { recheck, silentRecheck, type AdmitDeviceDeps } from "./admit-device.ts";
import type { Rooms } from "./rooms.ts";
import { endDeviceRoom } from "./rooms-device.ts";
import type { Guest, Peer, Room } from "./types.ts";

/** Cihaza `rejoin` gönderen bağlantı (DeviceHub.sendConsent). */
export interface RejoinLink {
  sendConsent(deviceId: string, msg: DeviceConsentOutbound): boolean;
}

/** `intervene{logoff}` gönderilirken: pencere komuttan 45 sn. Dolunca misafir yoksa oda `session_changed`. */
export function openRejoinWindow(rooms: Rooms, room: Room): void {
  const u = room.unattended;
  if (!u) return;
  rooms.clock.clearTimeout(u.rejoinTimer);
  u.rejoinUntil = rooms.clock.now() + REJOIN_WINDOW_MS;
  u.rejoinTimer = rooms.clock.setTimeout(() => clearRejoinWindow(rooms, room), REJOIN_WINDOW_MS);
}

/** Tek temizlik yolu (pencere doldu / `ok:false` / yanıtsızlık): misafir hâlâ bağlıysa oturum sürer, değilse `session_changed`. */
export function clearRejoinWindow(rooms: Rooms, room: Room): void {
  const u = room.unattended;
  if (!u || u.rejoinUntil === undefined) return;
  rooms.clock.clearTimeout(u.rejoinTimer);
  u.rejoinUntil = undefined;
  u.rejoinTimer = undefined;
  u.rejoinGuestId = undefined;
  if (rooms.live(room) && !room.admitted?.peer)
    void endDeviceRoom(rooms, room, "session_changed").catch((err: unknown) =>
      rooms.log.error({ err, sessionId: room.sessionId }, "yeniden katılım penceresi kapanışı işlenemedi"),
    );
}

/**
 * Başarılı `logoff` sonucu: oda canlı ∧ pencere açık ∧ teknisyen hâlâ `unattended.connect` → yeni TICKETED misafir + bilet
 * (gen+1) → cihaza `rejoin`. Oturum başına en çok 1; gönderildiyse true.
 */
export async function issueRejoin(rooms: Rooms, link: RejoinLink, room: Room, test: boolean): Promise<boolean> {
  const u = room.unattended;
  if (!u || u.rejoinUsed || u.rejoinUntil === undefined || !rooms.live(room)) return false;
  const perms = await activeTechPerms(rooms, room);
  if (!perms?.has("unattended.connect")) return false;
  u.rejoinUsed = true;
  const now = rooms.clock.now();
  const gen = (room.admitted?.ticketGen ?? 1) + 1;
  const guest: Guest = {
    id: newId(),
    name: u.deviceName,
    kind: "AGENT",
    ipKey: "",
    admitHash: "",
    consent: { textId: "", version: 0, sha256: "", at: new Date(now), ip: "", userAgent: "" },
    state: "TICKETED",
    since: now,
    ticketGen: gen,
  };
  room.lobby.set(guest.id, guest);
  u.rejoinGuestId = guest.id;
  const { token } = rooms.tickets.issue({ sessionId: room.sessionId, guestId: guest.id, gen });
  const tenant = await rooms.db.tenant.findUnique({ where: { id: room.tenantId }, select: { name: true } });
  const firm = tenant?.name.slice(0, 120) || "Destek";
  const mode = u.consentMode ?? "no_user";
  const silent = mode === "silent";
  const indicatorText = (silent ? deviceSilentIndicatorText : deviceIndicatorText)(room.technicianName, firm, test);
  return link.sendConsent(u.deviceId, {
    t: "rejoin",
    sessionId: room.sessionId,
    ticket: token,
    mode,
    indicatorText,
    ...(silent ? { indicatorControl: deviceControlIndicatorText(room.technicianName, firm, test) } : {}),
    expiresInSec: REJOIN_TICKET_TTL_SEC,
  });
}

async function auditRejoin(rooms: Rooms, room: Room, ctx: AuditContext, failReason: string | null): Promise<void> {
  rooms.metrics.inc("rs_unattended_rejoin_total", { result: failReason ?? "ok" });
  await writeAudit(rooms.db, ctx, {
    tenantId: room.tenantId,
    username: "device",
    action: UNATTENDED_AUDIT.REJOIN,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: failReason ? "fail" : "success",
    newValue: { deviceId: room.unattended?.deviceId ?? null, ...(failReason ? { failReason } : {}) },
  });
}

/** Yeniden denetim TX'i; "ok" ya da bitiş nedeni. */
function recheckRejoin(rooms: Rooms, d: AdmitDeviceDeps, room: Room): Promise<"ok" | SessionEndedReason> {
  const dev = room.unattended;
  if (!dev) return Promise.resolve("permission");
  return rooms.db.$transaction(async (tx) => {
    const fail = await recheck(tx, d, room, dev);
    if (fail) return fail;
    if (dev.consentMode === "silent" && !(await silentRecheck(tx, room))) return "permission";
    return "ok";
  });
}

/** Yeniden katılım biletiyle gelen yardımcı (ws-auth `deviceTicket`): pencere + bilet ömrü + TX → misafir `admitted`. */
export async function rejoinDeviceGuest(
  rooms: Rooms,
  room: Room,
  guest: Guest,
  peer: Peer,
  ctx: AuditContext,
  d: AdmitDeviceDeps,
): Promise<void> {
  const u = room.unattended;
  const now = rooms.clock.now();
  const inTime = u?.rejoinUntil !== undefined && now <= u.rejoinUntil && now - guest.since <= REJOIN_TICKET_TTL_SEC * 1000;
  if (!u || u.rejoinGuestId !== guest.id || !inTime) {
    peer.close(1008, "conflict");
    await auditRejoin(rooms, room, ctx, "expired");
    return;
  }
  u.rejoinGuestId = undefined;
  const perms = await activeTechPerms(rooms, room);
  const outcome = perms?.has("unattended.connect") ? await recheckRejoin(rooms, d, room) : "permission";
  await auditRejoin(rooms, room, ctx, outcome === "ok" ? null : outcome);
  if (outcome !== "ok" || !rooms.live(room)) {
    peer.send({ t: "session.ended", reason: outcome === "ok" ? "session_changed" : outcome });
    peer.close(1000, "ended");
    return endDeviceRoom(rooms, room, outcome === "ok" ? "session_changed" : outcome);
  }
  promote(rooms, room, guest, peer);
}

/** Eski misafir yerine yenisi (kontrol VIEW başlar — eski misafirin kopuşu `resetOnGuestGone` ile sıfırladı). */
function promote(rooms: Rooms, room: Room, guest: Guest, peer: Peer): void {
  const u = room.unattended;
  if (u) {
    rooms.clock.clearTimeout(u.rejoinTimer);
    u.rejoinUntil = undefined;
    u.rejoinTimer = undefined;
  }
  const old = room.admitted;
  const oldPeer = old?.peer;
  if (old && oldPeer) {
    rooms.detachGuest(room, old, oldPeer);
    oldPeer.close(1000, "replaced");
  }
  room.lobby.delete(guest.id);
  guest.state = "ADMITTED";
  guest.peer = peer;
  room.admitted = guest;
  sendHelloGuest(rooms, room, guest);
  sendGuestJoined(room, guest);
  syncDisconnect(rooms, room);
  if (!peer.isOpen()) rooms.detachGuest(room, guest, peer);
}
