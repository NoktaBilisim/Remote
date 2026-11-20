// Oda lobisi (mimari-protokol §1, §3.1; akış A1, P8b ön-kabul, P15 kabul kodu): TICKETED misafir ekleme, talep istemcisi
// ön-kabulü, yeniden bilet, LOBBY'ye geçiş ve lobiden çıkış. rooms.ts 300 satır sınırı nedeniyle ayrı (P27-K3 bölmesi;
// davranış değişmedi). `Rooms` sınıfı bu işlevlere ince sarmalayıcılarla devreder.
import { randomInt } from "node:crypto";
import type { GuestKind, SessionEndedReason } from "@remote/contracts/ws";
import { WS_CLOSE } from "@remote/contracts/ws";
import type { ClientOs } from "@remote/contracts/api/sessions";
import { AppError } from "../lib/errors.ts";
import { newId, sha256Hex } from "../lib/ids.ts";
import type { GuestConsent } from "../public/consent.ts";
import type * as repo from "../sessions/repo.ts";
import type { Rooms } from "./rooms.ts";
import { LOBBY_MAX, type Guest, type Peer, type Room } from "./types.ts";

export type RoomRow = Pick<repo.SignalSessionRow, "id" | "tenantId" | "technicianId" | "technician" | "expiresAt">;
export const admitHash = (guestId: string, code: string): string => sha256Hex(`${guestId}:${code}`);
const fourDigits = (): string => String(randomInt(0, 10_000)).padStart(4, "0");

export const pending = (g: Guest) =>
  ({ t: "peer.pending", guestId: g.id, name: g.name, guestKind: g.kind, since: new Date(g.since).toISOString() }) as const;

export interface AddGuestInput {
  name: string;
  email?: string;
  kind: GuestKind;
  ipKey: string;
  netKey?: string;
  clientVersion?: string;
  clientOs?: ClientOs;
  consent: GuestConsent;
}

export interface PreAdmitInput {
  requestId: string;
  /** P19 (§8c.2 m.5): AGENT (Windows istemcisi) | BROWSER (web talebi; oturum mode=BROWSER, input kanalı yok). */
  kind: GuestKind;
  name: string;
  email?: string;
  clientVersion: string | null;
  /** P31 (AC-511, D-2): talepteki beyan (`support_requests.client_os`); yoksa misafir `windows` sayılır. */
  clientOs?: ClientOs;
  consent: GuestConsent;
  acceptCode?: boolean;
}

export interface TicketOut {
  wsTicket: string;
  expiresAt: number;
  admitCode?: string;
}

/** Lobiye (TICKETED) misafir ekler — join (A1). Ret listesi → 403, lobi dolu → 409 LOBBY_FULL. */
export function addGuest(rooms: Rooms, row: RoomRow, g: AddGuestInput): { guestId: string; admitCode: string; wsTicket: string } {
  const room = rooms.getOrCreate(row);
  if (room.admitted) throw new AppError("SESSION_CONSUMED");
  if (room.rejectedIps.has(g.ipKey))
    throw new AppError("FORBIDDEN", { message: "Bu oturuma katılımınız teknisyen tarafından reddedildi." });
  if (room.lobby.size >= LOBBY_MAX) throw new AppError("LOBBY_FULL");
  const id = newId();
  // Lobide kod tekil olmalı: aksi halde teknisyenin girdiği kod iki misafirle eşleşebilir.
  const taken = (c: string): boolean => [...room.lobby.values()].some((o) => o.admitHash === admitHash(o.id, c));
  let code = fourDigits();
  while (taken(code)) code = fourDigits();
  const guest: Guest = {
    id,
    name: g.name,
    ...(g.email ? { email: g.email } : {}),
    kind: g.kind,
    ipKey: g.ipKey,
    ...(g.netKey ? { netKey: g.netKey } : {}),
    ...(g.clientVersion ? { clientVersion: g.clientVersion } : {}),
    ...(g.clientOs ? { clientOs: g.clientOs } : {}),
    admitHash: admitHash(id, code),
    consent: g.consent,
    state: "TICKETED",
    since: rooms.clock.now(),
  };
  guest.timer = rooms.clock.setTimeout(() => {
    if (guest.state === "TICKETED" && room.lobby.get(id) === guest) rooms.dropRoomIfIdle(room, id);
  }, rooms.timing.ticketMs);
  room.lobby.set(id, guest);
  const { token } = rooms.tickets.issue({ sessionId: row.id, guestId: id });
  return { guestId: id, admitCode: code, wsTicket: token };
}

