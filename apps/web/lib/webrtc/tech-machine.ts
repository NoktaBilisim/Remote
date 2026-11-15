/*
 * Teknisyen konsolu durum makinesi — saf reducer (mimari-protokol §3, §3.1).
 * connecting →(hello, PENDING)→ waiting [lobi: peer.pending ≤3] →(peer.joined)→ live →(session.ended)→ ended.
 * Kendi WS kopması: reconnectSince; 4401 auth iptali, 4409 başka sekme, 1008/1009 protokol → ended.
 */
import { describeShareFailure } from "@remote/contracts/labels";
import {
  SHARE_METHODS,
  WS_CLOSE,
  type GuestKind,
  type ServerOutbound,
  type SessionEndedReason,
  type ShareMethod,
} from "@remote/contracts/ws";

export interface Pending {
  guestId: string;
  name: string;
  guestKind: GuestKind;
  since: string;
}
export type TechEnd = SessionEndedReason | "replaced" | "protocol" | "lost";
/** Sunucu 5. hatalı kodda lobiyi boşaltır (mimari-protokol §3). */
export const MAX_ADMIT_ATTEMPTS = 5;
/** 3 retten sonra "kod sızmış olabilir" önerisi (§3.1). */
export const REJECT_SUGGEST = 3;

export interface TechState {
  phase: "connecting" | "waiting" | "live" | "ended";
  pending: Pending[];
  guest: { name: string | null; kind: GuestKind | null } | null;
  share: "unknown" | "sharing" | "stopped";
  /**
   * P15 (AC-234): istemcinin bildirdiği paylaşım hatası (`share.state.reason/method`) Türkçe etiketle; bilinmeyen kod
   * "Bilinmeyen neden (KOD)". 0.10.x istemci göndermez → null.
   */
  shareFail: string | null;
  /**
   * P17 (AC-248): paylaşım sürerken istemcinin bildirdiği yakalama yolu (`share.state{sharing, method}`). Konsol yalnız
   * `WGC`'de (pencere modu) mod rozetini gösterir; DXGI/GDI'da görünüm değişmez. Durunca / müşteri ayrılınca null.
   */
  shareMethod: ShareMethod | null;
  /** Müşteri bağlantısı koptu (ms). */
  peerLostSince: number | null;
  /** Kendi WS'imiz koptu (ms). */
  reconnectSince: number | null;
  maxEndsAt: string | null;
  warnEndsAt: string | null;
  admitBusy: boolean;
  admitName: string | null;
  wrongCodes: number;
  rejects: number;
  lastError: "ADMIT_CODE_INVALID" | "CONFLICT" | "OTHER" | null;
  end: TechEnd | null;
}

export type TechEvent =
  | { type: "msg"; m: ServerOutbound; now: number }
  | { type: "closed"; code: number; now: number }
  | { type: "admit" }
  | { type: "reject" }
  | { type: "giveUp" }
  | { type: "restoreName"; name: string | null };

export const initialTech: TechState = {
  phase: "connecting",
  pending: [],
  guest: null,
  share: "unknown",
  shareFail: null,
  shareMethod: null,
  peerLostSince: null,
  reconnectSince: null,
  maxEndsAt: null,
  warnEndsAt: null,
  admitBusy: false,
  admitName: null,
  wrongCodes: 0,
  rejects: 0,
  lastError: null,
  end: null,
};

/**
 * QA-P4-12: sunucu `hello{tech}` içinde misafir adını ve son paylaşım durumunu, `peer.joined{guest}` içinde adı
 * gönderebilir (opsiyonel alanlar). Sözleşme sürümünden bağımsız okunur; yoksa null.
 */
function extras(m: ServerOutbound): {
  guestName: string | null;
  share: "sharing" | "stopped" | null;
  shareFail: string | null;
  shareMethod: ShareMethod | null;
} {
  const x = m as { guestName?: unknown; share?: unknown };
  const guestName = typeof x.guestName === "string" && x.guestName.trim() ? x.guestName.slice(0, 100) : null;
  const sh = x.share && typeof x.share === "object" ? (x.share as { state?: unknown; reason?: unknown; method?: unknown }) : null;
  const st = sh?.state;
  const share = st === "sharing" || st === "stopped" ? st : null;
  return {
    guestName,
    share,
    shareFail: sh ? shareFailOf(sh.reason, sh.method) : null,
    shareMethod: share ? sharingMethodOf(share, sh?.method) : null,
  };
}

/** P17 (AC-248): yalnız `sharing` iken bilinen yöntem (`SHARE_METHODS`) tutulur; diğer her durumda null. */
export function sharingMethodOf(state: unknown, method: unknown): ShareMethod | null {
  if (state !== "sharing" || typeof method !== "string") return null;
  return (SHARE_METHODS as readonly string[]).includes(method) ? (method as ShareMethod) : null;
}

/** P15 (AC-234): `share.state.reason/method` → konsol metni (yalnız dize değerler; diğerleri yok sayılır). */
export function shareFailOf(reason: unknown, method: unknown): string | null {
  return describeShareFailure(typeof reason === "string" ? reason : null, typeof method === "string" ? method : null);
}

/** TEST-P4-2: `peer.joined{role:"guest", maxEndsAt?}` — sözleşme sürümünden bağımsız okunur; geçersizse null. */
function joinedMaxEndsAt(m: ServerOutbound): string | null {
  const v = (m as { maxEndsAt?: unknown }).maxEndsAt;
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}

const finish = (s: TechState, end: TechEnd): TechState => ({ ...s, phase: "ended", end, reconnectSince: null, admitBusy: false });

