// Sinyalizasyon bellek içi durumu (mimari §3.5, ADR-0005 tek instance): oda, lobi misafiri, teknisyen
// bağlantısı ve saat. DB'ye yazılmaz; süreç yeniden başlarsa ACTIVE oturumlar ENDED{server} yapılır.
import type { Cap, GuestKind, ServerOutbound, ShareSnapshot } from "@remote/contracts/ws";
import type { PermissionKey } from "@remote/contracts/permissions";
import type { AuditContext } from "../audit/service.ts";
import type { GuestConsent } from "../public/consent.ts";

/** Bir WS bağlantısının odadaki temsili; testler sahte Peer ile ağsız çalışır. */
export interface Peer {
  send(msg: ServerOutbound): void;
  close(code: number, reason: string): void;
  /** Soket OPEN mı (CLOSING/CLOSED değil) — reconnect çakışma kararı için (TEST-P4-1). */
  isOpen(): boolean;
}

/** Zamanlayıcı soyutlaması: üretimde gerçek saat, testlerde elle ilerletilen sahte saat (AC-13, AC-25). */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export type GuestState = "TICKETED" | "LOBBY" | "ADMITTED";

export interface Guest {
  id: string;
  name: string;
  kind: GuestKind;
  ipKey: string;
  /** sha256(guestId:admitCode) — düz kod bellekte de tutulmaz. */
  admitHash: string;
  /** Join anında onaylanan KVKK metni; admit TX'inde session_consents'e yazılır (P4, AC-29). */
  consent: GuestConsent;
  state: GuestState;
  since: number;
  peer?: Peer;
  timer?: unknown;
}

export interface TechConn {
  peer: Peer;
  userId: string;
  username: string;
  /** /ws/tech 60 sn yeniden doğrulaması için çerez değeri (yalnız bellekte; loglanmaz). */
  authToken: string;
  permissions: ReadonlySet<PermissionKey>;
  ctx: AuditContext;
}

export interface Room {
  sessionId: string;
  tenantId: string;
  technicianId: string;
  technicianName: string;
  /** PENDING bitiş anı (ms); ret/hatalı kod durumu taşıyan boş oda en geç bu anda bellekten silinir (S-P3-4). */
  expiresAt: number;
  tech?: TechConn;
  /** TICKETED + LOBBY misafirler (≤ 3). */
  lobby: Map<string, Guest>;
  admitted?: Guest;
  admitting: boolean;
  admitFails: number;
  rejectedIps: Set<string>;
  reconnectHash?: string;
  maxEndsAt?: number;
  caps: Cap[];
  /** Misafirden gelen son `share.state` (QA-P4-12): teknisyen yeniden bağlanınca hello'da gönderilir; misafir ayrılınca "stopped". */
  share?: ShareSnapshot;
  timers: { disconnect?: unknown; warn?: unknown; maxEnd?: unknown; iceRefresh?: unknown; idle?: unknown };
  ending: boolean;
}

/** Süreler (ms). Testler kısaltabilir; varsayılanlar mimari-protokol değerleri. */
export interface Timing {
  lobbyMs: number;
  reconnectMs: number;
  ticketMs: number;
  nonceMs: number;
  warnBeforeMs: number;
  iceRefreshBeforeMs: number;
}

export const DEFAULT_TIMING: Timing = {
  lobbyMs: 5 * 60_000,
  reconnectMs: 120_000,
  ticketMs: 60_000,
  nonceMs: 60_000,
  warnBeforeMs: 5 * 60_000,
  iceRefreshBeforeMs: 5 * 60_000,
};

export const LOBBY_MAX = 3;
export const ADMIT_FAIL_MAX = 5;
