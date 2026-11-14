// P13b-L bekleme odası (lobi) göstergesi servisi (mimari-lobi §4, ADR-0029; AC-305, 306, 309, 311, 314).
// Bellekteki odalardan okunur, DB'ye gidilmez, audit yazılmaz. Tenant ve teknisyen istemciden değil `auth`'tan gelir.
import type { SessionListItem, WaitingSessionsResponse } from "@remote/contracts/api/sessions";
import type { AuthContext } from "../auth/session.ts";
import { waitingFor, waitingIn, type LobbyRooms } from "../signaling/lobby-count.ts";

/** GET /sessions/waiting: yalnız `tenantId` (seçili firma) içindeki kendi oturumlarım (V-L2; ADMIN/Super Admin dahil). */
export function getWaitingSessions(rooms: LobbyRooms, auth: AuthContext, tenantId: string): WaitingSessionsResponse {
  const sessions = waitingFor(rooms, tenantId, auth.user.id);
  let count = 0;
  for (const s of sessions) count += s.waiting;
  return { count, sessions };
}

type ListBase = Omit<SessionListItem, "waitingGuests">;

/**
 * Liste yanıtına `waitingGuests` (AC-305): PENDING satırda lobiden, diğerlerinde 0. S13L-1: `sessions.view` yoksa (yalnız
 * `session_history.view`) her satır 0 — lobi sayısı geçmiş yetkisiyle okunamaz (AC-314).
 */
export function withWaitingGuests<T extends { items: ListBase[] }>(res: T, rooms: LobbyRooms, auth: AuthContext): Omit<T, "items"> & { items: SessionListItem[] } {
  const canSee = auth.permissions.has("sessions.view");
  return { ...res, items: res.items.map((i) => ({ ...i, waitingGuests: canSee && i.status === "PENDING" ? waitingIn(rooms, i.id) : 0 })) };
}
