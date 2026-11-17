/*
 * P28d konsol sesli görüşme durumu — saf reducer + görünüm kararı (mimari-p28d r2 §4.2, §4.3, §8; AC-373, 374, 378, 379).
 * Sunucu durumu yalnız `voice.state`'ten okunur (`callId` buradan). WS `error{code}` istek kimliği taşımaz: yalnız bekleyen
 * yerel istek varken (mikrofon izni alınıyor / `voice.request` ya da `voice.join` gönderildi) gelen hata sese atfedilir ve
 * kapalı-güvenli sonuçlanır (mikrofon bırakılır). Mikrofon kararı `micWanted`: bu kümenin dışında her an `releaseMic()`.
 */
import type { WsErrorCode } from "@remote/contracts/ws";
import { VOICE_DENY_COOLDOWN_MS, VOICE_REQUEST_TIMEOUT_MS, type VoiceStateMessage } from "@remote/contracts/ws-voice";

/** Yerel istek aşaması: `mic` = izin/aygıt bekleniyor (istek henüz gitmedi), `sent` = istek gitti, `joining` = katıl. */
export type VoiceLocal = "idle" | "mic" | "sent" | "joinMic" | "joining";

/** Kullanıcıya kalan bilgi; `until` = bekleme süresi sonu (düğme o ana dek pasif). */
export type VoiceNoticeKind =
  "rejected" | "timeout" | "customerEnded" | "deviceEnded" | "micDenied" | "conflict" | "rateLimited" | "forbidden" | "unsupported";
export interface VoiceNotice {
  kind: VoiceNoticeKind;
  until: number | null;
}

/** Biten görüşme (toast): önceki faz + neden + süre (yalnız etkin görüşmede). */
export interface VoiceEnded {
  callId: string;
  wasPhase: "pending" | "active";
  reason: NonNullable<VoiceStateMessage["endReason"]>;
  durationSec: number | null;
  mine: boolean;
}

export interface ConsoleVoice {
  call: VoiceStateMessage | null;
  /** Yerel saat: pending başlangıcı (geri sayım) / active başlangıcı (süre). */
  since: number | null;
  local: VoiceLocal;
  notice: VoiceNotice | null;
  muted: boolean;
  ended: VoiceEnded | null;
}

export const initialConsoleVoice: ConsoleVoice = { call: null, since: null, local: "idle", notice: null, muted: false, ended: null };

export type ConsoleVoiceEvent =
  | { type: "state"; m: VoiceStateMessage; me: string | null; now: number }
  | { type: "error"; code: WsErrorCode; now: number }
  | { type: "local"; local: VoiceLocal }
  | { type: "micDenied" }
  | { type: "mute"; on: boolean }
  | { type: "closed" };

const ERR: Partial<Record<WsErrorCode, VoiceNoticeKind>> = {
  CONFLICT: "conflict",
  RATE_LIMITED: "rateLimited",
  FORBIDDEN: "forbidden",
  CLIENT_UNSUPPORTED: "unsupported",
};

/** Bitişte bekleme süresi başlatan nedenler (D-PD-2): pending'de ret / zaman aşımı, active'de müşteri ya da aygıt. */
function endNotice(prev: VoiceStateMessage | null, m: VoiceStateMessage, now: number): VoiceNotice | null {
  const until = now + VOICE_DENY_COOLDOWN_MS;
  if (m.endReason === "timeout") return { kind: "timeout", until };
  if (m.endReason === "customer") return { kind: prev?.phase === "pending" ? "rejected" : "customerEnded", until };
  if (m.endReason === "device") return { kind: "deviceEnded", until };
  return null;
}

function onState(s: ConsoleVoice, m: VoiceStateMessage, me: string | null, now: number): ConsoleVoice {
  const prev = s.call;
  const same = prev?.callId !== undefined && prev.callId === m.callId;
  if (m.phase === "idle") {
    const live = prev && prev.phase !== "idle" && (m.callId === undefined || same);
    const ended: VoiceEnded | null =
      live && m.endReason && prev.callId
        ? {
            callId: prev.callId,
            wasPhase: prev.phase as "pending" | "active",
            reason: m.endReason,
            durationSec: prev.phase === "active" && s.since !== null ? Math.round((now - s.since) / 1000) : null,
            mine: prev.by === me || (me !== null && prev.listeners.includes(me)),
          }
        : s.ended;
    const notice = live ? (endNotice(prev, m, now) ?? s.notice) : s.notice;
    return { ...s, call: m, since: null, local: "idle", muted: false, ended, notice };
  }
  const since = same && prev.phase === m.phase ? s.since : now;
  const talking = me !== null && m.phase === "active" && m.talkers.includes(me);
  const acked = (m.phase === "pending" && m.by === me) || talking;
  // Kendi isteğim/katılımım onaylandı → yerel aşama biter; başka teknisyenin isteği `sent`'i bozmaz (yanıt hata olarak gelir)
  const local = acked && s.local !== "idle" ? "idle" : s.local;
  return { ...s, call: m, since, local, muted: talking ? s.muted : false, notice: acked ? null : s.notice };
}

