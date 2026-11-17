// P28c WS komutları ve SDP/ICE yönlendirmesi (mimari-p28c r2 §4.4, §5.1–§5.3; AC-366, 367, 369; O-PC-2, Y-PC-4, T9).
// Rol kapısı (`seatMay`) handlers.ts'te bu işleyicilerden ÖNCE uygulanır; burada yalnız komutun kendi kuralları.
import type { GuestInboundFull } from "@remote/contracts/ws";
import { MULTI_ROOM_CMDS_PER_MIN } from "@remote/contracts/ws-multi";
import { writeAudit } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { eligibleToJoin, subjectById } from "../sessions/eligibility.ts";
import * as repo from "../sessions/repo.ts";
import { narrowCaps } from "./control-revoke.ts";
import { techActor } from "./control-record.ts";
import { leaveMember, setController } from "./member-life.ts";
import { broadcastRoster, ensureGuestKnows, logOnce, seatOf, tidOf, userOfTid, type Seat } from "./members.ts";
import { auditMulti, CUSTOMER_ACTOR, MULTI_AUDIT } from "./multi-audit.ts";
import type { Rooms } from "./rooms.ts";
import { syncDisconnect } from "./active.ts";
import type { Guest, Member, Peer, Room, TechConn } from "./types.ts";
import { WS_CLOSE } from "@remote/contracts/ws";
import { voiceSync } from "./voice.ts";

const err = (c: TechConn, code: "CONFLICT" | "FORBIDDEN" | "RATE_LIMITED", message: string): void =>
  c.peer.send({ t: "error", code, message });

/** Oda başına dakikada ≤ 10 davet/devir/çıkarma komutu (T8). Aşıldıysa true (komut işlenmez). */
export function roomCmdLimited(rooms: Rooms, room: Room): boolean {
  const now = rooms.clock.now();
  const recent = room.multi.cmdTimes.filter((t) => now - t < 60_000);
  if (recent.length >= MULTI_ROOM_CMDS_PER_MIN) {
    room.multi.cmdTimes = recent;
    return true;
  }
  room.multi.cmdTimes = [...recent, now];
  return false;
}

/** Hedef tid → bağlı üye (sahip hariç). */
function connectedMember(room: Room, tid: string): Member | undefined {
  const uid = userOfTid(room, tid);
  const m = uid ? room.multi.members.get(uid) : undefined;
  return m?.conn && m.joinedAudited ? m : undefined;
}

/** Ortak ön koşul: devir sürmüyor, sahipte `sessions.invite`, oda komut kovası. */
function ownerCmdRefused(rooms: Rooms, room: Room, seat: Seat): boolean {
  if (room.multi.transferring) return (err(seat.conn, "CONFLICT", "Oturum devri sürüyor."), true);
  if (!seat.conn.permissions.has("sessions.invite")) return (err(seat.conn, "FORBIDDEN", "Bu işlem için yetkiniz yok."), true);
  if (roomCmdLimited(rooms, room)) return (err(seat.conn, "RATE_LIMITED", "Çok sık işlem; biraz sonra tekrar deneyin."), true);
  return false;
}

/** §5.1 `control.handover{to}`: hedef bağlı katılımcı ya da sahibin kendisi (geri alma); izleyici → CONFLICT. */
export function handleHandover(rooms: Rooms, room: Room, seat: Seat, to: string): void {
  if (!room.admitted) return err(seat.conn, "CONFLICT", "Oturum henüz başlamadı.");
  if (ownerCmdRefused(rooms, room, seat)) return;
  const self = to === tidOf(room, room.technicianId);
  const target = self ? undefined : connectedMember(room, to);
  if (!self && (!target || target.role !== "participant"))
    return err(seat.conn, "CONFLICT", "Kontrol yalnız bağlı bir katılımcıya devredilebilir.");
  const toUserId = self ? room.technicianId : (target?.userId ?? room.technicianId);
  const from = room.multi.controllerId;
  if (from === toUserId) return err(seat.conn, "CONFLICT", "Kontrol zaten bu teknisyende.");
  setController(rooms, room, toUserId, seat.conn, "handover");
  void auditMulti(rooms, room, seat.conn.ctx, techActor(seat.conn), MULTI_AUDIT.CONTROL_HANDOVER, { fromUserId: from, toUserId });
  broadcastRoster(room);
}

