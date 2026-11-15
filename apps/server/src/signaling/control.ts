// P7 uzaktan kontrol sinyalleri (mimari-protokol §3, §3.3 kontrol yaşam döngüsü, §4.3; ADR-0013; akış A3, A4, A5;
// AC-24, 43, 47–51, 99, 105, 111, 115, 116). Sunucu yalnız isteği süzer/iletir, müşterinin kararını kaydeder ve kapatma
// yönünde tetikler; izin kararı istemcide (Go gate). Sınırlar: `remote_control.use` + caps (AC-51), yalnız AGENT (AC-34),
// ret sonrası 30 sn ve oturum başına 5 istek (G-03). Açma yönü (GRANTED) fail-closed: kayıt 800 ms içinde yazılamazsa
// kontrol geri alınır (G-15). Kapatma yönündeki hiçbir yol DB yazımını beklemez: önce bellek + mesaj, sonra kayıt.
// Bu dosya: teknisyen istekleri + misafir mesaj girişleri. İzin kaydı control-grant.ts, sunucu kaynaklı geri alma
// control-revoke.ts, ortak kayıt yardımcıları control-record.ts.
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import { CONTROL_DENY_COOLDOWN_MS, CONTROL_REQUEST_MAX, type ControlSource } from "@remote/contracts/ws";
import { writeAudit } from "../audit/service.ts";
import { onGranted, onView } from "./control-grant.ts";
import { auditBeforeForward, CUSTOMER, enqueue, guestCtx, logFail, recordClose, techActor, unexpected } from "./control-record.ts";
import type { Rooms } from "./rooms.ts";
import type { ControlRoom, Guest, GuestEnv, Room, TechConn } from "./types.ts";

export { CONTROL_AUDIT_TIMEOUT_MS } from "./control-record.ts";

export function newControl(): ControlRoom {
  return { state: "VIEW", granting: false, epoch: 0, requests: 0, monitorRequests: 0, chain: Promise.resolve() };
}
type RequestResult =
  | "forwarded"
  | "forbidden"
  | "browser"
  | "no_guest"
  | "conflict"
  | "cooldown"
  | "limit"
  | "invalid_monitor"
  | "already_active"
  | "superseded";

function refuse(
  rooms: Rooms,
  tech: TechConn,
  code: "FORBIDDEN" | "CONFLICT" | "RATE_LIMITED" | "VALIDATION",
  message: string,
  result: RequestResult,
  kind: "control" | "monitor",
): RequestResult {
  tech.peer.send({ t: "error", code, message });
  rooms.metrics.inc("rs_control_total", { event: `${kind}_request_${result}` });
  return result;
}

/** control.request ön koşulları (yetki, AGENT, durum, ret beklemesi, sayaç); geçerse null. */
function controlRefusal(rooms: Rooms, room: Room, tech: TechConn): RequestResult | null {
  const c = room.control;
  const g = room.admitted;
  if (!tech.permissions.has("remote_control.use") || !room.caps.includes("remote_control"))
    return refuse(rooms, tech, "FORBIDDEN", "Uzaktan kontrol yetkiniz yok.", "forbidden", "control");
  if (!g?.peer) return refuse(rooms, tech, "CONFLICT", "Müşteri bağlı değil.", "no_guest", "control");
  if (g.kind !== "AGENT") return refuse(rooms, tech, "FORBIDDEN", "Müşteri tarayıcı modunda: yalnız görüntüleme.", "browser", "control");
  if (c.state === "REQUESTED" && !c.granting)
    return refuse(rooms, tech, "CONFLICT", "Önceki kontrol isteği müşteride bekliyor.", "conflict", "control");
  if (c.state !== "VIEW" || c.granting) return refuse(rooms, tech, "CONFLICT", "Kontrol zaten açık.", "conflict", "control");
  const now = rooms.clock.now();
  if (c.deniedAt !== undefined && now - c.deniedAt < CONTROL_DENY_COOLDOWN_MS)
    return refuse(rooms, tech, "RATE_LIMITED", "Müşteri reddetti; 30 sn sonra tekrar isteyebilirsiniz.", "cooldown", "control");
  if (c.requests >= CONTROL_REQUEST_MAX)
    return refuse(rooms, tech, "RATE_LIMITED", "Bu oturumda kontrol isteği sınırına ulaşıldı.", "limit", "control");
  return null;
}