export function consoleVoiceReducer(s: ConsoleVoice, e: ConsoleVoiceEvent): ConsoleVoice {
  switch (e.type) {
    case "state":
      return onState(s, e.m, e.me, e.now);
    case "error": {
      // Bekleyen ses isteği yokken gelen hata başka bir işe aittir (kontrol, lobi …)
      if (s.local !== "sent" && s.local !== "joining") return s;
      const kind = ERR[e.code] ?? "forbidden";
      const until = kind === "rateLimited" ? e.now + VOICE_DENY_COOLDOWN_MS : null;
      return { ...s, local: "idle", notice: { kind, until } };
    }
    case "local":
      return { ...s, local: e.local, notice: e.local === "idle" ? s.notice : null };
    case "micDenied":
      return { ...s, local: "idle", notice: { kind: "micDenied", until: null } };
    case "mute":
      return { ...s, muted: e.on };
    case "closed":
      // Kendi WS'imiz koptu: sunucu durumu bilinmez; "Mikrofon açık" kopukluktan sonra kalmaz (D-PD-5)
      return { ...initialConsoleVoice, notice: s.notice };
  }
}

/** Mikrofon tutulmalı mı: yerel istek sürüyor ya da (pending ve isteyen benim) ya da (active ve konuşanlardanım). */
export function micWanted(s: ConsoleVoice, me: string | null): boolean {
  if (s.local !== "idle") return true;
  const c = s.call;
  if (!c || me === null) return false;
  return (c.phase === "pending" && c.by === me) || (c.phase === "active" && c.talkers.includes(me));
}

/** Mikrofon izi eşe bağlanmalı mı (`replaceTrack(track)`): yalnız `talkers ∋ benim tid` (§4.3). */
export const micLive = (s: ConsoleVoice, me: string | null): boolean =>
  me !== null && s.call?.phase === "active" && s.call.talkers.includes(me);

/** Uzak ses çalınmalı mı: görüşme etkin ve ben `listeners` içindeyim (Y-PD-3; müşteri de yalnız listeners'a gönderir). */
export const shouldListen = (s: ConsoleVoice, me: string | null): boolean =>
  me !== null && s.call?.phase === "active" && s.call.listeners.includes(me);

export interface VoiceCtx {
  me: string | null;
  observer: boolean;
  canVoice: boolean;
  /** `hello`/`peer.joined` `guestVoice` (null = alan yok → kabul edilmiş misafir yok). */
  guestVoice: boolean | null;
  unattended: boolean;
  /** Canlı, müşteri bağlı, kendi WS'imiz bağlı. */
  live: boolean;
  now: number;
}

export type VoiceView =
  | { kind: "hidden" }
  | { kind: "unsupported" }
  | { kind: "unattended" }
  | { kind: "noPerm" }
  | { kind: "listening" }
  | { kind: "idle"; busy: boolean; notice: VoiceNotice | null; blocked: boolean }
  | { kind: "waiting"; leftMs: number }
  | { kind: "otherPending" }
  | { kind: "talking"; muted: boolean }
  | { kind: "canJoin"; busy: boolean; notice: VoiceNotice | null };

/** Konsol üst çubuğundaki görünüm (§8). Teknisyen kimliği yoksa (eski sunucu) ses hiç gösterilmez. */
export function consoleVoiceView(s: ConsoleVoice, c: VoiceCtx): VoiceView {
  if (!c.live || c.me === null || c.guestVoice === null) return { kind: "hidden" };
  const call = s.call && s.call.phase !== "idle" ? s.call : null;
  if (call && !c.canVoice) return { kind: "noPerm" };
  if (!c.canVoice) return { kind: "hidden" };
  if (c.observer) return call?.phase === "active" ? { kind: "listening" } : { kind: "hidden" };
  if (c.unattended) return { kind: "unattended" };
  if (!c.guestVoice) return { kind: "unsupported" };
  if (!call) {
    const notice = s.notice && (s.notice.until === null || s.notice.until > c.now) ? s.notice : null;
    return { kind: "idle", busy: s.local !== "idle", notice, blocked: notice?.until != null };
  }
  if (call.phase === "pending") {
    if (call.by !== c.me) return { kind: "otherPending" };
    return { kind: "waiting", leftMs: Math.max(0, (s.since ?? c.now) + VOICE_REQUEST_TIMEOUT_MS - c.now) };
  }
  if (call.talkers.includes(c.me)) return { kind: "talking", muted: s.muted };
  return { kind: "canJoin", busy: s.local !== "idle", notice: s.notice };
}

/** tid listesi → adlar (roster'da olmayan tid yazılmaz — D-PD-3). */
export function namesOf(tids: readonly string[], roster: readonly { tid: string; name: string }[]): string[] {
  return tids.flatMap((tid) => {
    const e = roster.find((x) => x.tid === tid);
    return e ? [e.name] : [];
  });
}