/** `member.leave`: sahip olmayan üye anında ayrılır (`participant_leave{left}`), soket 1000. */
export function handleMemberLeave(rooms: Rooms, room: Room, seat: Seat): void {
  if (room.multi.transferring) return err(seat.conn, "CONFLICT", "Oturum devri sürüyor.");
  if (seat.member) leaveMember(rooms, room, seat.member.userId, "left", { code: WS_CLOSE.NORMAL, why: "left" });
}

/** §5.3 `tech.remove{tid}` (multi1 misafir): sahip çıkarılamaz; çıkarılan bu oturuma yeniden giremez (T7). */
export function handleTechRemove(rooms: Rooms, room: Room, guest: Guest, peer: Peer, tid: string): void {
  if (room.multi.transferring) return peer.send({ t: "error", code: "CONFLICT", message: "Oturum devri sürüyor." });
  const uid = userOfTid(room, tid);
  if (uid === room.technicianId) return peer.send({ t: "error", code: "FORBIDDEN", message: "Oturum sahibi çıkarılamaz." });
  const m = uid ? room.multi.members.get(uid) : undefined;
  if (!m) return peer.send({ t: "error", code: "NOT_FOUND", message: "Teknisyen bulunamadı." });
  if (roomCmdLimited(rooms, room)) return peer.send({ t: "error", code: "RATE_LIMITED", message: "Çok sık işlem." });
  room.multi.removed.add(m.userId);
  const ctx = guest.ctx ?? { ip: "", userAgent: "signaling", requestId: "" };
  void auditMulti(rooms, room, ctx, CUSTOMER_ACTOR, MULTI_AUDIT.PARTICIPANT_REMOVE, { userId: m.userId, role: m.role });
  leaveMember(rooms, room, m.userId, "left", { code: WS_CLOSE.REMOVED, why: "removed" }, false);
}

type TransferFail = "conflict" | "target_gone";

async function auditTransfer(rooms: Rooms, room: Room, by: TechConn, toUserId: string, ok: boolean, failReason?: TransferFail) {
  const cm = room.unattended?.consentMode;
  await auditMulti(
    rooms,
    room,
    by.ctx,
    techActor(by),
    MULTI_AUDIT.TRANSFER,
    { fromUserId: by.userId, toUserId, ...(cm ? { consentMode: cm } : {}), ...(failReason ? { failReason } : {}) },
    ok ? "success" : "fail",
  );
}

/**
 * §5.2 `session.transfer{to}`: tek TX — hedef kilidi + AC-11 açık oturum sınırı (K-PC-8) + koşullu UPDATE + audit. Commit
 * sonrası hedef gitmişse UPDATE geri alınır (`fail{target_gone}`), bellek değişmez. `transferring` `finally` ile düşer.
 */
export async function handleTransfer(rooms: Rooms, room: Room, seat: Seat, to: string): Promise<void> {
  if (!room.admitted) return err(seat.conn, "CONFLICT", "Oturum henüz başlamadı.");
  if (ownerCmdRefused(rooms, room, seat)) return;
  const target = connectedMember(room, to);
  if (!target || target.role !== "participant" || room.multi.removed.has(target.userId))
    return err(seat.conn, "CONFLICT", "Oturum yalnız bağlı bir katılımcıya devredilebilir.");
  const from = room.technicianId;
  const toUserId = target.userId;
  room.multi.transferring = true;
  try {
    const out = await transferTx(rooms, room, seat.conn, from, toUserId);
    if (out !== "ok") {
      err(seat.conn, "CONFLICT", out === "limit" ? "Hedef teknisyenin açık oturum sınırı dolu." : "Oturum devredilemedi.");
      return void (await auditTransfer(rooms, room, seat.conn, toUserId, false, "conflict"));
    }
    // §4.3 adım 9 (senkron, O-PC-2): hedef hâlâ bağlı üye ve çıkarılmamış mı; değilse geri al.
    const m = room.multi.members.get(toUserId);
    if (!rooms.live(room) || !m?.conn || room.multi.removed.has(toUserId) || room.tech !== seat.conn) {
      await rooms.db.supportSession
        .updateMany({
          where: { id: room.sessionId, tenantId: room.tenantId, status: "ACTIVE", technicianId: toUserId },
          data: { technicianId: from },
        })
        .catch((e: unknown) => rooms.log.error({ err: e, sessionId: room.sessionId }, "oturum devri geri alınamadı"));
      if (rooms.live(room)) err(seat.conn, "CONFLICT", "Hedef teknisyen oturumdan ayrıldı.");
      return void (await auditTransfer(rooms, room, seat.conn, toUserId, false, "target_gone"));
    }
    swapOwner(rooms, room, seat.conn, m);
  } finally {
    room.multi.transferring = false;
  }
}

