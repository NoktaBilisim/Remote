// P7 uzaktan kontrol sinyalleri (mimari-protokol §3, §3.3 kontrol yaşam döngüsü, §4.3; ADR-0013; akış A3, A4, A5;
// AC-24, 43, 47–51, 99, 105, 111, 115, 116). Sunucu yalnız isteği süzer/iletir, müşterinin kararını kaydeder ve kapatma
// yönünde tetikler; izin kararı istemcide (Go gate). Sınırlar: `remote_control.use` + caps (AC-51), yalnız AGENT (AC-34),
// ret sonrası 30 sn ve oturum başına 5 istek (G-03). Açma yönü (GRANTED) fail-closed: kayıt 800 ms içinde yazılamazsa
// kontrol geri alınır (G-15). Kapatma yönündeki hiçbir yol DB yazımını beklemez: önce bellek + mesaj, sonra kayıt.
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import type { PermissionKey } from "@remote/contracts/permissions";
import {
  CONTROL_DENY_COOLDOWN_MS,
  CONTROL_REQUEST_MAX,
  type Cap,
  type ControlRevokeReason,
  type ControlSource,
} from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { JsonObject } from "../audit/mask.ts";
import { newId } from "../lib/ids.ts";
import type { Rooms } from "./rooms.ts";
import type { Clock, CloseRecord, ConsentSource, ControlRoom, Guest, GuestEnv, Room, TechConn } from "./types.ts";

/** AC-111: GRANTED kaydı bu sürede yazılmazsa kontrol geri alınır (1 sn şartının içinde kalmak için pay bırakıldı). */
export const CONTROL_AUDIT_TIMEOUT_MS = 800;
/** Beklenmeyen misafir mesajı logu oda başına bu aralıkta en çok bir kez (log seli önlemi). */
const UNEXPECTED_LOG_INTERVAL_MS = 60_000;

type ConsentDecision = "GRANTED" | "DENIED" | "REVOKED";

const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };
const CUSTOMER = { username: "customer" } as const;
const SYSTEM = { username: "system" } as const;

export function newControl(): ControlRoom {
  return { state: "VIEW", granting: false, epoch: 0, requests: 0, monitorRequests: 0, chain: Promise.resolve() };
}

const guestCtx = (g: Guest): AuditContext => g.ctx ?? { ip: g.consent.ip, userAgent: g.consent.userAgent, requestId: newId() };
const techActor = (t: TechConn) => ({ userId: t.userId, username: t.username });
const systemClose = (extra: JsonObject): CloseRecord => ({
  source: "SYSTEM",
  action: CONTROL_AUDIT.REVOKED,
  ctx: SYSTEM_CTX,
  actor: SYSTEM,
  extra,
});

/** Onay satırı + audit tek TX (AC-111 zaman çizelgesi). Müşteri kaynağı dışında (SYSTEM/RECONNECT/TECH) ip/user_agent yazılmaz. */
async function recordControl(
  rooms: Rooms,
  room: Room,
  decision: ConsentDecision,
  source: ConsentSource,
  ctx: AuditContext,
  actor: { userId?: string; username: string },
  action: string,
  extra: JsonObject = {},
): Promise<void> {
  const client = source === "UI" || source === "HOTKEY";
  await rooms.db.$transaction(async (tx) => {
    await tx.sessionConsent.create({
      data: {
        id: newId(),
        sessionId: room.sessionId,
        tenantId: room.tenantId,
        level: "CONTROL",
        decision,
        source,
        ip: client ? ctx.ip.slice(0, 45) : null,
        userAgent: client ? ctx.userAgent.slice(0, 300) : null,
      },
    });
    await writeAudit(tx, ctx, {
      tenantId: room.tenantId,
      ...actor,
      action,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: { decision, source, ...extra },
    });
  });
}

/** Kayıt hatası istemciye sızmaz: log + referans (kalite standardı). */
function logFail(rooms: Rooms, room: Room, event: string, err: unknown): string {
  const ref = newId();
  rooms.log.error({ err, ref, event, sessionId: room.sessionId }, "kontrol kaydı yazılamadı");
  return ref;
}