/**
 * P8b ön-kabul (mimari-e9 §3.4 commit sonrası, mimari-protokol §5.2): kabul edilen talebin istemcisi için TICKETED misafir +
 * ticket. Lobi/admitCode yok; bağlama talep sırrıyla (ticket yalnız sır sahibinin /ws/request soketine iletilir). Ömür
 * talep servisinin 60 sn bağlanma zamanlayıcısına bağlıdır (oturum iptalinde oda kapanır).
 */
export function preAdmitGuest(rooms: Rooms, row: RoomRow, g: PreAdmitInput): TicketOut {
  const room = rooms.getOrCreate(row);
  room.requestId = g.requestId;
  // P15 (AC-239): kabul kodu açık → lobi + admitCode (yalnız müşteriye `request.accepted.admitCode` ile gider).
  let admitCode: string | undefined;
  if (g.acceptCode) {
    room.acceptCode = true;
    admitCode = fourDigits();
  }
  let guest = [...room.lobby.values()].find((x) => x.requestId === g.requestId);
  if (!guest) {
    guest = {
      id: newId(),
      name: g.name,
      ...(g.email ? { email: g.email } : {}),
      kind: g.kind,
      ipKey: "",
      admitHash: "",
      consent: g.consent,
      state: "TICKETED",
      since: rooms.clock.now(),
      requestId: g.requestId,
      ...(g.clientVersion !== null ? { clientVersion: g.clientVersion } : {}), // P19: WEB talebinde sürüm yok
      ...(g.clientOs ? { clientOs: g.clientOs } : {}),
      ticketGen: 0,
    };
    room.lobby.set(guest.id, guest);
  }
  if (admitCode) guest.admitHash = admitHash(guest.id, admitCode);
  guest.ticketGen = (guest.ticketGen ?? 0) + 1; // önceki ticket geçersiz (yeniden bağlanan /ws/request)
  const { token, expiresAt } = rooms.tickets.issue({ sessionId: row.id, guestId: guest.id, gen: guest.ticketGen });
  return { wsTicket: token, expiresAt, ...(admitCode ? { admitCode } : {}) };
}

/** Talep oturumu için yeniden ticket (oturum hâlâ PENDING; /ws/request yeniden bağlandı). Misafir yoksa null. */
export function reissueRequestTicket(rooms: Rooms, sessionId: string, requestId: string): TicketOut | null {
  const room = rooms.get(sessionId);
  const guest = room ? [...room.lobby.values()].find((x) => x.requestId === requestId && x.state === "TICKETED") : undefined;
  if (!room || !guest) return null;
  guest.ticketGen = (guest.ticketGen ?? 0) + 1;
  const { token, expiresAt } = rooms.tickets.issue({ sessionId, guestId: guest.id, gen: guest.ticketGen });
  // P15 (AC-239): düz kod saklanmaz → yeniden bağlanan istemciye yeni kod (misafir henüz lobide değil).
  if (!room.acceptCode) return { wsTicket: token, expiresAt };
  const admitCode = fourDigits();
  guest.admitHash = admitHash(guest.id, admitCode);
  return { wsTicket: token, expiresAt, admitCode };
}

/** Ticket ile gelen misafir → LOBBY (lobby.wait + teknisyene peer.pending). */
export function attachGuest(rooms: Rooms, room: Room, guest: Guest, peer: Peer): void {
  rooms.clock.clearTimeout(guest.timer);
  guest.state = "LOBBY";
  room.lobbyArrivals++; // P13b-L: monoton geliş sayacı (signaling/lobby-count.ts)
  guest.peer = peer;
  guest.since = rooms.clock.now();
  const expiresAt = guest.since + rooms.timing.lobbyMs;
  guest.timer = rooms.clock.setTimeout(() => leaveLobby(rooms, room, guest, "timeout", "lobby_timeout"), rooms.timing.lobbyMs);
  peer.send({ t: "lobby.wait", expiresAt: new Date(expiresAt).toISOString() });
  room.tech?.peer.send(pending(guest));
}

/** Lobiden çıkış: misafire (gerekirse) session.ended, teknisyene peer.pending.left. */
export function leaveLobby(rooms: Rooms, room: Room, guest: Guest, why: "left" | "timeout" | "rejected", ended?: SessionEndedReason): void {
  if (room.lobby.get(guest.id) !== guest) return;
  rooms.clock.clearTimeout(guest.timer);
  room.lobby.delete(guest.id);
  if (ended) {
    guest.peer?.send({ t: "session.ended", reason: ended });
    guest.peer?.close(WS_CLOSE.NORMAL, ended);
  }
  if (guest.state === "LOBBY") room.tech?.peer.send({ t: "peer.pending.left", guestId: guest.id, reason: why });
  rooms.dropRoomIfIdle(room);
}
