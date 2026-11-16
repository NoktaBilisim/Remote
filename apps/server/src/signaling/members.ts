// P28c çoklu teknisyen oda çekirdeği (mimari-p28c r2 §1.1, §3.1, §4.4; ADR-0035; AC-365, 366). Bellekte (ADR-0005). Burada
// yalnız saf oda okuma/yayın yardımcıları: opak `tid` üretimi, kontrol sahibi, soket → koltuk çözücü, roster, teknisyen
// yayınları. Üyelik yaşam döngüsü `member-life.ts`, komutlar `member-cmds.ts`. Müşteriye yalnız `tid` + ad gider (T10).
import { randomBytes } from "node:crypto";
import type { ServerOutbound } from "@remote/contracts/ws";
import { MAX_TECHS, ROSTER_NAME_MAX, type TechRole, type TechRosterEntry } from "@remote/contracts/ws-multi";
import type { Member, MultiRoom, Peer, Room, TechConn } from "./types.ts";

/** Oda içi opak kimlik: `crypto.randomBytes(8)` → base64url (11 karakter; türetilmez, D-PC-6). */
export const newTid = (): string => randomBytes(8).toString("base64url");

/** Yeni oda durumu: kontrol sahibi varsayılan oturum sahibi. */
export function newMulti(technicianId: string): MultiRoom {
  return {
    tids: new Map(),
    controllerId: technicianId,
    members: new Map(),
    invites: new Map(),
    removed: new Set(),
    cmdTimes: [],
    transferring: false,
    guestMulti: false,
    guestRosterTids: new Set(),
    logAt: new Map(),
  };
}

/** (oturum, kullanıcı) başına sabit tid; ilk istekte üretilir. */
export function tidOf(room: Room, userId: string): string {
  let t = room.multi.tids.get(userId);
  if (!t) {
    t = newTid();
    room.multi.tids.set(userId, t);
  }
  return t;
}

/** tid → userId (yalnız sahip ve üyeler arasında; T9: başka odanın kimliği çözülmez). */
export function userOfTid(room: Room, tid: string): string | undefined {
  if (tidOf(room, room.technicianId) === tid) return room.technicianId;
  for (const m of room.multi.members.values()) if (room.multi.tids.get(m.userId) === tid) return m.userId;
  return undefined;
}

/** Kontrol sahibinin bağlı soketi (sahip ya da üye); kopuksa undefined. P28 §0 madde 8 genişleme noktası. */
export function controllerOf(room: Room): TechConn | undefined {
  const id = room.multi.controllerId;
  if (id === room.technicianId) return room.tech;
  return room.multi.members.get(id)?.conn;
}

/** Teknisyen soketinin odadaki koltuğu: sahip mi, hangi üye. Odaya ait değilse null. */
export interface Seat {
  conn: TechConn;
  owner: boolean;
  member?: Member;
}
export function seatOf(room: Room, peer: Peer): Seat | null {
  if (room.tech?.peer === peer) return { conn: room.tech, owner: true };
  for (const m of room.multi.members.values()) if (m.conn?.peer === peer) return { conn: m.conn, owner: false, member: m };
  return null;
}

/** Bağlı tüm teknisyen soketleri (sahip + bağlı üyeler). */
export function techConns(room: Room): TechConn[] {
  const out: TechConn[] = room.tech ? [room.tech] : [];
  for (const m of room.multi.members.values()) if (m.conn) out.push(m.conn);
  return out;
}

/** Tüm teknisyenlere (ICE yenileme, misafir katıldı/ayrıldı, paylaşım durumu, süre uyarısı, kayıt göstergesi). */
export function sendTechs(room: Room, msg: ServerOutbound): void {
  for (const c of techConns(room)) c.peer.send(msg);
}

/** Yalnız kontrol sahibine (kontrol durumu, pano/yazdırma sonucu, ortam, dosya sunucusu). */
export function sendController(room: Room, msg: ServerOutbound): void {
  controllerOf(room)?.peer.send(msg);
}

/** Koltuk sayımı (§3.1): sahip + üyeler + bekleyen davetler ≤ MAX_TECHS. */
export const seatsUsed = (room: Room): number => 1 + room.multi.members.size + room.multi.invites.size;
export const roomFull = (room: Room): boolean => seatsUsed(room) >= MAX_TECHS;

/** Soketin `hello.techRole`'u. */
export function techRoleOf(room: Room, conn: TechConn): TechRole {
  if (room.tech === conn) return "owner";
  return room.multi.members.get(conn.userId)?.role ?? "observer";
}

const nameOf = (s: string): string => s.trim().slice(0, ROSTER_NAME_MAX) || "Teknisyen";

/**
 * Roster (§4.4; değişmezler `techRosterSchema`): sahip her zaman (kopukken `connected:false`), üyeler ilk WS katılımından
 * sonra. Tam bir sahip, tam bir kontrol sahibi (kontrol sahibi yalnız sahip ya da katılmış üye olabilir — member-life korur).
 */
export function rosterOf(room: Room): TechRosterEntry[] {
  const ctl = room.multi.controllerId;
  const out: TechRosterEntry[] = [
    {
      tid: tidOf(room, room.technicianId),
      name: nameOf(room.technicianName),
      role: ctl === room.technicianId ? "controller" : "participant",
      owner: true,
      connected: Boolean(room.tech),
    },
  ];
  for (const m of room.multi.members.values()) {
    if (!m.joinedAudited) continue;
    out.push({
      tid: tidOf(room, m.userId),
      name: nameOf(m.fullName),
      role: ctl === m.userId ? "controller" : m.role,
      owner: false,
      connected: Boolean(m.conn),
    });
  }
  return out;
}

/** Misafir soketi `rs.cap.multi1` bildirdi mi (yoksa son bağlı soketin değeri). */
export const guestMulti = (room: Room): boolean => room.admitted?.peer?.multi ?? room.multi.guestMulti;

/** Roster'ı yalnız multi1 misafire gönderir ve gönderilen tid kümesini tutar (Y-PC-4 sırası). */
export function sendRosterToGuest(room: Room): void {
  const g = room.admitted?.peer;
  if (!g?.multi) return;
  const techs = rosterOf(room);
  g.send({ t: "techs.roster", techs });
  room.multi.guestRosterTids = new Set(techs.map((e) => e.tid));
  room.multi.guestRosterPeer = g;
}

/** Her üyelik/rol/bağlantı değişiminde olay anında (≤ 2 sn, AC-366): tüm teknisyenler + multi1 misafir. */
export function broadcastRoster(room: Room): void {
  const techs = rosterOf(room);
  for (const c of techConns(room)) c.peer.send({ t: "techs.roster", techs });
  sendRosterToGuest(room);
}

/** Misafir bu tid'i içeren roster'ı (bu sokete) aldı mı; almadıysa önce roster gider (offer sırası, Y-PC-4). */
export function ensureGuestKnows(room: Room, guest: Peer, tid: string): void {
  if (room.multi.guestRosterPeer === guest && room.multi.guestRosterTids.has(tid)) return;
  sendRosterToGuest(room);
}

/** Oda başına anahtar başına dakikada en çok bir log (bilinmeyen `to`, rol reddi). */
export function logOnce(room: Room, key: string, now: number): boolean {
  const at = room.multi.logAt.get(key);
  if (at !== undefined && now - at < 60_000) return false;
  room.multi.logAt.set(key, now);
  return true;
}
