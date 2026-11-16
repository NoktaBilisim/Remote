// P28a pano + uzaktan yazdırma sunucu kapısı (mimari-p28 §4.3, §8; r2 Y-P28a-1, O-P28a-1/4/5; AC-343..352). İçerik
// (pano metni, PDF, dosya adı, hash) sunucudan geçmez: WS yalnız kimlik + bayt + sonuç taşır, sunucu alanları yeniden
// kurar. Kapı reddi audit'e yazılmaz (metrik + log, K-P28a-8); tamamlanan/zaman aşımına uğrayan işler audit'e yazılır.
import { CLIP_PRINT_AUDIT } from "@remote/contracts/audit";
import {
  CLIP_CONSENT_PER_MIN,
  CLIP_PENDING_TIMEOUT_MS,
  CLIP_PER_MIN,
  ID_REUSE_WINDOW,
  PRINT_DENY_COOLDOWN_MS,
  PRINT_PENDING_TIMEOUT_MS,
  PRINT_PER_SESSION,
  type ClipConsentReason,
  type ClipDirection,
  type ClipResult,
  type GuestFeature,
  type PrintDecision,
  type PrintResult,
} from "@remote/contracts/ws-clip-print";
import type { JsonObject } from "../audit/mask.ts";
import { printDone } from "../fsrv/lifecycle.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { CUSTOMER, guestCtx, logFail, SYSTEM, SYSTEM_CTX } from "./control-record.ts";
import type { Rooms } from "./rooms.ts";
import { guestFeatures, hasFsrv } from "./rooms-features.ts";
import type { ClipPrintActor, ClipPrintRoom, Guest, Room, TechConn } from "./types.ts";

const MINUTE_MS = 60_000;
const LOG_INTERVAL_MS = 60_000;

export function newClipPrint(): ClipPrintRoom {
  return {
    consent: false,
    consentTimes: [],
    clipPending: null,
    clipTimes: [],
    printPending: null,
    printCount: 0,
    printCooldownUntil: 0,
    usedIds: [],
  };
}

type Kind = "clip" | "print" | "consent";
type DenyCode = "FORBIDDEN" | "CONFLICT" | "RATE_LIMITED" | "VALIDATION";
type Denial = { code: DenyCode; reason: string; message: string };
const deny = (code: DenyCode, reason: string, message: string): Denial => ({ code, reason, message });

/** Metrik her zaman; log (yalnız olay + neden, içerik/kimlik yok) oda başına dakikada en çok 1. */
function noteDenied(rooms: Rooms, room: Room, kind: Kind, reason: string): void {
  rooms.metrics.inc("rs_clip_print_denied_total", { kind, reason });
  const cp = room.clipPrint;
  const now = rooms.clock.now();
  if (cp.logAt !== undefined && now - cp.logAt < LOG_INTERVAL_MS) return;
  cp.logAt = now;
  rooms.log.warn({ event: "ws_clip_print_denied", kind, reason, sessionId: room.sessionId }, "pano/yazdırma isteği reddedildi");
}

function refuse(rooms: Rooms, room: Room, tech: TechConn, kind: Kind, d: Denial): void {
  tech.peer.send({ t: "error", code: d.code, message: d.message });
  noteDenied(rooms, room, kind, d.reason);
}

/**
 * Bu teknisyen bu özelliği kullanabilir mi (§0 madde 8): P28c genişleme noktası — bugün oturum sahibi teknisyen +
 * yetki + oturum caps'i (yetki daralınca caps da daralır).
 */
export function actorMay(room: Room, tech: TechConn, feature: GuestFeature): boolean {
  const perm = feature === "clipboard" ? "remote_control.clipboard" : "file_transfer.print";
  return room.tech === tech && tech.permissions.has(perm) && room.caps.includes(feature);
}