/**
 * D-PC-K4: hedef TX içinde (kilit sonrası) yeniden okunur — etkin kullanıcı + tenant, §4.3 `revalidate` (görüntüleme yetkisi,
 * gözetimsizde `unattended.connect` + cihaz grant'ı + silent yetki/politika) ve sahip koltuğu için odayı açan yetki
 * (gözetimli: `sessions.create`, `POST /sessions` ile aynı; gözetimsiz: `unattended.connect`, D-PC-K5). 60 sn yedek yola bırakılmaz.
 */
async function targetMayOwn(rooms: Rooms, tx: Prisma.TransactionClient, room: Room, to: string): Promise<boolean> {
  const s = await subjectById(tx, to);
  if (!s) return false;
  // D-PC-K5: sahip koltuğu, odayı açan yetkiyle aynı — gözetimli `sessions.create`, gözetimsiz `unattended.connect`
  // (`connect.ts`); ikincisi + grant + silent koşulları aşağıdaki `eligibleToJoin` revalidate evresinde denetlenir.
  if (!room.unattended && !s.permissions.has("sessions.create")) return false;
  const gate = rooms.unattendedGate;
  if (room.unattended && !gate) return false;
  const deps = { db: tx, rooms, gate: gate ?? { allows: () => false } };
  return (await eligibleToJoin(deps, s, room, "invite", "revalidate")) === null;
}

async function transferTx(rooms: Rooms, room: Room, by: TechConn, from: string, to: string): Promise<"ok" | "conflict" | "limit"> {
  try {
    return await rooms.db.$transaction(async (tx) => {
      await repo.lockTechnician(tx, to);
      if (!(await targetMayOwn(rooms, tx, room, to))) return "conflict" as const;
      const settings = await repo.sessionSettings(tx, room.tenantId);
      if (settings && (await repo.countOpen(tx, to, new Date(rooms.clock.now()))) >= settings.maxOpenSessions) return "limit" as const;
      const r = await tx.supportSession.updateMany({
        where: { id: room.sessionId, tenantId: room.tenantId, status: "ACTIVE", technicianId: from },
        data: { technicianId: to },
      });
      if (r.count !== 1) return "conflict" as const;
      const cm = room.unattended?.consentMode;
      await writeAudit(tx, by.ctx, {
        tenantId: room.tenantId,
        ...techActor(by),
        action: MULTI_AUDIT.TRANSFER,
        entity: "support_sessions",
        entityId: room.sessionId,
        result: "success",
        newValue: { fromUserId: from, toUserId: to, ...(cm ? { consentMode: cm } : {}) },
      });
      return "ok" as const;
    });
  } catch (e) {
    rooms.log.error({ err: e, sessionId: room.sessionId }, "oturum devri TX'i başarısız");
    return "conflict";
  }
}