/** control.request (tech → S → guest): AC-47, AC-51, AC-34, G-03 / AC-116; yalnız VIEW'dan (§3.3). */
export async function handleControlRequest(rooms: Rooms, room: Room, tech: TechConn): Promise<RequestResult> {
  const c = room.control;
  const g = room.admitted;
  const refused = controlRefusal(rooms, room, tech);
  if (refused || !g?.peer) return refused ?? "no_guest";
  c.requests += 1;
  c.state = "REQUESTED";
  const epoch = c.epoch;
  await auditBeforeForward(rooms, room, tech, CONTROL_AUDIT.REQUESTED, { request: String(c.requests) }, "control_request_audit_failed");
  // Kayıt yazılırken teknisyen iptal etti / taraf koptu: müşteriye geç istek gitmez (sayaçtan yine düşer).
  if (!rooms.live(room) || c.epoch !== epoch || c.state !== "REQUESTED" || room.admitted !== g || !g.peer) {
    rooms.metrics.inc("rs_control_total", { event: "control_request_superseded" });
    return "superseded";
  }
  g.peer.send({ t: "control.request" });
  rooms.metrics.inc("rs_control_total", { event: "control_request_forwarded" });
  return "forwarded";
}

/**
 * control.release / control.cancel (tech → S → guest; §3.3 K1–K2). Kapatma yönü: önce bellek VIEW + mesajlar, kayıt
 * sonra (DB beklenmez, geri alınmaz). REQUESTED → iptal (`control.cancel`, consent yok, audit `control.cancelled`);
 * GRANTED (veya açılış yazılıyor) → bırakma (`control.release`, REVOKED/TECH + `control.released`); VIEW → yok say.
 * İptal/bırakma istek sayacını düşürmez, 30 sn ret beklemesi başlatmaz.
 */
export function handleControlClose(rooms: Rooms, room: Room, tech: TechConn, kind: "release" | "cancel"): Promise<void> {
  const c = room.control;
  if (c.state === "VIEW" && !c.granting) {
    rooms.metrics.inc("rs_control_total", { event: `${kind}_ignored` });
    return Promise.resolve();
  }
  const granting = c.granting;
  const opened = c.state === "GRANTED" || granting;
  c.state = "VIEW";
  c.epoch += 1;
  const guest = room.admitted?.peer;
  if (!opened) {
    guest?.send({ t: "control.cancel" });
    tech.peer.send({ t: "control.state", state: "VIEW", source: "TECH" });
    rooms.metrics.inc("rs_control_total", { event: "cancelled" });
    return writeAudit(rooms.db, tech.ctx, {
      tenantId: room.tenantId,
      ...techActor(tech),
      action: CONTROL_AUDIT.CANCELLED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: { request: String(c.requests) },
    }).catch((err: unknown) => void logFail(rooms, room, "control_cancel_audit_failed", err));
  }
  guest?.send({ t: "control.release" });
  tech.peer.send({ t: "control.state", state: "VIEW", source: "TECH" });
  rooms.metrics.inc("rs_control_total", { event: kind === "release" ? "released" : "released_by_cancel" });
  return recordClose(
    rooms,
    room,
    granting,
    { source: "TECH", action: CONTROL_AUDIT.RELEASED, ctx: tech.ctx, actor: techActor(tech), extra: { via: kind } },
    "control_release_audit_failed",
  );
}

