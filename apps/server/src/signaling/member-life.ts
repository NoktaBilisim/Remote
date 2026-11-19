// P28c üyelik yaşam döngüsü (mimari-p28c r2 §5.1 adım 5, §5.3, §5.4, §6.2; AC-366, 367, 369, 370; Y-PC-1/2/3, O-PC-3).
// Rezervasyon (60 sn) → ilk WS (audit + dört göz) → kopma payı (120 sn) → ayrılma. Tek geri alma yolu `revokeMember`; üyenin
// kimlik oturumu düşmesi odayı bitirmez. Kontrol sahibi değişimi tek yoldan (`setController`): kontrol kapanır, kaydedici devri.
import { CONTROL_AUDIT, type MultiLeaveReason } from "@remote/contracts/audit";
import { WS_CLOSE } from "@remote/contracts/ws";
import { MEMBER_GRACE_MS, MEMBER_RESERVE_MS, type MemberRole, type MemberVia } from "@remote/contracts/ws-multi";
import type { ConsentMode } from "@remote/contracts/unattended-consent";
import type { AuditContext } from "../audit/service.ts";
import { sendHelloTech } from "./active.ts";
import { onControlClosed } from "./clip-print.ts";
import { closeState, recordClose, techActor } from "./control-record.ts";
import { revokeOnTechChange } from "./control-revoke.ts";
import { broadcastRoster, controllerOf, tidOf } from "./members.ts";
import { auditMulti, countInvite, MULTI_AUDIT, MULTI_SYSTEM_CTX, SYSTEM_ACTOR } from "./multi-audit.ts";
import { recRecorderChanged } from "./rec.ts";
import type { Rooms } from "./rooms.ts";
import type { Member, Peer, Room, TechConn } from "./types.ts";
import { voiceDropTalker, voiceSync, voiceTechAttached } from "./voice.ts";
import { auditHistorySent, chatTechHello } from "./chat.ts";

/** Silent odada dört göz e-postası kancası (routes-multi bağlar; `sendSilentNotice` `event: join|transfer`). */
export interface SilentJoinEvent {
  event: "join" | "transfer";
  room: Room;
  actor: { userId: string; email: string; fullName: string };
  role: MemberRole | "owner";
  reason?: string;
  ctx: AuditContext;
}

export interface ReserveInput {
  userId: string;
  username: string;
  fullName: string;
  role: MemberRole;
  via: MemberVia;
  authSessionId: string;
  reason?: string | undefined;
}

const consentModeOf = (room: Room): ConsentMode | undefined => room.unattended?.consentMode;

/** Çağıran §4.3 adım 9 senkron denetimini AYNI senkron adımda yaptı (arada `await` yok). Rezervasyon 60 sn. */
export function reserveMember(rooms: Rooms, room: Room, i: ReserveInput): Member {
  tidOf(room, i.userId);
  const m: Member = {
    userId: i.userId,
    username: i.username,
    fullName: i.fullName,
    role: i.role,
    via: i.via,
    joinedAudited: false,
    authSessionId: i.authSessionId,
    ...(i.reason !== undefined ? { reasonLen: i.reason.length, silentReason: i.reason } : {}),
  };
  room.multi.members.set(i.userId, m);
  m.timer = rooms.clock.setTimeout(() => {
    m.timer = undefined;
    if (rooms.live(room) && room.multi.members.get(m.userId) === m && !m.conn) leaveMember(rooms, room, m.userId, "no_show");
  }, MEMBER_RESERVE_MS);
  return m;
}

