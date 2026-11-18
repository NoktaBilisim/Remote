// P27 gözetimsiz misafir otomatik kabulü (mimari-p27 §2 adım 5, §4.3 r2 TX içi yeniden denetim, §7.1; AC-273, 296, 338).
// `admitRequestGuest` eşi: lobi/kod yok. Teknisyen DB'de etkin + `unattended.connect`; TEK TX: cihaz satırı FOR UPDATE (kilit
// sırası cihaz → oturum) → iptal / yerel anahtar / grant (FOR SHARE) / imza kapısı yeniden → `consumeForAdmit(UNATTENDED)` →
// metinsiz VIEW onayı (UNATTENDED) → audit `unattended.session.started` → `UNATTENDED_STARTED` outbox. Düşen koşulda oturum
// CANCELLED(<neden>) olur, ACTIVE'e geçmez (revoke ‖ admit → ACTIVE yok).
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import type { SessionEndedReason } from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { SecretBox } from "../lib/crypto.ts";
import { newId } from "../lib/ids.ts";
import { ipKey, netKey } from "../lib/ip.ts";
import * as repo from "../sessions/repo.ts";
import type { UnattendedGate } from "../unattended/gate.ts";
import { enqueueStarted } from "../unattended/notify.ts";
import { lockDevice, lockGrant } from "../unattended/repo.ts";
import { syncDisconnect } from "./active.ts";
import { activeTechPerms } from "./admit.ts";
import type { Rooms } from "./rooms.ts";
import { endDeviceRoom } from "./rooms-device.ts";
import { policyActor, recPolicyAdmitted } from "./rec.ts";
import type { Guest, Peer, Room } from "./types.ts";

export interface AdmitDeviceDeps {
  gate: UnattendedGate;
  secrets: SecretBox;
}

type Dev = NonNullable<Room["unattended"]>;
type Tx = Prisma.TransactionClient;

/** P28u §8.1: `consent.result` henüz yoksa ≤ 3 sn beklenir (oda başına tek söz). */
export const CONSENT_WAIT_MS = 3_000;

function waitConsent(rooms: Rooms, dev: Dev): Promise<void> {
  if (dev.consentMode || dev.consentWait) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      rooms.clock.clearTimeout(timer);
      dev.consentWait = undefined;
      resolve();
    };
    const timer = rooms.clock.setTimeout(done, CONSENT_WAIT_MS);
    dev.consentWait = done;
  });
}

/** K-P28u-3 / K-P28u-r3-4: oda yalnız cihazın `consent.result{no_user}` bildirimiyle kabul edilir (fail-closed). */
const consentOk = (dev: Dev): boolean => dev.consentMode === "no_user";

/** §4.3 r2 (b)(c) + kapı: kilitli cihaz hâlâ uygun mu; değilse bitiş nedeni. */
export async function recheck(tx: Tx, d: AdmitDeviceDeps, room: Room, dev: Dev): Promise<SessionEndedReason | null> {
  const locked = await lockDevice(tx, room.tenantId, dev.deviceId);
  if (!locked || locked.revoked_at) return "device_revoked";
  if (!locked.local_enabled) return "local_disabled";
  if (!(await lockGrant(tx, room.tenantId, dev.deviceId, room.technicianId))) return "permission";
  const decl = await tx.unattendedDevice.findUnique({ where: { id: dev.deviceId }, select: { signed: true, binarySha256: true } });
  if (!decl || !d.gate.allows({ signed: decl.signed, sha256: decl.binarySha256 })) return "permission";
  return null;
}

/** Tek TX; "ok" ya da oturumun bitiş nedeni. */
function consumeDevice(
  rooms: Rooms,
  d: AdmitDeviceDeps,
  room: Room,
  dev: Dev,
  ctx: AuditContext,
  now: Date,
  recOut: { rid: string | null },
): Promise<"ok" | SessionEndedReason> {
  return rooms.db.$transaction(async (tx) => {
    const fail = await recheck(tx, d, room, dev);
    if (fail) return fail;
    const consentMode = "no_user" as const; // r3: yeni yazım yalnız `no_user` (consentOk admit öncesi doğruladı)
    const keys = { guestIpKey: ipKey(ctx.ip), guestNetKey: netKey(ctx.ip) };
    const customer = { name: dev.deviceName, email: null };
    if ((await repo.consumeForAdmit(tx, room.sessionId, now, "UNATTENDED", customer, keys)) !== 1) return "device_timeout";
    await tx.supportSession.update({ where: { id: room.sessionId }, data: { consentMode } });
    await tx.sessionConsent.create({
      data: {
        id: newId(),
        sessionId: room.sessionId,
        tenantId: room.tenantId,
        level: "VIEW",
        decision: "GRANTED",
        source: "UNATTENDED",
        ip: ctx.ip.slice(0, 45),
        userAgent: ctx.userAgent.slice(0, 300),
        createdAt: now,
      },
    });
    await writeAudit(tx, ctx, {
      tenantId: room.tenantId,
      username: "device",
      action: UNATTENDED_AUDIT.SESSION_STARTED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: {
        deviceId: dev.deviceId,
        technicianId: room.technicianId,
        techIp: room.tech?.ctx.ip ?? null,
        deviceIp: ctx.ip,
        consentMode,
      },
    });
    await enqueueStarted(tx, d.secrets, { tenantId: room.tenantId, sessionId: room.sessionId, customerId: dev.customerId, now });
    // P28e §2.2 (AC-448): kip yazıldığı TX'te politika kaydı (servis ayarı TX'te yeniden okur; rıza satırı yazılmaz).
    if (dev.recording && rooms.rec) {
      const r = await rooms.rec.startPolicy(tx, {
        tenantId: room.tenantId,
        sessionId: room.sessionId,
        recorderUserId: room.technicianId,
        consentMode,
        actor: policyActor(room, ctx),
      });
      recOut.rid = r.ok ? r.rid : null;
    }
    return "ok";
  });
}