/** monitor.request ön koşulları (AGENT, monitör, tek bekleyen, ret beklemesi, sayaç); geçerse null. */
function monitorRefusal(rooms: Rooms, room: Room, tech: TechConn, monitorId: number, now: number): RequestResult | null {
  const c = room.control;
  const g = room.admitted;
  if (!g?.peer) return refuse(rooms, tech, "CONFLICT", "Müşteri bağlı değil.", "no_guest", "monitor");
  if (g.kind !== "AGENT") return refuse(rooms, tech, "FORBIDDEN", "Monitör değiştirme yalnız istemci modunda.", "browser", "monitor");
  const monitors = room.share?.monitors;
  if (monitors && !monitors.some((m) => m.id === monitorId))
    return refuse(rooms, tech, "VALIDATION", "Monitör bulunamadı.", "invalid_monitor", "monitor");
  // S7-15: zaten paylaşılan monitör için istek açılmaz (sonraki share.state onaysız monitor.granted yazdırmasın).
  if (room.share?.activeMonitor === monitorId)
    return refuse(rooms, tech, "VALIDATION", "Bu monitör zaten paylaşılıyor.", "already_active", "monitor");
  expireMonitor(c, now);
  if (c.monitorPending) return refuse(rooms, tech, "CONFLICT", "Önceki monitör isteği müşteride bekliyor.", "conflict", "monitor");
  if (c.monitorDeniedAt !== undefined && now - c.monitorDeniedAt < CONTROL_DENY_COOLDOWN_MS)
    return refuse(rooms, tech, "RATE_LIMITED", "Müşteri onaylamadı; 30 sn sonra tekrar deneyin.", "cooldown", "monitor");
  if (c.monitorRequests >= CONTROL_REQUEST_MAX)
    return refuse(rooms, tech, "RATE_LIMITED", "Bu oturumda monitör isteği sınırına ulaşıldı.", "limit", "monitor");
  return null;
}

/**
 * monitor.request (tech → S → guest, AC-43; §3 tablo, K4/K5-e): yalnız AGENT; sayaç kontrolden ayrı (≤ 5); aynı anda tek
 * bekleyen istek (→ CONFLICT); ret (`monitor.denied`) veya 30 sn yanıtsızlık sonrası 30 sn yeni istek iletilmez.
 */
export async function handleMonitorRequest(rooms: Rooms, room: Room, tech: TechConn, monitorId: number): Promise<RequestResult> {
  const c = room.control;
  const g = room.admitted;
  const now = rooms.clock.now();
  const refused = monitorRefusal(rooms, room, tech, monitorId, now);
  if (refused || !g?.peer) return refused ?? "no_guest";
  c.monitorRequests += 1;
  const pending = { id: monitorId, at: now, peer: g.peer };
  c.monitorPending = pending;
  await auditBeforeForward(
    rooms,
    room,
    tech,
    CONTROL_AUDIT.MONITOR_REQUESTED,
    { monitorId: String(monitorId), request: String(c.monitorRequests) },
    "monitor_request_audit_failed",
  );
  if (!rooms.live(room) || c.monitorPending !== pending || room.admitted !== g || g.peer !== pending.peer) {
    rooms.metrics.inc("rs_control_total", { event: "monitor_request_superseded" });
    return "superseded";
  }
  pending.peer.send({ t: "monitor.request", monitorId });
  rooms.metrics.inc("rs_control_total", { event: "monitor_request_forwarded" });
  return "forwarded";
}

/** 30 sn yanıtsız bekleyen istek düşer; ret gibi 30 sn bekleme başlar (audit/mesaj yok — K4 yedek yol). */
function expireMonitor(c: ControlRoom, now: number): void {
  if (c.monitorPending && now - c.monitorPending.at >= CONTROL_DENY_COOLDOWN_MS) {
    c.monitorDeniedAt = c.monitorPending.at + CONTROL_DENY_COOLDOWN_MS;
    c.monitorPending = undefined;
  }
}

/**
 * monitor.denied (guest(AGENT) → S → tech; §3.3 K4): yalnız bekleyen istekle aynı `monitorId` için — bekleyen temizlenir,
 * 30 sn bekleme başlar, audit `monitor.denied`, teknisyene alanlar yeniden kurularak iletilir. Diğer → yok say + log.
 */