/** Üye WS'si açıldı (ws-auth §4.3 `ws` evresi geçti). İlk katılımda audit + (silent) dört göz; hello + roster. */
export function attachMember(rooms: Rooms, room: Room, m: Member, conn: TechConn): void {
  const old = m.conn;
  rooms.clock.clearTimeout(m.timer);
  m.timer = undefined;
  m.conn = conn;
  if (old) {
    old.peer.close(WS_CLOSE.REPLACED, "replaced");
    voiceDropTalker(room, m.userId); // P28d V-PD-5
    if (old.connId) rooms.rec?.dropUploadTokens({ by: "conn", connId: old.connId });
  }
  const first = !m.joinedAudited;
  if (!m.joinedAudited) {
    m.joinedAudited = true;
    const cm = consentModeOf(room);
    const silent = cm === "silent";
    // Güvenlik P22-Q S-P22-Q-1: katılım audit'i HEMEN (geçmiş okumasını beklemez); geçmiş sayısı ayrı satır (`chat_history_sent`).
    void auditMulti(
      rooms,
      room,
      conn.ctx,
      techActor(conn),
      m.via === "supervise" ? MULTI_AUDIT.SUPERVISE_JOIN : MULTI_AUDIT.PARTICIPANT_JOIN,
      {
        userId: m.userId,
        role: m.role,
        ...(cm ? { consentMode: cm } : {}),
        ...(silent && m.reasonLen !== undefined ? { reasonLen: m.reasonLen } : {}),
        ...(silent && m.silentReason !== undefined ? { silentReason: m.silentReason } : {}),
      },
    );
    if (silent)
      rooms.silentNotify?.({
        event: "join",
        room,
        actor: { userId: m.userId, email: m.username, fullName: m.fullName },
        role: m.role,
        ...(m.silentReason !== undefined ? { reason: m.silentReason } : {}),
        ctx: conn.ctx,
      });
    delete m.silentReason; // gerekçe metni yalnız audit'te kalır
  }
  sendHelloTech(rooms, room, conn, false);
  // P22 r2 §15.5: ilk katılımda gönderilen geçmiş sayısı ayrı satır (n > 0); yeniden bağlanmada geçmiş yeniden gider, satır yok.
  const history = chatJoin(rooms, room, conn);
  if (first) void history.then((n) => auditHistorySent(rooms, room, conn, n));
  broadcastRoster(room);
  voiceTechAttached(rooms, room, conn); // P28d §4.2: roster'dan hemen sonra; yeni dinleyen yayınlanır (Y-PD-3)
}

/** P22: hello sonrası `chat.state` + `chat.history`; hata → 0. */
const chatJoin = (rooms: Rooms, room: Room, conn: TechConn): Promise<number> => chatTechHello(rooms, room, conn).catch(() => 0);

/** Üye soketi kapandı: kontrol sahibiyse kontrol sahibe döner; 120 sn payda dönmezse `participant_leave{disconnect}`. */
export function detachMember(rooms: Rooms, room: Room, userId: string, peer: Peer): void {
  const m = room.multi.members.get(userId);
  if (!rooms.live(room) || !m || m.conn?.peer !== peer) return;
  const conn = m.conn;
  m.conn = undefined;
  if (conn.connId) rooms.rec?.dropUploadTokens({ by: "conn", connId: conn.connId });
  if (room.multi.controllerId === userId) controllerLeft(rooms, room, conn);
  m.timer = rooms.clock.setTimeout(() => {
    m.timer = undefined;
    if (rooms.live(room) && room.multi.members.get(userId) === m && !m.conn) leaveMember(rooms, room, userId, "disconnect");
  }, MEMBER_GRACE_MS);
  broadcastRoster(room);
  voiceSync(rooms, room); // P28d V-PD-5: 120 sn pay üyeliği korur, sesi değil
}

/**
 * Üye odadan çıkar (ayrıldı / kopma payı doldu / rezervasyon düştü / yetki düştü). `close` verilirse bağlı soket kapanır.
 * `audit:false` → `participant_leave` yazılmaz (müşteri çıkarması `participant_remove` yazar).
 */
export function leaveMember(
  rooms: Rooms,
  room: Room,
  userId: string,
  reason: MultiLeaveReason,
  close?: { code: number; why: string },
  audit = true,
): void {
  const m = room.multi.members.get(userId);
  if (!m) return;
  room.multi.members.delete(userId);
  rooms.clock.clearTimeout(m.timer);
  const conn = m.conn;
  m.conn = undefined;
  if (conn?.connId) rooms.rec?.dropUploadTokens({ by: "conn", connId: conn.connId });
  if (room.multi.controllerId === userId) controllerLeft(rooms, room, conn);
  if (conn && close) conn.peer.close(close.code, close.why);
  if (audit && (m.joinedAudited || reason === "no_show"))
    void auditMulti(
      rooms,
      room,
      MULTI_SYSTEM_CTX,
      conn ? techActor(conn) : { userId: m.userId, username: m.username },
      MULTI_AUDIT.PARTICIPANT_LEAVE,
      {
        userId: m.userId,
        role: m.role,
        reason,
      },
    );
  if (rooms.live(room)) {
    broadcastRoster(room);
    voiceSync(rooms, room); // P28d: ayrıldı / çıkarıldı / revokeMember → konuşan kalmazsa `left`
  }
}