/** Beklenmeyen misafir mesajı: metrik her zaman, log oda başına dakikada en çok 1. */
function unexpected(rooms: Rooms, room: Room, event: string, fields: JsonObject): void {
  rooms.metrics.inc("rs_control_total", { event });
  const c = room.control;
  const now = rooms.clock.now();
  if (c.unexpectedLogAt !== undefined && now - c.unexpectedLogAt < UNEXPECTED_LOG_INTERVAL_MS) return;
  c.unexpectedLogAt = now;
  rooms.log.warn({ event, sessionId: room.sessionId, serverState: c.state, ...fields }, "beklenmeyen kontrol mesajı");
}

/** Sözü süre içinde sonuçlanmazsa "timeout"; reddedilirse "error". */
function settleWithin(clock: Clock, p: Promise<void>, ms: number): Promise<"ok" | "error" | "timeout"> {
  return new Promise((resolve) => {
    const h = clock.setTimeout(() => resolve("timeout"), ms);
    p.then(
      () => {
        clock.clearTimeout(h);
        resolve("ok");
      },
      () => {
        clock.clearTimeout(h);
        resolve("error");
      },
    );
  });
}

/** Oda başına sıralı kayıt: kontrol satırları birbirinin arasına girmez. */
function enqueue(rooms: Rooms, room: Room, job: () => Promise<void>): Promise<void> {
  const next = room.control.chain.then(job).catch((err: unknown) => void logFail(rooms, room, "control_job_failed", err));
  room.control.chain = next;
  return next;
}

/**
 * Kapanış kaydı (REVOKED). Kontrol açıksa sırada yazılır (en iyi çaba; hata log + ref). Açılış hâlâ yazılıyorsa (granting)
 * kayıt `interrupt` olarak bırakılır; GRANTED commit edilirse `onGranted` bu kayıtla dengeler (ilk kapatma kazanır).
 */
function recordClose(rooms: Rooms, room: Room, granting: boolean, rec: CloseRecord, event: string): Promise<void> {
  if (granting) {
    room.control.interrupt ??= rec;
    return Promise.resolve();
  }
  return enqueue(rooms, room, () =>
    recordControl(rooms, room, "REVOKED", rec.source, rec.ctx, rec.actor, rec.action, rec.extra).catch(
      (err: unknown) => void logFail(rooms, room, event, err),
    ),
  );
}

/**
 * İstek audit'i iletimden **önce** (QA-P7-5): zaman çizelgesinde istek satırı müşterinin kararından önce gelir. Açma
 * yönü değil — yazılamazsa (hata / 800 ms) log + ref + metrik `*_request_audit_failed`, istek yine iletilir.
 */
async function auditBeforeForward(
  rooms: Rooms,
  room: Room,
  tech: TechConn,
  action: string,
  newValue: JsonObject,
  event: string,
): Promise<void> {
  const write = writeAudit(rooms.db, tech.ctx, {
    tenantId: room.tenantId,
    ...techActor(tech),
    action,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "success",
    newValue,
  }).then(
    () => undefined,
    (err: unknown) => {
      logFail(rooms, room, event, err);
      rooms.metrics.inc("rs_control_total", { event });
      throw err;
    },
  );
  if ((await settleWithin(rooms.clock, write, CONTROL_AUDIT_TIMEOUT_MS)) === "timeout") {
    logFail(rooms, room, event, "timeout");
    rooms.metrics.inc("rs_control_total", { event });
  }
}

export type RequestResult =
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