/** Ortak kapı adımları (§4.3): misafir → özellik → kontrol izni. */
function guestGate(room: Room, feature: GuestFeature): Denial | null {
  const g = room.admitted;
  if (!g?.peer) return deny("CONFLICT", "no_guest", "Müşteri bağlı değil.");
  // P28b §5.3–5.4: SERVER odasında yazdırma yalnız sunucu yolundan — fsrv'siz (≤ 0.13) istemciye iletilmez.
  const serverPathMissing = feature === "print" && room.fileMode === "SERVER" && !hasFsrv(room, g.peer);
  if (g.kind !== "AGENT" || !guestFeatures(room).has(feature) || serverPathMissing)
    return deny("FORBIDDEN", "feature", "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin.");
  if (room.control.state !== "GRANTED") return deny("FORBIDDEN", "control", "Önce uzaktan kontrol izni alın.");
  return null;
}

/** r2 O-P28a-1 m.3: iletilmiş son 64 kimlik tekrar kullanılamaz. */
const reused = (cp: ClipPrintRoom, id: string): Denial | null =>
  cp.usedIds.includes(id) ? deny("VALIDATION", "reuse", "Bu işlem kimliği daha önce kullanıldı.") : null;

function remember(cp: ClipPrintRoom, id: string): void {
  cp.usedIds.push(id);
  if (cp.usedIds.length > ID_REUSE_WINDOW) cp.usedIds.shift();
}

const recent = (times: number[], now: number): number[] => times.filter((t) => now - t < MINUTE_MS);

const actorOf = (t: TechConn): ClipPrintActor => ({ userId: t.userId, username: t.username, ctx: t.ctx });

function audit(rooms: Rooms, room: Room, ctx: AuditContext, actor: { userId?: string; username: string }, a: AuditFields): Promise<void> {
  return writeAudit(rooms.db, ctx, {
    tenantId: room.tenantId,
    ...actor,
    action: a.action,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: a.ok ? "success" : "fail",
    newValue: a.value,
  }).catch((err: unknown) => void logFail(rooms, room, "clip_print_audit_failed", err));
}
type AuditFields = { action: string; ok: boolean; value: JsonObject };

// --- Pano (clip.push / clip.pull / clip.report) ---

function clipRefusal(rooms: Rooms, room: Room, tech: TechConn, cid: string): Denial | null {
  const cp = room.clipPrint;
  if (!actorMay(room, tech, "clipboard")) return deny("FORBIDDEN", "permission", "Pano yetkiniz yok.");
  const g = guestGate(room, "clipboard");
  if (g) return g;
  if (!cp.consent) return deny("FORBIDDEN", "consent", "Müşteri pano iznini açmadı.");
  if (cp.clipPending) return deny("CONFLICT", "pending", "Önceki pano işlemi sürüyor.");
  cp.clipTimes = recent(cp.clipTimes, rooms.clock.now());
  if (cp.clipTimes.length >= CLIP_PER_MIN) return deny("RATE_LIMITED", "rate", "Pano istek sınırına ulaşıldı; biraz sonra tekrar deneyin.");
  return reused(cp, cid);
}

/** clip.push (TO_CUSTOMER, `bytes` ile) / clip.pull (TO_TECH) — §4.3 kapı sırası; geçerse misafire iletilir. */
export function handleClipRequest(rooms: Rooms, room: Room, tech: TechConn, m: { cid: string; bytes?: number }): boolean {
  const d = clipRefusal(rooms, room, tech, m.cid);
  const guest = room.admitted?.peer;
  if (d || !guest) {
    refuse(rooms, room, tech, "clip", d ?? deny("CONFLICT", "no_guest", "Müşteri bağlı değil."));
    return false;
  }
  const cp = room.clipPrint;
  const dir: ClipDirection = m.bytes === undefined ? "TO_TECH" : "TO_CUSTOMER";
  remember(cp, m.cid);
  cp.clipTimes.push(rooms.clock.now());
  const timer = rooms.clock.setTimeout(() => finishClip(rooms, room, "TIMEOUT", 0, "server"), CLIP_PENDING_TIMEOUT_MS);
  cp.clipPending = { cid: m.cid, dir, actor: actorOf(tech), timer };
  guest.send(m.bytes === undefined ? { t: "clip.pull", cid: m.cid } : { t: "clip.push", cid: m.cid, bytes: m.bytes });
  return true;
}

