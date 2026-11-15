/*
 * Misafir (müşteri tarayıcısı) durum makinesi — saf reducer (mimari-protokol §3.1, G-01).
 * connecting →(lobby.wait)→ lobby →(hello)→ live →(session.ended / kopma >120 sn)→ ended.
 * Yan etkiler (WS, RTCPeerConnection, getDisplayMedia) use-guest-session.ts'te.
 */
import { WS_CLOSE, type IceServer, type ServerOutbound } from "@remote/contracts/ws";

export type GuestEnd = "ended" | "rejected" | "lobbyTimeout" | "cancelled" | "expired" | "left" | "lost" | "error" | "resumeFailed";

export interface GuestState {
  phase: "connecting" | "lobby" | "live" | "ended";
  lobbyExpiresAt: string | null;
  share: "idle" | "sharing" | "stopped";
  /** Kopma anı (ms); null = bağlı. */
  reconnectSince: number | null;
  techPresent: boolean;
  maxEndsAt: string | null;
  warnEndsAt: string | null;
  reconnectToken: string | null;
  iceServers: IceServer[];
  end: GuestEnd | null;
  /** TEST-P4-1: sayfa yenilemesinden sonra `rs.reconnect.*` ile dönülüyor (hello gelene kadar). */
  resuming: boolean;
}

type GuestEvent =
  | { type: "msg"; m: ServerOutbound }
  | { type: "closed"; code: number; now: number }
  | { type: "share"; on: boolean }
  | { type: "giveUp" }
  | { type: "left" };

export const initialGuest: GuestState = {
  phase: "connecting",
  lobbyExpiresAt: null,
  share: "idle",
  reconnectSince: null,
  techPresent: false,
  maxEndsAt: null,
  warnEndsAt: null,
  reconnectToken: null,
  iceServers: [],
  end: null,
  resuming: false,
};

/** F5 sonrası dönüş: lobiye girmez, ilk mesaj `hello` beklenir (mimari-protokol §1). */
export const resumingGuest: GuestState = { ...initialGuest, resuming: true };

const endOf = (reason: string, phase: GuestState["phase"]): GuestEnd => {
  if (reason === "rejected") return "rejected";
  if (reason === "lobby_timeout") return "lobbyTimeout";
  if (reason === "cancelled") return "cancelled";
  if (reason === "timeout" && phase !== "live") return "expired";
  return "ended";
};

const finish = (s: GuestState, end: GuestEnd): GuestState => ({ ...s, phase: "ended", end, share: "idle", reconnectSince: null });

export function guestReducer(s: GuestState, e: GuestEvent): GuestState {
  if (s.phase === "ended") return s;
  switch (e.type) {
    case "left":
      return finish(s, "left");
    case "giveUp":
      return finish(s, "lost");
    case "share":
      return s.phase === "live" ? { ...s, share: e.on ? "sharing" : "stopped" } : s;
    case "closed":
      return onClosed(s, e.code, e.now);
    case "msg":
      return onMsg(s, e.m);
  }
}

function onClosed(s: GuestState, code: number, now: number): GuestState {
  // Dönüş reddedildi (403 → 1006, 4401 vb.): token geçersiz/oturum bitmiş → "zaten kullanıldı"
  if (s.resuming && s.phase === "connecting") return finish(s, "resumeFailed");
  if (code === WS_CLOSE.POLICY || code === WS_CLOSE.TOO_BIG) return finish(s, "error");
  // Yalnız kabul edilmiş misafir reconnectToken ile döner; lobide kopan ticket tek kullanımlıktır
  if (s.phase === "live" && s.reconnectToken) return { ...s, reconnectSince: s.reconnectSince ?? now };
  return finish(s, "lost");
}

function onMsg(s: GuestState, m: ServerOutbound): GuestState {
  switch (m.t) {
    case "lobby.wait":
      return { ...s, phase: "lobby", lobbyExpiresAt: m.expiresAt };
    case "hello":
      return {
        ...s,
        phase: "live",
        resuming: false,
        reconnectSince: null,
        techPresent: m.peerPresent,
        maxEndsAt: m.maxEndsAt,
        iceServers: m.iceServers,
        reconnectToken: m.reconnectToken ?? s.reconnectToken,
      };
    case "peer.joined":
      return m.role === "tech" ? { ...s, techPresent: true } : s;
    case "peer.left":
      return m.role === "tech" ? { ...s, techPresent: false } : s;
    case "ice.servers":
      return { ...s, iceServers: m.iceServers };
    case "session.warning":
      return { ...s, warnEndsAt: m.endsAt };
    case "session.ended":
      return finish(s, endOf(m.reason, s.phase));
    default:
      return s;
  }
}
