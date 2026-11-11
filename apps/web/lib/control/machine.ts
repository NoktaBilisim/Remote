/*
 * Konsol uzaktan kontrol durum makinesi — saf reducer (AC-47, 50, 51, 99, 105, 115, 116; mimari-akislar A3/A5).
 * idle →(request)→ requested →(control.state GRANTED)→ granted →(VIEW UI|HOTKEY|SYSTEM)→ ended
 *                            →(control.state VIEW DENIED)→ denied (30 sn bekleme)
 *                            →(cancel = "Vazgeç", control.cancel)→ ended{cancel}            (§3.3 K2)
 *                                                           granted →(release, control.release)→ ended{tech} (§3.3 K1)
 * "Kontrolü bırak" yerel duraklatma değildir: müşteri kapısı kapanır, "Kontrole devam" yeni `control.request`tir.
 * Yalnız `requested` fazında gelen `control.state{GRANTED}` kabul edilir; beklenmeyen GRANTED yakalama başlatmaz,
 * çağıran `control.release` gönderir (`isUnexpectedGrant`, S7-2).
 * İzin kararı müşteri istemcisindedir; bu makine yalnız gösterim ve "girdi gönder / gönderme" kararını verir.
 * Fail-safe: belirsiz her olayda (kopma, yeniden bağlanma, oturum sonu, yetki daralması) yakalama kapanır.
 * Sunucu otoritedir (≤5 istek, 30 sn); istemci sayaçları yalnız butonu önceden pasifler.
 */
import type { ServerOutbound } from "@remote/contracts/ws";
import { CONTROL_DENY_COOLDOWN_MS, CONTROL_REQUEST_MAX } from "./protocol";

export const MAX_CONTROL_REQUESTS = CONTROL_REQUEST_MAX;
export const DENY_COOLDOWN_MS = CONTROL_DENY_COOLDOWN_MS;
/** Monitör isteğine yanıt (share.state.activeMonitor değişimi) gelmezse "onaylanmadı" sayılır. */
export const MONITOR_TIMEOUT_MS = 30_000;
/** Sunucunun `error`'u yalnız son gönderilen istekle eşlenir (zarf id'si hataya yansımaz). */
const ERROR_WINDOW_MS = 5_000;
/** Son istekle eşlenen sunucu hataları (K7, S7-15). */
const MAPPED_ERRORS = new Set<string>(["FORBIDDEN", "RATE_LIMITED", "CONFLICT", "VALIDATION"]);


export type ControlPhase = "idle" | "requested" | "granted" | "denied" | "ended";
/**
 * `tech` = teknisyen bıraktı (K1), `cancel` = teknisyen bekleyen isteği geri çekti (K2),
 * `agent` = bekleyen istek müşteri tarafında bağlantı kesildiği için kapandı (`requested`'da `{VIEW, SYSTEM}`, K6).
 */
export type ControlEndCause = "customer" | "hotkey" | "system" | "reconnect" | "peer" | "tech" | "cancel" | "agent";
export interface Monitor {
  id: number;
  name: string;
  w: number;
  h: number;
  primary: boolean;
}

export interface ControlState {
  phase: ControlPhase;
  /** Bu konsolda iletilen kontrol isteği sayısı (sunucu reddettiğinde geri alınır). */
  requests: number;
  deniedAt: number | null;
  endedBy: ControlEndCause | null;
  endedAt: number | null;
  /** Sunucu FORBIDDEN / yetki daralması (caps.update, control.revoke{permission}). */
  forbidden: boolean;
  error: "rate" | null;
  /** Kontrol isteğine `error{CONFLICT}` (iki sekme vb., K7): faz değişmez, sunucunun metni gösterilir. */
  notice: string | null;
  monitors: Monitor[];
  activeMonitor: number | null;
  monitorPending: { id: number; at: number } | null;
  monitorRequests: number;
  /**
   * `denied` = müşteri reddetti (`monitor.denied`, K4); `noAnswer` = 30 sn yanıtsız (yedek yol); `rate` = sunucu
   * iletmedi (RATE_LIMITED / CONFLICT, K7); `already` = istenen monitör zaten paylaşılıyor (VALIDATION, S7-15).
   */
  monitorOutcome: "switched" | "denied" | "noAnswer" | "rate" | "already" | null;
  /** K7: ret/yanıtsızlık/sunucu reddi sonrası bu ana kadar yeni monitör isteği gönderilmez (sunucu 30 sn + 1 sn pay). */
  monitorBlockedUntil: number | null;
  env: { elevated: boolean; secure: boolean; self: boolean };
  lastSent: { kind: "control" | "monitor"; at: number } | null;
}