/** Bekleyen pano işini kapatır: audit `clipboard.transfer` + metrik + teknisyene `clip.status`. */
function finishClip(rooms: Rooms, room: Room, result: ClipResult, bytes: number, reportedBy: "customer" | "server"): void {
  const cp = room.clipPrint;
  const p = cp.clipPending;
  if (!p) return;
  cp.clipPending = null;
  rooms.clock.clearTimeout(p.timer);
  rooms.metrics.inc("rs_clipboard_transfer_total", { direction: p.dir, result });
  room.tech?.peer.send({ t: "clip.status", cid: p.cid, result, bytes });
  void audit(
    rooms,
    room,
    p.actor.ctx,
    { userId: p.actor.userId, username: p.actor.username },
    {
      action: CLIP_PRINT_AUDIT.CLIPBOARD_TRANSFER,
      ok: result === "OK",
      value: { direction: p.dir, bytes, result, reportedBy },
    },
  );
}

/** clip.report (guest → S): yalnız bekleyen cid + yön eşleşirse; aksi yok say + log. */
export function handleClipReport(
  rooms: Rooms,
  room: Room,
  m: { cid: string; dir: ClipDirection; bytes: number; result: Exclude<ClipResult, "DISCONNECTED"> },
): void {
  const p = room.clipPrint.clipPending;
  if (p?.cid !== m.cid || p.dir !== m.dir) return noteDenied(rooms, room, "clip", "unmatched_report");
  finishClip(rooms, room, m.result, m.bytes, "customer");
}

// --- Müşteri pano anahtarı (clip.consent) ---

/**
 * clip.consent (guest → S → tech; §4.3, r2 O-P28a-5): aynı değer no-op; açma yalnız oturum caps'inde `clipboard` varken
 * (D-P28aK-2), kontrol GRANTED iken ve dakikada en çok 6 değişim içinde (aşan: misafire `{on:false}`, audit yok, metrik).
 * Kapatma yönü sınırlanmaz (fail-closed).
 */
export function handleClipConsent(rooms: Rooms, room: Room, guest: Guest, on: boolean): void {
  const cp = room.clipPrint;
  if (on === cp.consent) return;
  const now = rooms.clock.now();
  cp.consentTimes = recent(cp.consentTimes, now);
  if (on && !room.caps.includes("clipboard")) {
    guest.peer?.send({ t: "clip.consent", on: false });
    return noteDenied(rooms, room, "consent", "permission");
  }
  if (on && room.control.state !== "GRANTED") {
    guest.peer?.send({ t: "clip.consent", on: false });
    return noteDenied(rooms, room, "consent", "control");
  }
  if (on && cp.consentTimes.length >= CLIP_CONSENT_PER_MIN) {
    guest.peer?.send({ t: "clip.consent", on: false });
    return noteDenied(rooms, room, "consent", "rate");
  }
  cp.consent = on;
  cp.consentTimes.push(now);
  room.tech?.peer.send({ t: "clip.consent", on });
  void audit(rooms, room, guestCtx(guest), CUSTOMER, {
    action: CLIP_PRINT_AUDIT.CLIPBOARD_CONSENT,
    ok: true,
    value: { on, by: "customer" },
  });
}

/** Sunucu kapatır (§8.1 `by:"system"`); yalnız açıkken. `notifyGuest`: misafire `clip.consent{on:false}` (bağlıysa). */
function closeConsent(rooms: Rooms, room: Room, reason: ClipConsentReason, notifyGuest: boolean): void {
  const cp = room.clipPrint;
  if (!cp.consent) return;
  cp.consent = false;
  if (notifyGuest) room.admitted?.peer?.send({ t: "clip.consent", on: false });
  room.tech?.peer.send({ t: "clip.consent", on: false });
  void audit(rooms, room, SYSTEM_CTX, SYSTEM, {
    action: CLIP_PRINT_AUDIT.CLIPBOARD_CONSENT,
    ok: true,
    value: { on: false, by: "system", reason },
  });
}