function endPeer(peer: Peer, reason: SessionEndedReason): void {
  peer.send({ t: "session.ended", reason });
  peer.close(1000, reason);
}

/** Yardımcının `/ws/guest` bileti geldi: yeniden denetim + tüketim; başarıda mevcut `startActive`. */
export async function admitDeviceGuest(
  rooms: Rooms,
  room: Room,
  guest: Guest,
  peer: Peer,
  ctx: AuditContext,
  d: AdmitDeviceDeps,
): Promise<"admitted" | "conflict"> {
  const dev = room.unattended;
  if (!dev || room.admitted || room.admitting) {
    peer.close(1008, "conflict");
    rooms.metrics.inc("rs_admit_total", { result: "conflict" });
    return "conflict";
  }
  // §8.1: onay sonucu beklenirken oda `admitting` DEĞİL — bu sürede iptal/kesme PENDING yolundan (DB CANCELLED) biter.
  await waitConsent(rooms, dev);
  if (!rooms.live(room) || room.admitted || room.admitting) {
    peer.close(1000, "ended");
    return "conflict";
  }
  room.admitting = true;
  const now = new Date(rooms.clock.now());
  let outcome: "ok" | SessionEndedReason = "permission";
  const recOut: { rid: string | null } = { rid: null };
  try {
    const perms = await activeTechPerms(rooms, room);
    if (!consentOk(dev)) outcome = "consent_missing";
    else if (perms?.has("unattended.connect")) outcome = await consumeDevice(rooms, d, room, dev, ctx, now, recOut);
  } finally {
    room.admitting = false;
  }
  if (outcome !== "ok") {
    endPeer(peer, outcome);
    rooms.metrics.inc("rs_admit_total", { result: `device_${outcome}` });
    await endDeviceRoom(rooms, room, outcome);
    return "conflict";
  }
  if (!rooms.live(room)) return lateEnd(rooms, room, peer, now);
  return activate(rooms, room, guest, peer, now, recOut.rid);
}

/** Tüketim sürerken oda bitti (iptal/yetki/yerel kapatma): DB ACTIVE kaldı → hemen ENDED (yetkisiz ACTIVE kalmaz). */
async function lateEnd(rooms: Rooms, room: Room, peer: Peer, now: Date): Promise<"conflict"> {
  const reason = room.unattended?.dbEndReason ?? "device_revoked";
  await repo.endActive(rooms.db, room.sessionId, now, "SYSTEM", reason);
  peer.close(1000, "ended");
  return "conflict";
}

async function activate(rooms: Rooms, room: Room, guest: Guest, peer: Peer, now: Date, rid: string | null): Promise<"admitted"> {
  room.lobby.delete(guest.id);
  guest.state = "ADMITTED";
  guest.peer = peer;
  room.admitted = guest;
  const perms = (await activeTechPerms(rooms, room)) ?? new Set<string>();
  room.caps = [
    ...(perms.has("remote_control.use") ? (["remote_control"] as const) : []),
    ...(perms.has("file_transfer.use") ? (["file_transfer"] as const) : []),
  ];
  const limits = await repo.activeLimits(rooms.db, room.tenantId);
  room.maxFileMb = limits.maxFileMb;
  room.fileMode = await repo.sessionFileMode(rooms.db, room.sessionId); // P28b AC-355: satırdaki sabit mod
  rooms.startActive(room, guest, now.getTime(), limits.maxActiveHours);
  recPolicyAdmitted(rooms, room, rid); // P28e: commit sonrası oda belleği + rec.state (ya da cihaz göstergesi kalkar)
  syncDisconnect(rooms, room);
  rooms.metrics.inc("rs_admit_total", { result: "admitted" });
  if (!peer.isOpen()) rooms.detachGuest(room, guest, peer);
  return "admitted";
}