export async function handleMonitorDenied(rooms: Rooms, room: Room, guest: Guest, monitorId: number): Promise<void> {
  const c = room.control;
  if (guest.kind !== "AGENT") {
    rooms.metrics.inc("rs_control_total", { event: "monitor_denied_ignored" });
    return;
  }
  const now = rooms.clock.now();
  expireMonitor(c, now);
  if (c.monitorPending?.id !== monitorId) {
    unexpected(rooms, room, "monitor_denied_unexpected", { monitorId: String(monitorId) });
    return;
  }
  c.monitorPending = undefined;
  c.monitorDeniedAt = now;
  room.tech?.peer.send({ t: "monitor.denied", monitorId });
  rooms.metrics.inc("rs_control_total", { event: "monitor_denied" });
  await writeAudit(rooms.db, guestCtx(guest), {
    tenantId: room.tenantId,
    ...CUSTOMER,
    action: CONTROL_AUDIT.MONITOR_DENIED,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "success",
    newValue: { monitorId: String(monitorId) },
  }).catch((err: unknown) => void logFail(rooms, room, "monitor_denied_audit_failed", err));
}

/**
 * share.state (AGENT) bekleyen monitör isteğini karşıladıysa: bekleme kalkar, audit `monitor.granted` (§3 tablo).
 * Yalnız isteğin iletildiği misafir bağlantısından (S7-15: yeniden bağlanan istemcinin ilk share.state'i karşılama sayılmaz).
 */
export async function onShareMonitor(rooms: Rooms, room: Room, guest: Guest, activeMonitor: number | undefined): Promise<void> {
  const c = room.control;
  if (guest.kind !== "AGENT" || c.monitorPending === undefined || activeMonitor !== c.monitorPending.id) return;
  if (guest.peer === undefined || guest.peer !== c.monitorPending.peer) return;
  c.monitorPending = undefined;
  rooms.metrics.inc("rs_control_total", { event: "monitor_granted" });
  await writeAudit(rooms.db, guestCtx(guest), {
    tenantId: room.tenantId,
    ...CUSTOMER,
    action: CONTROL_AUDIT.MONITOR_GRANTED,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "success",
    newValue: { monitorId: String(activeMonitor) },
  }).catch((err: unknown) => void logFail(rooms, room, "monitor_granted_audit_failed", err));
}

/**
 * env.state (AGENT → S → tech, AC-105, §3.3 K8): son değer `room.guestEnv`'de tutulur (GRANTED audit'i `selfElevated`),
 * alanlar yeniden kurularak iletilir. Tarayıcı misafirinden gelen yok sayılır.
 */
export function handleEnvState(rooms: Rooms, room: Room, guest: Guest, m: GuestEnv): void {
  if (guest.kind !== "AGENT") {
    rooms.metrics.inc("rs_control_total", { event: "env_state_ignored" });
    return;
  }
  const env: GuestEnv = { elevatedForeground: m.elevatedForeground, secureDesktop: m.secureDesktop, selfElevated: m.selfElevated };
  room.guestEnv = env;
  room.tech?.peer.send({ t: "env.state", ...env });
}
/**
 * control.state (guest → S → tech): kayıt + iletim (AC-29, 50, 99, 111; §3.3). Kaynak kısıtı şemada (S7-10): GRANTED
 * yalnız UI, VIEW yalnız UI|HOTKEY|DENIED|SYSTEM. Yalnız durum geçişleri kaydedilir.
 */
export function handleControlState(
  rooms: Rooms,
  room: Room,
  guest: Guest,
  m: { state: "VIEW" | "GRANTED"; source: ControlSource },
): Promise<void> {
  if (guest.kind !== "AGENT") {
    rooms.metrics.inc("rs_control_total", { event: "control_state_ignored" });
    return Promise.resolve();
  }
  return enqueue(rooms, room, () => (m.state === "GRANTED" ? onGranted(rooms, room, guest) : onView(rooms, room, guest, m.source)));
}