/** control.request (tech → S → guest): AC-47, AC-51, AC-34, G-03 / AC-116; yalnız VIEW'dan (§3.3). */
export async function handleControlRequest(rooms: Rooms, room: Room, tech: TechConn): Promise<RequestResult> {
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

/**
 * monitor.request (tech → S → guest, AC-43; §3 tablo, K4/K5-e): yalnız AGENT; sayaç kontrolden ayrı (≤ 5); aynı anda tek
 * bekleyen istek (→ CONFLICT); ret (`monitor.denied`) veya 30 sn yanıtsızlık sonrası 30 sn yeni istek iletilmez.
 */
export async function handleMonitorRequest(rooms: Rooms, room: Room, tech: TechConn, monitorId: number): Promise<RequestResult> {
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
  const now = rooms.clock.now();
  expireMonitor(c, now);
  if (c.monitorPending) return refuse(rooms, tech, "CONFLICT", "Önceki monitör isteği müşteride bekliyor.", "conflict", "monitor");
  if (c.monitorDeniedAt !== undefined && now - c.monitorDeniedAt < CONTROL_DENY_COOLDOWN_MS)
    return refuse(rooms, tech, "RATE_LIMITED", "Müşteri onaylamadı; 30 sn sonra tekrar deneyin.", "cooldown", "monitor");
  if (c.monitorRequests >= CONTROL_REQUEST_MAX)
    return refuse(rooms, tech, "RATE_LIMITED", "Bu oturumda monitör isteği sınırına ulaşıldı.", "limit", "monitor");
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

/** K8: GRANTED audit'i için istemcinin yönetici durumu; env.state hiç gelmediyse "unknown". */
const selfElevatedOf = (room: Room): "true" | "false" | "unknown" =>
  room.guestEnv === undefined ? "unknown" : room.guestEnv.selfElevated ? "true" : "false";

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

async function onGranted(rooms: Rooms, room: Room, guest: Guest): Promise<void> {
  const c = room.control;
  if (!rooms.live(room) || room.admitted !== guest) return;
  if (c.state !== "REQUESTED" || c.granting) {
    // §3.3 K2 (QA-P7-4, S7-2): bekleyen istek yokken gelen izin kaydedilmez/iletilmez. VIEW'da (iptal/bırakma ile çapraz
    // yarış veya istenmemiş izin) misafirin kapısı kapatılır; GRANTED'de tekrar — yok say.
    if (c.state === "VIEW" && !c.granting) guest.peer?.send({ t: "control.revoke", reason: "stale" });
    unexpected(rooms, room, "control_state_unexpected", { state: "GRANTED" });
    return;
  }
  if (!room.caps.includes("remote_control")) {
    // Yetkisi kaldırılmış teknisyene izin verilemez: kapı hemen kapatılır (AC-115).
    c.state = "VIEW";
    c.epoch += 1;
    guest.peer?.send({ t: "control.revoke", reason: "permission" });
    rooms.metrics.inc("rs_control_total", { event: "grant_without_cap" });
    return;
  }
  const epoch = c.epoch;
  c.granting = true;
  c.interrupt = undefined;
  const write = recordControl(rooms, room, "GRANTED", "UI", guestCtx(guest), CUSTOMER, CONTROL_AUDIT.GRANTED, {
    selfElevated: selfElevatedOf(room),
  });
  const outcome = await settleWithin(rooms.clock, write, CONTROL_AUDIT_TIMEOUT_MS);
  c.granting = false;
  if (outcome !== "ok") {
    // G-15 fail-closed: kayıt yoksa kontrol yok. Geç commit edilen GRANTED (timeout) bir REVOKED ile dengelenir.
    const ref = logFail(rooms, room, outcome === "timeout" ? "control_grant_audit_timeout" : "control_grant_audit_failed", outcome);
    rooms.metrics.inc("rs_control_total", { event: `grant_audit_${outcome}` });
    const balance = c.interrupt ?? systemClose({ reason: "audit" });
    c.interrupt = undefined;
    c.state = "VIEW";
    c.epoch += 1;
    if (rooms.live(room)) {
      guest.peer?.send({ t: "control.revoke", reason: "audit" });
      room.tech?.peer.send({ t: "error", code: "INTERNAL", message: `Kontrol kaydı yazılamadı; kontrol geri alındı (ref: ${ref}).` });
    }
    if (outcome === "timeout") {
      void write
        .then(
          () => recordControl(rooms, room, "REVOKED", balance.source, balance.ctx, balance.actor, balance.action, balance.extra),
          () => undefined,
        )
        .catch((err: unknown) => void logFail(rooms, room, "control_audit_balance_failed", err));
    }
    return;
  }
  if (!rooms.live(room) || c.epoch !== epoch) {
    // Kayıt yazılırken kontrol kapatıldı (bırakma, yetki, kopma, oturum sonu): zaman çizelgesi o kapatmayla dengelenir.
    const rec = c.interrupt ?? systemClose({ reason: "superseded" });
    c.interrupt = undefined;
    await recordControl(rooms, room, "REVOKED", rec.source, rec.ctx, rec.actor, rec.action, rec.extra).catch(
      (err: unknown) => void logFail(rooms, room, "control_audit_balance_failed", err),
    );
    return;
  }
  c.state = "GRANTED";
  room.tech?.peer.send({ t: "control.state", state: "GRANTED", source: "UI" });
  rooms.metrics.inc("rs_control_total", { event: "granted" });
}

async function onView(rooms: Rooms, room: Room, guest: Guest, source: ControlSource): Promise<void> {
  const c = room.control;
  if (!rooms.live(room) || room.admitted !== guest) return;
  if (source === "DENIED") {
    if (c.state !== "REQUESTED") return; // ret yalnız bekleyen isteğe; tekrarlar kayıt şişirmez
    c.state = "VIEW";
    c.epoch += 1;
    c.deniedAt = rooms.clock.now();
    room.tech?.peer.send({ t: "control.state", state: "VIEW", source: "DENIED" });
    rooms.metrics.inc("rs_control_total", { event: "denied" });
    await recordControl(rooms, room, "DENIED", "UI", guestCtx(guest), CUSTOMER, CONTROL_AUDIT.DENIED).catch(
      (err: unknown) => void logFail(rooms, room, "control_deny_audit_failed", err),
    );
    return;
  }
  if (c.state === "VIEW") return; // sunucu kapattıktan sonraki istemci onayı (SYSTEM) — zaten kayıtlı
  const was = c.state;
  c.state = "VIEW";
  c.epoch += 1;
  room.tech?.peer.send({ t: "control.state", state: "VIEW", source });
  if (was === "REQUESTED") {
    // §3.3 K6: bekleyen istek müşteri kararı olmadan istemcide kapandı (ör. PeerConnection koptu). Consent yok (müşteriye
    // ret atfedilmez), 30 sn bekleme/sayaç yok; control.requested'in kapanışı audit control.cancelled{by:"agent"} (en iyi çaba).
    rooms.metrics.inc("rs_control_total", { event: "cancelled_by_agent" });
    void writeAudit(rooms.db, guestCtx(guest), {
      tenantId: room.tenantId,
      ...CUSTOMER,
      action: CONTROL_AUDIT.CANCELLED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: { by: "agent", source },
    }).catch((err: unknown) => void logFail(rooms, room, "control_cancel_audit_failed", err));
    return;
  }
  rooms.metrics.inc("rs_control_total", { event: `revoked_${source.toLowerCase()}` });
  // AC-111: müşteri kapattı (UI) / kısayol (HOTKEY) / istemci kendiliğinden kapattı (SYSTEM).
  const consentSource: ConsentSource = source === "HOTKEY" || source === "SYSTEM" ? source : "UI";
  await recordControl(rooms, room, "REVOKED", consentSource, guestCtx(guest), CUSTOMER, CONTROL_AUDIT.REVOKED).catch(
    (err: unknown) => void logFail(rooms, room, "control_revoke_audit_failed", err),
  );
}

/** Kapatma ortak adımı: VIEW + epoch; kontrol açık mıydı / açılış yazılıyor muydu. VIEW'daysa null. */
function closeState(c: ControlRoom): { opened: boolean; granting: boolean } | null {
  if (c.state === "VIEW" && !c.granting) return null;
  const r = { opened: c.state === "GRANTED" || c.granting, granting: c.granting };
  c.state = "VIEW";
  c.epoch += 1;
  return r;
}

/**
 * Sunucu kaynaklı kapatma (A5, AC-115, G-04): misafire `control.revoke` (istemci kapıyı kapatır, açamaz), teknisyene
 * `control.state{VIEW, SYSTEM}`. Kontrol açıktıysa REVOKED/SYSTEM kaydı yazılır.
 */
export async function revokeControl(rooms: Rooms, room: Room, reason: ControlRevokeReason): Promise<void> {
  const r = closeState(room.control);
  if (!r) return;
  room.admitted?.peer?.send({ t: "control.revoke", reason });
  room.tech?.peer.send({ t: "control.state", state: "VIEW", source: "SYSTEM" });
  rooms.metrics.inc("rs_control_total", { event: `revoke_${reason}` });
  if (r.opened) await recordClose(rooms, room, r.granting, systemClose({ reason }), "control_revoke_audit_failed");
}

/**
 * Misafir kopması (A4, AC-24): kontrol VIEW'a döner, teknisyen `control.state{VIEW, RECONNECT}` alır; yeniden bağlanan
 * istemci kapıyı kapalı başlatır. Açık kontrol REVOKED/RECONNECT olarak kaydedilir. Bekleyen monitör isteği temizlenir
 * (S7-15; K3 teknisyen tarafıyla simetrik): yeniden bağlanan istemci diyaloğu görmedi, teknisyen CONFLICT almaz.
 */
export function resetOnGuestGone(rooms: Rooms, room: Room): void {
  room.control.monitorPending = undefined;
  room.guestEnv = undefined; // K8: yeniden bağlanan istemci hello sonrası yeni env.state gönderir
  const r = closeState(room.control);
  if (!r) return;
  room.tech?.peer.send({ t: "control.state", state: "VIEW", source: "RECONNECT" });
  rooms.metrics.inc("rs_control_total", { event: "reset_guest_gone" });
  if (r.opened)
    void recordClose(
      rooms,
      room,
      r.granting,
      {
        source: "RECONNECT",
        action: CONTROL_AUDIT.REVOKED,
        ctx: SYSTEM_CTX,
        actor: SYSTEM,
        extra: { reason: "disconnect", side: "guest" },
      },
      "control_revoke_audit_failed",
    );
}

/**
 * Teknisyen kopması / sekme değişimi (§3.3 K3): VIEW, bekleyen monitör isteği temizlenir; bağlı (ADMITTED) misafire
 * **her zaman** `control.revoke{reconnect}` — çağıran ardından `peer.left{tech}` / `peer.joined{tech}` gönderir (sıra:
 * önce revoke). Açık kontrol REVOKED/RECONNECT olarak kaydedilir.
 */
export function revokeOnTechChange(rooms: Rooms, room: Room): void {
  room.control.monitorPending = undefined;
  const r = closeState(room.control);
  room.admitted?.peer?.send({ t: "control.revoke", reason: "reconnect" });
  rooms.metrics.inc("rs_control_total", { event: "revoke_reconnect" });
  if (r?.opened)
    void recordClose(
      rooms,
      room,
      r.granting,
      { source: "RECONNECT", action: CONTROL_AUDIT.REVOKED, ctx: SYSTEM_CTX, actor: SYSTEM, extra: { reason: "disconnect", side: "tech" } },
      "control_revoke_audit_failed",
    );
}

/**
 * Oturum sonu (§3.3 K5-d): `session.ended` gönderildikten sonra, açık kontrol için en iyi çabayla REVOKED/SYSTEM +
 * `control.revoked{session_ended}`. Yazılamazsa log + ref; bitişi engellemez (beklenmez).
 */
export function closeControlOnEnd(rooms: Rooms, room: Room): void {
  room.control.monitorPending = undefined;
  const r = closeState(room.control);
  if (!r?.opened) return;
  rooms.metrics.inc("rs_control_total", { event: "revoke_session_ended" });
  void recordClose(rooms, room, r.granting, systemClose({ reason: "session_ended" }), "control_end_audit_failed");
}

const CAP_PERM: Record<Cap, PermissionKey> = { remote_control: "remote_control.use", file_transfer: "file_transfer.use" };

/**
 * Yetki daralması (S-P3-8, AC-115, G-09): caps yalnız daralır (genişleme yeni oturumda). Değişirse misafire
 * `caps.update`; `remote_control` düştüyse açık/bekleyen kontrol `control.revoke{permission}` ile kapanır.
 */
export async function narrowCaps(rooms: Rooms, room: Room, perms: ReadonlySet<PermissionKey>): Promise<void> {
  const next = room.caps.filter((cap) => perms.has(CAP_PERM[cap]));
  if (next.length === room.caps.length) return;
  const old = room.caps;
  room.caps = next;
  room.admitted?.peer?.send({ t: "caps.update", caps: next });
  rooms.metrics.inc("rs_control_total", { event: "caps_narrowed" });
  const jobs: Promise<void>[] = [];
  if (!next.includes("remote_control")) jobs.push(revokeControl(rooms, room, "permission"));
  jobs.push(
    writeAudit(rooms.db, SYSTEM_CTX, {
      tenantId: room.tenantId,
      ...SYSTEM,
      action: CONTROL_AUDIT.CAPS_CHANGED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      oldValue: { caps: old.join(",") },
      newValue: { caps: next.join(",") },
    }).catch((err: unknown) => void logFail(rooms, room, "caps_audit_failed", err)),
  );
  await Promise.all(jobs);
}