export const initialControl: ControlState = {
  phase: "idle",
  requests: 0,
  deniedAt: null,
  endedBy: null,
  endedAt: null,
  forbidden: false,
  error: null,
  notice: null,
  monitors: [],
  activeMonitor: null,
  monitorPending: null,
  monitorRequests: 0,
  monitorOutcome: null,
  monitorBlockedUntil: null,
  env: { elevated: false, secure: false, self: false },
  lastSent: null,
};

export type ControlEvent =
  | { type: "request"; now: number }
  | { type: "release"; now: number }
  | { type: "cancel"; now: number }
  | { type: "monitor"; id: number; now: number }
  | { type: "monitorTimeout"; now: number }
  | { type: "closed"; now: number }
  | { type: "restore"; saved: Partial<ControlCounters>; now: number }
  | { type: "msg"; m: ServerOutbound; now: number };

/**
 * TEST-P7-3: sayfa yenilense de korunan sayaçlar (sunucu oturum başına sayar; konsol yeniden "5 hak" göstermesin).
 * Yalnız sayaç/zaman — izin durumu asla geri yüklenmez (yeniden bağlanmada kontrol VIEW başlar, AC-24).
 */
export interface ControlCounters {
  requests: number;
  deniedAt: number | null;
  monitorRequests: number;
  monitorBlockedUntil: number | null;
}
const num = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
const ts = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

export const cooldownLeft = (s: ControlState, now: number): number =>
  s.phase === "denied" && s.deniedAt !== null ? Math.max(0, s.deniedAt + DENY_COOLDOWN_MS - now) : 0;
export const requestsLeft = (s: ControlState): number => Math.max(0, MAX_CONTROL_REQUESTS - s.requests);

export function canRequest(s: ControlState, now: number): boolean {
  if (s.forbidden || s.phase === "requested" || s.phase === "granted") return false;
  return requestsLeft(s) > 0 && cooldownLeft(s, now) === 0;
}
/** K7: sunucunun 30 sn monitör beklemesine ağ gecikmesi payı (konsol sayacı gönderirken, sunucunun iletirken başlar). */
export const MONITOR_BLOCK_MS = CONTROL_DENY_COOLDOWN_MS + 1_000;
export const monitorBlockLeft = (s: ControlState, now: number): number =>
  s.monitorBlockedUntil === null ? 0 : Math.max(0, s.monitorBlockedUntil - now);
export function canRequestMonitor(s: ControlState, now: number): boolean {
  return s.monitorPending === null && s.monitorRequests < MAX_CONTROL_REQUESTS && monitorBlockLeft(s, now) === 0;
}
/** Girdi yakalanır mı (görüntü varlığı ayrıca sahnede kontrol edilir). */
export const isCapturing = (s: ControlState): boolean => s.phase === "granted" && !s.forbidden;
/** "Kontrolü bırak" anlamlı mı (K1). */
export const canRelease = (s: ControlState): boolean => s.phase === "granted";
/** "Vazgeç" anlamlı mı (K2). */
export const canCancel = (s: ControlState): boolean => s.phase === "requested";

/**
 * S7-2 / K2: bu konsolun beklemediği izin (istek yok, iptal/bırakma sonrası geç gelen, yetki yokken). Yakalama
 * başlamaz; çağıran `control.release` gönderir ki sunucu ve müşteri kapısı da kapansın. Zaten `granted`'ken
 * gelen tekrar GRANTED yalnız yok sayılır (açık kontrolü bozmaz).
 */
export function isUnexpectedGrant(s: ControlState, m: ServerOutbound): boolean {
  if (m.t !== "control.state" || m.state !== "GRANTED") return false;
  return s.forbidden || (s.phase !== "requested" && s.phase !== "granted");
}