// --- Yazdırma (print.request / print.cancel / print.report) ---

function printRefusal(rooms: Rooms, room: Room, tech: TechConn, pid: string): Denial | null {
  const cp = room.clipPrint;
  if (!actorMay(room, tech, "print")) return deny("FORBIDDEN", "permission", "Uzaktan yazdırma yetkiniz yok.");
  const g = guestGate(room, "print"); // r2 Y-P28a-1 (3b): kontrol GRANTED şartı dahil
  if (g) return g;
  if (cp.printPending) return deny("CONFLICT", "pending", "Önceki yazdırma işi sürüyor.");
  if (cp.printCooldownUntil > rooms.clock.now())
    return deny("RATE_LIMITED", "cooldown", "Müşteri reddetti veya yanıt vermedi; 30 sn sonra tekrar deneyin.");
  if (cp.printCount >= PRINT_PER_SESSION) return deny("RATE_LIMITED", "limit", "Bu oturumda yazdırma sınırına ulaşıldı.");
  return reused(cp, pid);
}

/** print.request (tech → S → guest; §4.3). Dosya adı ve hash WS'den geçmez. */
export function handlePrintRequest(rooms: Rooms, room: Room, tech: TechConn, m: { pid: string; sizeBytes: number }): boolean {
  const d = printRefusal(rooms, room, tech, m.pid);
  const guest = room.admitted?.peer;
  if (d || !guest) {
    refuse(rooms, room, tech, "print", d ?? deny("CONFLICT", "no_guest", "Müşteri bağlı değil."));
    return false;
  }
  const cp = room.clipPrint;
  remember(cp, m.pid);
  cp.printCount += 1;
  const timer = rooms.clock.setTimeout(
    () => finishPrint(rooms, room, { decision: "NONE", result: "ABANDONED", reportedBy: "server" }),
    PRINT_PENDING_TIMEOUT_MS,
  );
  cp.printPending = { pid: m.pid, sizeBytes: m.sizeBytes, actor: actorOf(tech), timer };
  guest.send({ t: "print.request", pid: m.pid, sizeBytes: m.sizeBytes });
  return true;
}

/** print.cancel (tech → S → guest): yalnız bekleyen pid'e iletilir; sonucu misafirin `print.report{CANCELLED}`'ı kapatır. */
export function handlePrintCancel(rooms: Rooms, room: Room, tech: TechConn, pid: string): void {
  const p = room.clipPrint.printPending;
  if (room.tech !== tech || p?.pid !== pid) return noteDenied(rooms, room, "print", "unmatched_cancel");
  room.admitted?.peer?.send({ t: "print.cancel", pid });
}

type PrintOutcome = { decision: PrintDecision; result: PrintResult; pages?: number; reportedBy: "customer" | "server" };

/** Bekleyen yazdırmayı kapatır: audit `print.job` (dosya adı/hash yok, AC-351) + metrik + teknisyene `print.status`. */
function finishPrint(rooms: Rooms, room: Room, o: PrintOutcome): void {
  const cp = room.clipPrint;
  const p = cp.printPending;
  if (!p) return;
  cp.printPending = null;
  rooms.clock.clearTimeout(p.timer);
  if (o.decision === "REJECTED" || o.decision === "TIMEOUT") cp.printCooldownUntil = rooms.clock.now() + PRINT_DENY_COOLDOWN_MS;
  rooms.metrics.inc("rs_print_job_total", { result: o.result });
  room.tech?.peer.send({ t: "print.status", pid: p.pid, result: o.result, ...(o.pages !== undefined ? { pages: o.pages } : {}) });
  void audit(
    rooms,
    room,
    p.actor.ctx,
    { userId: p.actor.userId, username: p.actor.username },
    {
      action: CLIP_PRINT_AUDIT.PRINT_JOB,
      ok: o.result === "PRINTED",
      value: {
        decision: o.decision,
        ...(o.pages !== undefined ? { pages: o.pages } : {}),
        sizeBytes: p.sizeBytes,
        result: o.result,
        reportedBy: o.reportedBy,
      },
    },
  );
  // P28b §3.2/§5.3: P28a son durumu → bekleyen PRINT aktarımının diski silinir (EXPIRED).
  const svc = rooms.fsrv;
  if (svc && room.fileMode === "SERVER")
    void printDone(svc, room.sessionId, p.pid).catch((err: unknown) => void logFail(rooms, room, "fsrv_print_done_failed", err));
}