export function techReducer(s: TechState, e: TechEvent): TechState {
  if (s.phase === "ended") return s;
  switch (e.type) {
    case "admit":
      // Kabul edilen kişi kodla belirlenir; tek bekleyen varsa adı bilinir
      return { ...s, admitBusy: true, lastError: null, admitName: s.pending.length === 1 ? s.pending[0]!.name : null };
    case "reject":
      return { ...s, rejects: s.rejects + 1 };
    case "giveUp":
      return finish(s, "lost");
    case "restoreName":
      // Konsol yenilendiğinde protokol adı yeniden göndermez (hello/peer.joined'da ad yok); sekme belleğinden
      return s.guest && !s.guest.name && e.name ? { ...s, guest: { ...s.guest, name: e.name } } : s;
    case "closed":
      if (e.code === WS_CLOSE.AUTH_REVOKED) return finish(s, "auth_revoked");
      if (e.code === WS_CLOSE.REPLACED) return finish(s, "replaced");
      if (e.code === WS_CLOSE.POLICY || e.code === WS_CLOSE.TOO_BIG) return finish(s, "protocol");
      return { ...s, reconnectSince: s.reconnectSince ?? e.now, admitBusy: false };
    case "msg":
      return onMsg(s, e.m, e.now);
  }
}

function onMsg(s: TechState, m: ServerOutbound, now: number): TechState {
  switch (m.t) {
    case "hello": {
      const active = m.maxEndsAt !== null;
      const x = extras(m);
      const prev = s.guest ?? { name: null, kind: m.guestKind ?? null };
      return {
        ...s,
        phase: active ? "live" : "waiting",
        reconnectSince: null,
        maxEndsAt: m.maxEndsAt,
        guest: active ? { ...prev, name: x.guestName ?? prev.name } : null,
        peerLostSince: active && !m.peerPresent ? (s.peerLostSince ?? now) : null,
        share: active && m.peerPresent && x.share ? x.share : s.share,
        shareFail: active && m.peerPresent && x.share ? x.shareFail : s.shareFail,
        shareMethod: active && m.peerPresent && x.share ? x.shareMethod : s.shareMethod,
      };
    }
    case "peer.pending":
      if (s.pending.some((p) => p.guestId === m.guestId)) return s;
      return { ...s, pending: [...s.pending, { guestId: m.guestId, name: m.name, guestKind: m.guestKind, since: m.since }] };
    case "peer.pending.left":
      return { ...s, pending: s.pending.filter((p) => p.guestId !== m.guestId) };
    case "peer.joined":
      if (m.role !== "guest") return s;
      return {
        ...s,
        phase: "live",
        pending: [],
        admitBusy: false,
        lastError: null,
        // Ad önce sunucudan; yoksa yalnız tek bekleyen varken kabul edilenin adı (tahmin yok), yoksa "Müşteri"
        guest: { name: extras(m).guestName ?? s.guest?.name ?? s.admitName, kind: m.guestKind ?? s.guest?.kind ?? null },
        peerLostSince: null,
        share: "unknown",
        shareFail: null,
        shareMethod: null,
        // TEST-P4-2: canlı kabulde kalan süre sayacı sunucunun bildirdiği üst sınırla başlar (opsiyonel alan)
        maxEndsAt: joinedMaxEndsAt(m) ?? s.maxEndsAt,
      };
    case "peer.left":
      if (m.role !== "guest" || s.phase !== "live") return s;
      return { ...s, peerLostSince: s.peerLostSince ?? now, share: "unknown", shareFail: null, shareMethod: null };
    case "share.state":
      return { ...s, share: m.state, shareFail: shareFailOf(m.reason, m.method), shareMethod: sharingMethodOf(m.state, m.method) };
    case "session.warning":
      return { ...s, warnEndsAt: m.endsAt };
    case "session.ended":
      return finish(s, m.reason);
    case "error":
      if (m.code === "ADMIT_CODE_INVALID") return { ...s, admitBusy: false, wrongCodes: s.wrongCodes + 1, lastError: "ADMIT_CODE_INVALID" };
      return { ...s, admitBusy: false, lastError: m.code === "CONFLICT" ? "CONFLICT" : "OTHER" };
    default:
      return s;
  }
}

/**
 * İlk teklif kapısı (TURN'süz ilk teklif düzeltmesi): teknisyen PENDING hello'sunda ICE listesi boştur (G-01),
 * TURN/STUN admit sonrası `ice.servers` ile gelir. `peer.joined` bundan önce gelirse teklif ertelenir ve ilk
 * `ice.servers` ile başlatılır. Teklif sonrası peer'i yeniden kurmak yerine ertelemek seçildi: eski teklifin
 * yanıtı (`sdp.answer`) yeni peer'e düşüp yarış yaratamaz. `ready`: bu WS bağlantısında admit sonrası ICE alındı
 * (ACTIVE hello veya `ice.servers`); TURN yapılandırılmamışsa liste boş olsa da hazır sayılır.
 */
export interface IceGate {
  ready: boolean;
  pending: boolean;
}
export const initialIceGate: IceGate = { ready: false, pending: false };

export function iceGate(g: IceGate, m: ServerOutbound): { gate: IceGate; start: boolean } {
  switch (m.t) {
    case "hello": {
      const ready = m.maxEndsAt !== null;
      return { gate: { ready, pending: false }, start: ready && m.peerPresent };
    }
    case "ice.servers":
      return { gate: { ready: true, pending: false }, start: g.pending };
    case "peer.joined":
      if (m.role !== "guest") return { gate: g, start: false };
      return g.ready ? { gate: g, start: true } : { gate: { ready: false, pending: true }, start: false };
    case "peer.left":
      return m.role === "guest" ? { gate: { ...g, pending: false }, start: false } : { gate: g, start: false };
    default:
      return { gate: g, start: false };
  }
}