/** Kontrolü kapatır (yakalama biter); yalnız açık/istenmiş kontrolde neden yazılır. */
function stop(s: ControlState, cause: ControlEndCause, now: number, phase: ControlPhase = "ended"): ControlState {
  const open = s.phase === "granted" || s.phase === "requested";
  return { ...s, phase: open ? phase : s.phase === "denied" ? "denied" : s.phase, notice: open ? null : s.notice, endedBy: open ? cause : s.endedBy, endedAt: open ? now : s.endedAt };
}

function shareInfo(m: { monitors?: Monitor[] | undefined; activeMonitor?: number | undefined }) {
  return { monitors: m.monitors, activeMonitor: m.activeMonitor };
}

export function controlReducer(s: ControlState, e: ControlEvent): ControlState {
  switch (e.type) {
    case "request":
      if (!canRequest(s, e.now)) return s;
      return { ...s, phase: "requested", requests: s.requests + 1, error: null, notice: null, lastSent: { kind: "control", at: e.now } };
    case "release":
      return canRelease(s) ? stop(s, "tech", e.now) : s;
    case "cancel":
      return canCancel(s) ? { ...stop(s, "cancel", e.now), lastSent: null } : s;
    case "monitor":
      if (!canRequestMonitor(s, e.now) || e.id === s.activeMonitor || !s.monitors.some((x) => x.id === e.id)) return s;
      return { ...s, monitorPending: { id: e.id, at: e.now }, monitorRequests: s.monitorRequests + 1, monitorOutcome: null, lastSent: { kind: "monitor", at: e.now } };
    case "monitorTimeout":
      return s.monitorPending && e.now - s.monitorPending.at >= MONITOR_TIMEOUT_MS
        ? { ...s, monitorPending: null, monitorOutcome: "noAnswer", monitorBlockedUntil: e.now + MONITOR_BLOCK_MS }
        : s;
    case "closed":
      // Kendi WS'imiz koptu: sunucu yeniden bağlanmada kontrolü VIEW yapar (§3 son paragraf)
      return { ...stop(s, "reconnect", e.now, "idle"), monitorPending: null, env: initialControl.env };
    case "restore": {
      // Birleştirme hep büyük olanı alır (yarışta geri sayım/hak geri gitmez); bozuk depo değeri 0/null olur
      const deniedAt = later(s.deniedAt, ts(e.saved.deniedAt));
      const cooling = deniedAt !== null && deniedAt + DENY_COOLDOWN_MS > e.now && (s.phase === "idle" || s.phase === "denied");
      return {
        ...s,
        requests: Math.max(s.requests, num(e.saved.requests, MAX_CONTROL_REQUESTS)),
        deniedAt,
        phase: cooling ? "denied" : s.phase,
        monitorRequests: Math.max(s.monitorRequests, num(e.saved.monitorRequests, MAX_CONTROL_REQUESTS)),
        monitorBlockedUntil: later(s.monitorBlockedUntil, ts(e.saved.monitorBlockedUntil)),
      };
    }
    case "msg":
      return onMsg(s, e.m, e.now);
  }
}

