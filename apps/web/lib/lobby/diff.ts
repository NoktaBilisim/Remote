import type { WaitingSessionsResponse } from "@remote/contracts/api/sessions";

/*
 * Lobi toast tekilleştirmesi (P13b-L, mimari-lobi §6.3, AC-307) — misafir kimliği olmadan. Yanıt yalnız sayı taşır
 * (AC-311); "yeni gelen" oda başına monoton `arrivals` farkından anlaşılır. Saf fonksiyon: bileşen `prev`'i tutar.
 */
export type LobbySession = WaitingSessionsResponse["sessions"][number];
export type LobbyPrev = ReadonlyMap<string, { waiting: number; arrivals: number }>;

interface LobbyToast {
  /** Bu turda yeni gelen ve hâlâ bekleyen misafir sayısı (≥ 1). */
  n: number;
  /** Yanıtta bekleyeni olan tek oturum → o oturumun konsolu; birden çok → oturum listesi. */
  target: { kind: "console"; id: string } | { kind: "list" };
}

export function toPrev(sessions: readonly LobbySession[]): Map<string, { waiting: number; arrivals: number }> {
  return new Map(sessions.map((s) => [s.id, { waiting: s.waiting, arrivals: s.arrivals }]));
}

/** `/sessions/{id}/console` yolundaki oturum kimliği; başka yolda null. */
export function consoleSessionId(pathname: string): string | null {
  return pathname.match(/^\/sessions\/([^/]+)\/console$/)?.[1] ?? null;
}

/**
 * `prev === null` → temel çizgi (sayfa yüklenirken zaten bekleyenler): toast yok (V-L6).
 * Oturum başına: arrivals küçüldüyse (oda yeniden yaratıldı / sunucu yeniden başladı) tamamı yeni sayılır;
 * gelip giden misafir toast üretmez (`min(yeni, waiting)`); açık konsoldaki oturum sayılmaz.
 */
export function lobbyToast(prev: LobbyPrev | null, sessions: readonly LobbySession[], openConsoleId: string | null): LobbyToast | null {
  if (prev === null) return null;
  let n = 0;
  for (const s of sessions) {
    if (s.id === openConsoleId) continue;
    const before = prev.get(s.id) ?? { waiting: 0, arrivals: 0 };
    const fresh = s.arrivals >= before.arrivals ? s.arrivals - before.arrivals : s.arrivals;
    n += Math.min(fresh, s.waiting);
  }
  if (n <= 0) return null;
  const waitingSessions = sessions.filter((s) => s.waiting >= 1);
  const only = waitingSessions.length === 1 ? waitingSessions[0] : undefined;
  return { n, target: only ? { kind: "console", id: only.id } : { kind: "list" } };
}