/**
 * TEK geri alma yolu (§2 "Üye geri alma", Y-PC-2, O-PC-3): kontrol sahibiyse sahibe döner, kayıt belirteçleri düşer, soket
 * 4403, `participant_leave{auth_revoked}`, roster. Oda bitmez. Üye değilse no-op (idempotent).
 */
export function revokeMember(rooms: Rooms, room: Room, userId: string): void {
  if (!room.multi.members.has(userId) || room.ending) return;
  leaveMember(rooms, room, userId, "auth_revoked", { code: WS_CLOSE.REMOVED, why: "removed" });
}

/** Kullanıcının üye olduğu tüm canlı odalarda `revokeMember` (süzgeç verilirse yalnız uyan odalar). */
export function revokeMemberEverywhere(rooms: Rooms, userId: string, where: (room: Room) => boolean = () => true): void {
  for (const room of [...rooms.values()])
    if (rooms.live(room) && room.multi.members.has(userId) && where(room)) revokeMember(rooms, room, userId);
}

/**
 * Kontrol sahibi değişir (§5.1 adım 1, §5.2, §6.2): açık/bekleyen kontrol `control.revoke` + REVOKED/TECH (`reason`) ile kapanır,
 * eski kontrol sahibine VIEW, kaydedici devri (eski belirteç hemen düşer). Audit'i çağıran yazar.
 */
export function setController(rooms: Rooms, room: Room, userId: string, by: TechConn | undefined, reason: "handover" | "transfer"): void {
  const old = controllerOf(room);
  if (room.multi.controllerId === userId) return;
  onControlClosed(rooms, room);
  room.control.monitorPending = undefined;
  const r = closeState(room.control);
  if (r) {
    room.admitted?.peer?.send({ t: "control.revoke", reason: "reconnect" }); // K0 sapma 8: mevcut neden; `handover` yalnız audit'te
    old?.peer.send({ t: "control.state", state: "VIEW", source: "SYSTEM" });
    rooms.metrics.inc("rs_control_total", { event: `revoke_${reason}` });
    if (r.opened && by)
      void recordClose(
        rooms,
        room,
        r.granting,
        { source: "TECH", action: CONTROL_AUDIT.REVOKED, ctx: by.ctx, actor: techActor(by), extra: { reason } },
        "control_revoke_audit_failed",
      );
  }
  room.multi.controllerId = userId;
  recRecorderChanged(rooms, room, old);
}

/** §5.1 adım 5: kontrol sahibi (sahip olmayan) koptu/ayrıldı → kontrol VIEW (K3), kontrol sahibe döner, audit system. */
function controllerLeft(rooms: Rooms, room: Room, conn: TechConn | undefined): void {
  const from = room.multi.controllerId;
  if (from === room.technicianId) return;
  if (room.admitted) revokeOnTechChange(rooms, room);
  room.multi.controllerId = room.technicianId;
  recRecorderChanged(rooms, room, conn);
  void auditMulti(rooms, room, MULTI_SYSTEM_CTX, SYSTEM_ACTOR, MULTI_AUDIT.CONTROL_HANDOVER, {
    fromUserId: from,
    toUserId: room.technicianId,
    reason: "controller_left",
  });
}

/** Oturum bitişi (teardown): üye soketleri (session.ended alır), zamanlayıcılar, `participant_leave{session_end}`, davetler. */
export function membersTeardown(rooms: Rooms, room: Room): Peer[] {
  const peers: Peer[] = [];
  for (const m of room.multi.members.values()) {
    rooms.clock.clearTimeout(m.timer);
    if (m.conn) peers.push(m.conn.peer);
    if (m.conn?.connId) rooms.rec?.dropUploadTokens({ by: "conn", connId: m.conn.connId });
    if (m.joinedAudited)
      void auditMulti(rooms, room, MULTI_SYSTEM_CTX, { userId: m.userId, username: m.username }, MULTI_AUDIT.PARTICIPANT_LEAVE, {
        userId: m.userId,
        role: m.role,
        reason: "session_end",
      });
  }
  room.multi.members.clear();
  for (const inv of room.multi.invites.values()) {
    rooms.clock.clearTimeout(inv.timer);
    countInvite(rooms, "expired");
    void auditMulti(rooms, room, MULTI_SYSTEM_CTX, SYSTEM_ACTOR, MULTI_AUDIT.INVITE_EXPIRE, {
      inviteeUserId: inv.userId,
      reason: "session_end",
    });
  }
  room.multi.invites.clear();
  return peers;
}