/**
 * P28b §5.3 (D-P28b-3): SERVER modunda yazdırma belgesi virüslü / taranamadı / kapıda reddedildi → misafire `print.cancel`
 * (Go bekleyen işi kapatır), teknisyene `print.status{ERROR}`, audit `reportedBy:"server"`. Yalnız bekleyen pid.
 */
export function failPrint(rooms: Rooms, room: Room, pid: string): void {
  if (room.clipPrint.printPending?.pid !== pid) return;
  room.admitted?.peer?.send({ t: "print.cancel", pid });
  finishPrint(rooms, room, { decision: "NONE", result: "ERROR", reportedBy: "server" });
}

/** print.report (guest → S): yalnız bekleyen pid; boyut sunucunun yetkilediği değerdir (misafir beyanı audit'e girmez). */
export function handlePrintReport(
  rooms: Rooms,
  room: Room,
  m: { pid: string; decision: PrintDecision; result: Exclude<PrintResult, "ABANDONED" | "DISCONNECTED">; pages?: number | undefined },
): void {
  if (room.clipPrint.printPending?.pid !== m.pid) return noteDenied(rooms, room, "print", "unmatched_report");
  finishPrint(rooms, room, {
    decision: m.decision,
    result: m.result,
    ...(m.pages !== undefined ? { pages: m.pages } : {}),
    reportedBy: "customer",
  });
}

/** r2 Y-P28a-1: bekleyen yazdırma sunucuda iptal — misafire `print.cancel`, teknisyene `CANCELLED`, audit `reportedBy:"server"`. */
function cancelPrint(rooms: Rooms, room: Room): void {
  const p = room.clipPrint.printPending;
  if (!p) return;
  room.admitted?.peer?.send({ t: "print.cancel", pid: p.pid });
  finishPrint(rooms, room, { decision: "NONE", result: "CANCELLED", reportedBy: "server" });
}

// --- Yaşam döngüsü kancaları (control-*.ts, rooms.ts) ---

/** Kontrol VIEW'a her dönüşte (§2, r2 Y-P28a-1): pano izni kapanır, bekleyen yazdırma iptal edilir. İdempotent. */
export function onControlClosed(rooms: Rooms, room: Room): void {
  closeConsent(rooms, room, "control_closed", true);
  cancelPrint(rooms, room);
}

/** Yetki daralması (G-09): `clipboard` düştüyse izin kapanır, `print` düştüyse bekleyen yazdırma iptal edilir. */
export function onCapsNarrowed(rooms: Rooms, room: Room): void {
  if (!room.caps.includes("clipboard")) closeConsent(rooms, room, "permission", true);
  if (!room.caps.includes("print")) cancelPrint(rooms, room);
}

/**
 * Misafir koptu (A4, `disconnect`) / oturum bitti (teardown, `session_ended`): açık izin sistemce kapanır, bekleyen işler
 * `DISCONNECTED` (sunucu üretir, audit dahil); zamanlayıcılar temizlenir. Misafire mesaj gitmez (bağlı değil).
 */
export function onGuestGone(rooms: Rooms, room: Room, reason: "disconnect" | "session_ended"): void {
  closeConsent(rooms, room, reason, false);
  finishClip(rooms, room, "DISCONNECTED", 0, "server");
  finishPrint(rooms, room, { decision: "NONE", result: "DISCONNECTED", reportedBy: "server" });
}
