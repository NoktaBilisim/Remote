// P27 gözetimsiz odaların Rooms eki (mimari-p27 §2 adım 2/8, §4.4 süreler; AC-275, 293, 295, 338). rooms.ts "dokunan böler"
// sınırı (§9) nedeniyle ayrı: ön-kabullü cihaz misafiri + bilet, cihaz odasını bitirme (PENDING → DB CANCELLED, ACTIVE →
// mevcut `finish`), cihaz / teknisyen süzgeçli toplu bitirme.
import { DEVICE_CONSENT_WINDOW_MS, type ConsentRequest } from "@remote/contracts/unattended-consent";
import type { SessionEndedReason } from "@remote/contracts/ws";
import { newId } from "../lib/ids.ts";
import type { UnattendedGate } from "../unattended/gate.ts";
import { finishSilent, silentPolicyEnabled, userHasSilent } from "../unattended/policy.ts";
import { deviceAccess } from "../unattended/device-access.ts";
import { revokeMember, revokeMemberEverywhere } from "./member-life.ts";
import type { Rooms } from "./rooms.ts";
import type { Guest, Room } from "./types.ts";

export interface DeviceRoomRow {
  id: string;
  tenantId: string;
  technicianId: string;
  technician: { fullName: string };
  expiresAt: Date;
}

export interface DeviceRef {
  deviceId: string;
  deviceName: string;
  customerId: string;
  /** P28u: istenen kip (verilmezse `ask` — güvenli yön; `silent` odası bellek kipi `silent` başlar). */
  consent?: ConsentRequest;
}

/**
 * Bağlantı TX'i commit'inden sonra (§2 adım 2): oda + TICKETED AGENT misafiri (lobi/admitCode yok) + tek kullanımlık bilet.
 * Onay metni yoktur (gözetimsiz, S24) — `consent` alanı yalnız tip için boş; admit-device metinsiz UNATTENDED kaydı yazar.
 */
export function preAdmitDevice(rooms: Rooms, row: DeviceRoomRow, dev: DeviceRef): { ticket: string; expiresAt: number } {
  const room = rooms.getOrCreate(row);
  const consentRequest = dev.consent ?? "ask";
  room.unattended = {
    deviceId: dev.deviceId,
    deviceName: dev.deviceName,
    customerId: dev.customerId,
    consentRequest,
    ...(consentRequest === "silent" ? { consentMode: "silent" as const } : {}),
  };
  const now = rooms.clock.now();
  const guest: Guest = {
    id: newId(),
    name: dev.deviceName,
    kind: "AGENT",
    ipKey: "",
    admitHash: "",
    consent: { textId: "", version: 0, sha256: "", at: new Date(now), ip: "", userAgent: "" },
    state: "TICKETED",
    since: now,
    ticketGen: 1,
  };
  room.lobby.set(guest.id, guest);
  // K3 devri: `ask` odasında bilet 60 sn diyalog + gösterge sonrası da geçerli kalmalı → PENDING ömrüyle aynı (150 sn).
  const ttl = consentRequest === "ask" ? Math.max(rooms.timing.ticketMs, DEVICE_CONSENT_WINDOW_MS) : rooms.timing.ticketMs;
  const { token, expiresAt } = rooms.tickets.issue({ sessionId: row.id, guestId: guest.id, gen: 1 }, ttl);
  return { ticket: token, expiresAt };
}

/** PENDING cihaz oturumu → CANCELLED(dbReason); koşullu (status=PENDING), count döner. */
async function cancelPendingDevice(rooms: Rooms, sessionId: string, dbReason: string): Promise<number> {
  const now = new Date(rooms.clock.now());
  const r = await rooms.db.supportSession.updateMany({
    where: { id: sessionId, status: "PENDING", deviceId: { not: null } },
    data: { status: "CANCELLED", activeCode: null, endedAt: now, endedBy: "SYSTEM", endReason: dbReason },
  });
  return r.count;
}

/**
 * Cihaz odasını bitirir. ACTIVE → `rooms.finish` (DB ENDED + audit + session.ended); PENDING → DB CANCELLED(`dbReason` ??
 * reason) + `closeSession`. `dbReason` yalnız DB bitiş nedenidir (`helper_failed`, `no_console`, `busy` — konsola `reason`).
 */
export async function endDeviceRoom(rooms: Rooms, room: Room, reason: SessionEndedReason, dbReason?: string): Promise<void> {
  if (!rooms.live(room) || !room.unattended) return;
  room.unattended.dbEndReason = dbReason ?? reason;
  if (room.admitted || room.admitting) return rooms.finish(room, reason, "SYSTEM");
  try {
    await cancelPendingDevice(rooms, room.sessionId, dbReason ?? reason);
  } catch (err) {
    rooms.log.error({ err, sessionId: room.sessionId }, "gözetimsiz bekleyen oturum iptali DB'ye yazılamadı");
  }
  rooms.closeSession(room.sessionId, reason);
}

