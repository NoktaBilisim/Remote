// P13b-L bekleme odası sayımı (mimari-lobi §3; AC-305, 309, 315). Bellekteki odalardan okunur; DB yok.
// Bekleyen misafir = `state === "LOBBY"` (TICKETED ve talepten ön-kabullü sayılmaz); oda `!ending && !admitted &&
// expiresAt > now` olmalı. `Rooms` yapısal olarak `LobbyRooms`'u sağlar (rooms.ts boyutu büyümesin diye ayrı modül).
import type { Clock, Room } from "./types.ts";

export interface LobbyRooms {
  readonly clock: Clock;
  get(sessionId: string): Room | undefined;
  values(): Iterable<Room>;
}

interface WaitingSession {
  id: string;
  waiting: number;
  arrivals: number;
}

function lobbyWaiting(room: Room, now: number): number {
  if (room.ending || room.admitted || room.expiresAt <= now) return 0;
  let n = 0;
  for (const g of room.lobby.values()) if (g.state === "LOBBY") n++;
  return n;
}

/** Odadaki bekleyen misafir sayısı (0..LOBBY_MAX); oda yoksa 0. */
export function waitingIn(rooms: LobbyRooms, sessionId: string): number {
  const room = rooms.get(sessionId);
  return room ? lobbyWaiting(room, rooms.clock.now()) : 0;
}

/** Yalnız `tenantId` + `technicianId` eşleşen, bekleyeni olan odalar; `id`'ye göre sıralı (AC-309). */
export function waitingFor(rooms: LobbyRooms, tenantId: string, technicianId: string): WaitingSession[] {
  const now = rooms.clock.now();
  const out: WaitingSession[] = [];
  for (const room of rooms.values()) {
    if (room.tenantId !== tenantId || room.technicianId !== technicianId) continue;
    const waiting = lobbyWaiting(room, now);
    if (waiting > 0) out.push({ id: room.sessionId, waiting, arrivals: room.lobbyArrivals });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