/** Commit sonrası bellek (§5.2): sahip ↔ üye yer değişir, eski sahip katılımcı olur, kontrol yeni sahipte. */
function swapOwner(rooms: Rooms, room: Room, oldConn: TechConn, m: Member): void {
  const newConn = m.conn;
  if (!newConn) return;
  room.multi.members.delete(m.userId);
  const oldOwner: Member = {
    userId: oldConn.userId,
    username: oldConn.username,
    fullName: room.technicianName,
    role: "participant",
    via: "invite",
    conn: oldConn,
    joinedAudited: true,
    authSessionId: oldConn.authSessionId ?? "",
  };
  room.multi.members.set(oldConn.userId, oldOwner);
  room.tech = newConn;
  room.technicianId = m.userId;
  room.technicianName = m.fullName;
  setController(rooms, room, m.userId, oldConn, "transfer");
  syncDisconnect(rooms, room);
  void narrowCaps(rooms, room, newConn.permissions);
  if (room.unattended?.consentMode === "silent")
    rooms.silentNotify?.({
      event: "transfer",
      room,
      actor: { userId: oldConn.userId, email: oldConn.username, fullName: oldOwner.fullName },
      role: "owner",
      ctx: oldConn.ctx,
    });
  broadcastRoster(room);
  voiceSync(rooms, room); // P28d §4.2: devirde konuşanlar (tid) değişmez; yalnız yeniden hesap
}

// --- SDP/ICE yönlendirmesi (§4.4) ---

type TechRelay =
  | { t: "sdp.offer"; sdp: string }
  | { t: "ice"; candidate: string; sdpMid?: string | undefined; sdpMLineIndex?: number | undefined }
  | { t: "ice.restart" };

const iceFields = (m: { candidate: string; sdpMid?: string | undefined; sdpMLineIndex?: number | undefined }) => ({
  candidate: m.candidate,
  ...(m.sdpMid !== undefined ? { sdpMid: m.sdpMid } : {}),
  ...(m.sdpMLineIndex !== undefined ? { sdpMLineIndex: m.sdpMLineIndex } : {}),
});

/**
 * Teknisyen → misafir: multi1 misafire `from: tid` (sunucu damgalar) ve önce o tid'i içeren roster (Y-PC-4); eski misafire
 * yalnız sahip (alan eklenmez). `ice.restart` da multi1'de `from` taşır (K1b sözleşme eki).
 */
export function relayTechToGuest(room: Room, seat: Seat, m: TechRelay): void {
  const g = room.admitted?.peer;
  if (!g) return;
  if (!g.multi) {
    if (!seat.owner) return;
    if (m.t === "sdp.offer") g.send({ t: "sdp.offer", sdp: m.sdp });
    else if (m.t === "ice") g.send({ t: "ice", ...iceFields(m) });
    else g.send({ t: "ice.restart" });
    return;
  }
  const from = tidOf(room, seat.conn.userId);
  ensureGuestKnows(room, g, from);
  if (m.t === "ice.restart") g.send({ t: "ice.restart", from });
  else if (m.t === "sdp.offer") g.send({ t: "sdp.offer", sdp: m.sdp, from });
  else g.send({ t: "ice", ...iceFields(m), from });
}

type GuestRelay = Extract<GuestInboundFull, { t: "sdp.answer" | "ice" }>;

/** Misafir → teknisyen: multi1'de `to` yalnız odadaki bağlı tid'e (T9); bilinmeyen → düşer (log oda başına 1/dk). */
export function relayGuestToTech(rooms: Rooms, room: Room, m: GuestRelay): void {
  const to = "to" in m ? m.to : undefined;
  let target: TechConn | undefined = room.tech;
  if (to !== undefined) {
    const uid = userOfTid(room, to);
    target = uid === room.technicianId ? room.tech : uid ? room.multi.members.get(uid)?.conn : undefined;
    if (!target) {
      if (logOnce(room, "unknown_to", rooms.clock.now()))
        rooms.log.info({ event: "multi_unknown_to", sessionId: room.sessionId }, "bilinmeyen teknisyen hedefi; mesaj düştü");
      return;
    }
  }
  if (m.t === "sdp.answer") target?.peer.send({ t: "sdp.answer", sdp: m.sdp });
  else target?.peer.send({ t: "ice", ...iceFields(m) });
}

export { seatOf };