/**
 * P28u §8.4 (O-P28u-2): `unattended.silent` geri alınan teknisyenin `silent` oturumları — K3 `finishSilent` (PENDING satırlar
 * tenant + teknisyen koşullu toplu iptal + canlı odalar). Teknisyenin firması DB'den; firmasız (SUPER_ADMIN) → canlı odalar
 * `applyPermChange`'te biter, PENDING satırı admit TX'i reddeder (K-P28u-21).
 */
export async function cancelPendingSilent(rooms: Rooms, technicianId: string): Promise<void> {
  const u = await rooms.db.user.findUnique({ where: { id: technicianId }, select: { tenantId: true } });
  if (!u?.tenantId) return;
  await finishSilent({ db: rooms.db, rooms, now: () => rooms.clock.now(), log: rooms.log }, u.tenantId, technicianId);
}

/** Bu cihazın canlı odaları (isteğe bağlı: yalnız bu teknisyenin). */
export function deviceRooms(rooms: Rooms, deviceId: string, technicianId?: string): Room[] {
  return [...rooms.values()].filter(
    (r) => r.unattended?.deviceId === deviceId && !r.ending && (technicianId === undefined || r.technicianId === technicianId),
  );
}

/**
 * AC-275/293/295: cihazın (ya da teknisyen süzgeçli) tüm odaları `reason` ile biter. P28c (§2): teknisyen süzgeci "sahip veya
 * üye" — üye olduğu odada yalnız üye `revokeMember` ile düşer (grant geri alımı).
 */
export async function finishDevice(rooms: Rooms, deviceId: string, reason: SessionEndedReason, technicianId?: string): Promise<void> {
  if (technicianId) revokeMemberEverywhere(rooms, technicianId, (r) => r.unattended?.deviceId === deviceId);
  await Promise.all(deviceRooms(rooms, deviceId, technicianId).map((r) => endDeviceRoom(rooms, r, reason)));
}

/**
 * O-P27-3 / K-P27-18 yedek yol (60 sn, ws.ts zamanlayıcısı): anlık kesme atlansa da grant / iptal / yerel anahtar / imza
 * kapısı düşmüşse gözetimsiz oda biter (≤ 60 sn). Teknisyenin bağlı olup olmadığından bağımsız çalışır.
 */
export async function revalidateDevice(rooms: Rooms, gate: UnattendedGate, room: Room): Promise<void> {
  const dev = room.unattended;
  if (!dev || !rooms.live(room)) return;
  // P28c O-PC-4: tek yardımcı `deviceAccess` (grant + iptal + yerel anahtar + imza kapısı).
  const v = await deviceAccess(rooms.db, gate, room.tenantId, room.technicianId, dev.deviceId);
  let reason: SessionEndedReason | null = null;
  if (v === "not_found" || v === "revoked") reason = "device_revoked";
  else if (v === "local_disabled") reason = "local_disabled";
  else if (v !== "ok") reason = "permission";
  else if (dev.consentMode === "silent" && !(await silentStillAllowed(rooms, room))) reason = "permission";
  if (reason) return endDeviceRoom(rooms, room, reason);
  await revalidateDeviceMembers(rooms, gate, room);
}

/** P28c Y-PC-2 (§4.3 `revalidate` 6, 6b): üyelerden cihaz erişimi ya da silent yetkisi düşen `revokeMember` ile çıkar. */
async function revalidateDeviceMembers(rooms: Rooms, gate: UnattendedGate, room: Room): Promise<void> {
  const dev = room.unattended;
  if (!dev) return;
  const silent = dev.consentMode === "silent";
  const policy = silent ? await silentPolicyEnabled(rooms.db, room.tenantId) : true;
  for (const m of [...room.multi.members.values()]) {
    const ok =
      (await deviceAccess(rooms.db, gate, room.tenantId, m.userId, dev.deviceId)) === "ok" &&
      (!silent || (policy && (await userHasSilent(rooms.db, room.tenantId, m.userId))));
    if (!ok && rooms.live(room)) revokeMember(rooms, room, m.userId);
  }
}

/**
 * P28u §8.4 yedek yol (AC-440 ≤ 60 sn): `silent` oda yalnız firma politikası açık ∧ teknisyende `unattended.silent` iken
 * sürer. Teknisyenin bağlı olmasından bağımsız (`startDeviceRevalidation`, `rooms.clock`) — anlık `finishSilent` atlansa da.
 */
export async function silentStillAllowed(rooms: Rooms, room: Room): Promise<boolean> {
  return (await silentPolicyEnabled(rooms.db, room.tenantId)) && userHasSilent(rooms.db, room.tenantId, room.technicianId);
}