function onMsg(s: ControlState, m: ServerOutbound, now: number): ControlState {
  switch (m.t) {
    case "hello": {
      const sh = m.share ? shareInfo(m.share) : null;
      return {
        ...stop(s, "reconnect", now, "idle"),
        monitorPending: null,
        env: initialControl.env,
        monitors: sh?.monitors ?? s.monitors,
        activeMonitor: sh?.activeMonitor ?? s.activeMonitor,
      };
    }
    case "peer.joined":
      if (m.role !== "guest") return s;
      // Yeni PeerConnection: müşteri kapısı kapalı başlar (AC-24)
      return { ...stop(s, "reconnect", now, "idle"), monitorPending: null, env: initialControl.env, monitors: [], activeMonitor: null };
    case "peer.left":
      if (m.role !== "guest") return s;
      return { ...stop(s, "peer", now, "idle"), monitorPending: null, env: initialControl.env };
    case "session.ended":
      return { ...stop(s, "system", now, "idle"), monitorPending: null };
    case "share.state": {
      const monitors = m.monitors ?? s.monitors;
      const activeMonitor = m.activeMonitor ?? s.activeMonitor;
      const hit = s.monitorPending !== null && activeMonitor === s.monitorPending.id;
      return { ...s, monitors, activeMonitor, ...(hit ? { monitorPending: null, monitorOutcome: "switched" as const } : {}) };
    }
    case "control.state":
      if (m.state === "GRANTED") {
        // Yalnız bekleyen istek izne döner (S7-2); beklenmeyen GRANTED durumu değiştirmez
        return s.phase === "requested" && !s.forbidden ? { ...s, phase: "granted", error: null, notice: null, endedBy: null, endedAt: null } : s;
      }
      if (m.source === "DENIED") return { ...s, phase: "denied", deniedAt: now };
      if (m.source === "RECONNECT") return stop(s, "reconnect", now, "idle");
      // {VIEW, TECH}: bırakma/iptalin sunucu onayı — konsol zaten kapattı, sessiz geçer
      if (m.source === "TECH") return stop(s, "tech", now);
      // K6: bekleyen istek müşteri tarafında kapandı (PeerConnection koptu) — ret değil, bekleme yok, hemen yeniden istenebilir
      if (m.source === "SYSTEM" && s.phase === "requested") return { ...stop(s, "agent", now), lastSent: null };
      return stop(s, m.source === "HOTKEY" ? "hotkey" : m.source === "SYSTEM" ? "system" : "customer", now);
    case "control.revoke":
      // Protokolde S→guest; konsola gelirse de kapatma yönünde işlenir (reconnect = bağlantı yenilendi)
      if (m.reason === "reconnect") return stop(s, "reconnect", now, "idle");
      return { ...stop(s, "system", now), forbidden: s.forbidden || m.reason === "permission" };
    case "monitor.denied":
      // K4: müşteri reddetti — 30 sn beklemeden hemen yazılır; başka monitöre ait geç ret yok sayılır
      return s.monitorPending?.id === m.monitorId ? { ...s, monitorPending: null, monitorOutcome: "denied", monitorBlockedUntil: now + MONITOR_BLOCK_MS } : s;
    case "caps.update":
      return m.caps.includes("remote_control") ? s : { ...stop(s, "system", now), forbidden: true };
    case "env.state":
      return { ...s, env: { elevated: m.elevatedForeground, secure: m.secureDesktop, self: m.selfElevated } };
    case "error": {
      // G-15: GRANTED audit'i yazılamadı → sunucu kontrolü geri alır, teknisyene INTERNAL (fail-closed)
      if (m.code === "INTERNAL" && (s.phase === "granted" || s.phase === "requested")) return stop(s, "system", now);
      const last = s.lastSent;
      if (!last || now - last.at > ERROR_WINDOW_MS || !MAPPED_ERRORS.has(m.code)) return s;
      if (last.kind === "control" && s.phase === "requested") {
        // K7: CONFLICT normalde oluşmaz (düğme requested'de pasif); gelirse faz değişmez, yalnız sunucunun metni
        if (m.code === "CONFLICT") return { ...s, notice: m.message, lastSent: null };
        if (m.code === "VALIDATION") return s;
        // İstek iletilmedi: sayaç geri alınır; ret bekleme süresi sürüyorsa "denied"e döner
        const back: ControlPhase = s.deniedAt !== null && now - s.deniedAt < DENY_COOLDOWN_MS ? "denied" : "idle";
        return { ...s, phase: back, requests: Math.max(0, s.requests - 1), lastSent: null, forbidden: s.forbidden || m.code === "FORBIDDEN", error: m.code === "RATE_LIMITED" ? "rate" : null };
      }
      if (last.kind === "monitor" && s.monitorPending) {
        // İstek iletilmedi → bekleme kapanır, sayaç geri alınır. S7-15: zaten paylaşılan monitör (VALIDATION) bekleme
        // başlatmaz; K7: RATE_LIMITED/CONFLICT (ve FORBIDDEN) sunucu beklemesi bitene kadar düğmeyi pasifler.
        const base = { ...s, monitorPending: null, monitorRequests: Math.max(0, s.monitorRequests - 1), lastSent: null };
        if (m.code === "VALIDATION") return { ...base, monitorOutcome: "already" };
        return { ...base, monitorOutcome: "rate", monitorBlockedUntil: now + MONITOR_BLOCK_MS };
      }
      return s;
    }
    default:
      return s;
  }
}
