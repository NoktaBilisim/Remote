// P5 konsol işbirliği sinyalleri (mimari-protokol §3; AC-46, AC-53, AC-55, AC-117, AC-119; db-notlari P5).
// `file.meta`: alıcının raporu session_files + audit (tek TX); gönderenin raporu yalnız audit (S-P5-3). Ad sunucuda da
// temizlenir. Kota raporlayan taraf × sınıf başına (S-P5-1; gönderen raporu ayrı `sender` sınıfı, S-P5-T2-3).
// `quality.summary`: yalnız tüketilmiş (ACTIVE) oturuma, periyodik üzerine yazma. İçerik hiçbir zaman WS'den geçmez.
import { maxFileBytes } from "@remote/contracts/dc";
import { sanitizeFileName } from "@remote/contracts/files";
import type { FileMeta, QualitySummary } from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { newId } from "../lib/ids.ts";
import type { Rooms } from "./rooms.ts";
import type { FileMetaClass, Peer, Room } from "./types.ts";

/** Ret/iptal (REJECTED/CANCELLED) raporları: taraf başına dakikada 20, oturum boyunca 500 (tablo şişirme koruması). */
export const FILE_META_PER_MIN = 20;
export const FILE_META_PER_SESSION = 500;
/** Kabul edilmiş transferin sonucu (OK/CORRUPT): ayrı ve yüksek kota; ret seli bunu tüketemez (S-P5-1). */
export const FILE_META_ACCEPTED_PER_MIN = 60;
export const FILE_META_ACCEPTED_PER_SESSION = 2000;
/** Gönderen raporu (`file.transfer.sender_report`): sonuçtan bağımsız ayrı ve düşük kota; meşru akışta transfer başına 1 (S-P5-T2-3). */
export const FILE_META_SENDER_PER_MIN = 10;
export const FILE_META_SENDER_PER_SESSION = 200;
/** `file.meta.rate_limited` audit'i oda + taraf + sınıf başına bu aralıkta en çok 1 kez (S-P5-T2-2). */
export const FILE_META_RATE_AUDIT_MS = 60_000;
/**
 * S-P13a-8 (KVKK): dosya aktarım audit'i (730 gün) dosya adı ve sha256 taşımaz — ad kişisel veri içerebilir, özet dosyayı
 * tanımlar; ikisi `session_files`'ta kalır ve saklama işiyle silinir. Audit'te yalnız uzantı: son noktadan sonrası,
 * ASCII harf/rakam, 1–10 karakter, küçük harf; adın başındaki nokta uzantı sayılmaz; uymazsa null.
 */
export function fileExtOf(name: string): string | null {
  const m = /^.+\.([A-Za-z0-9]{1,10})$/s.exec(name);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** Audit `newValue` (file.transfer, sender_report, rejected_by_db): yön, uzantı, boyut, sonuç. */
const fileAuditValue = (sessionId: string, m: FileMeta, name: string) => ({ sessionId, direction: m.direction, ext: fileExtOf(name), sizeBytes: String(m.sizeBytes), result: m.result });
/** `quality.summary` DB yazımları arası en kısa süre (istemci 60 sn'de bir + oturum sonunda gönderir). */
export const QUALITY_MIN_INTERVAL_MS = 5_000;
/** DB CHECK `JSON_STORAGE_SIZE(quality_summary) ≤ 4096` ile aynı tavan (metin uzunluğu üstten sınırlar). */
export const QUALITY_MAX_BYTES = 4096;

const GUEST_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };
const LIMITS: Record<FileMetaClass, { perMin: number; perSession: number }> = {
  accepted: { perMin: FILE_META_ACCEPTED_PER_MIN, perSession: FILE_META_ACCEPTED_PER_SESSION },
  declined: { perMin: FILE_META_PER_MIN, perSession: FILE_META_PER_SESSION },
  sender: { perMin: FILE_META_SENDER_PER_MIN, perSession: FILE_META_SENDER_PER_SESSION },
};

export type Reporter = { side: "tech"; peer: Peer } | { side: "guest"; peer: Peer };

const classOf = (m: FileMeta, isSender: boolean): FileMetaClass => {
  if (isSender) return "sender";
  return m.result === "OK" || m.result === "CORRUPT" ? "accepted" : "declined";
};

/** Sınır aşımında false döner (kayıt yazılmaz). Pencere sabit 60 sn; sayaç taraf × sınıf başına. */
function takeFileMetaSlot(rooms: Rooms, room: Room, side: Reporter["side"], cls: FileMetaClass): boolean {
  const now = rooms.clock.now();
  const key = `${side}:${cls}`;
  let q = room.fileMeta.quotas.get(key);
  if (!q) {
    q = { windowStart: now, inWindow: 0, total: 0 };
    room.fileMeta.quotas.set(key, q);
  }
  if (now - q.windowStart >= 60_000) {
    q.windowStart = now;
    q.inWindow = 0;
  }
  const lim = LIMITS[cls];
  if (q.inWindow >= lim.perMin || q.total >= lim.perSession) return false;
  q.inWindow += 1;
  q.total += 1;
  return true;
}

/** MySQL 3819 (CHECK ihlali) — Prisma 7 + mariadb adaptörü: meta.driverAdapterError.cause.code (db-notlari P5). */
export function isCheckViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const cause = (err as { meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } } }).meta?.driverAdapterError?.cause;
  return cause?.code === 3819 || cause?.originalCode === "3819";
}

export type FileMetaResult = "recorded" | "sender_reported" | "forbidden" | "rate_limited" | "too_large" | "rejected_by_db" | "error";

export async function handleFileMeta(rooms: Rooms, room: Room, from: Reporter, m: FileMeta): Promise<FileMetaResult> {
  // G-09/AC-119: teknisyenin dosya yetkisi yoksa (caps'te yok) meta da kabul edilmez.
  if (!room.caps.includes("file_transfer")) {
    from.peer.send({ t: "error", code: "FORBIDDEN", message: "Bu oturumda dosya transferi yetkisi yok." });
    rooms.metrics.inc("rs_file_meta_total", { result: "forbidden" });
    return "forbidden";
  }
  // AC-53: tenant sınırını aşan dosya OK olamaz (alıcı bayt sayacı iptal eder); sahte rapor reddedilir.
  if (m.result === "OK" && m.sizeBytes > maxFileBytes(room.maxFileMb ?? 0)) {
    from.peer.send({ t: "error", code: "FORBIDDEN", message: "Dosya boyutu tenant sınırını aşıyor." });
    rooms.metrics.inc("rs_file_meta_total", { result: "too_large" });
    return "too_large";
  }
  const tech = room.tech;
  const actor = from.side === "tech" && tech ? { userId: tech.userId, username: tech.username } : { username: "customer" };
  const ctx = from.side === "tech" && tech ? tech.ctx : GUEST_CTX;
  const receiver = m.direction === "TO_CUSTOMER" ? "guest" : "tech";
  const cls = classOf(m, from.side !== receiver);
  if (!takeFileMetaSlot(rooms, room, from.side, cls)) {
    from.peer.send({ t: "error", code: "RATE_LIMITED", message: "Dosya kaydı sınırı aşıldı." });
    rooms.metrics.inc("rs_file_meta_total", { result: "rate_limited" });
    rooms.metrics.inc("rs_file_meta_rate_limited_total", { class: cls });
    rooms.log.warn({ event: "file_meta_rate_limited", sessionId: room.sessionId, side: from.side, class: cls }, "file.meta hız sınırı");
    await auditRateLimited(rooms, room, ctx, actor, from.side, cls);
    return "rate_limited";
  }

  const fileName = sanitizeFileName(m.fileName);
  const value = fileAuditValue(room.sessionId, m, fileName);
  const outcome = m.result === "OK" ? "success" : "fail";
  try {
    if (from.side !== receiver) {
      // S-P5-3: gönderenin raporu session_files'a yazılmaz (tek kaynak alıcı), ama audit'te kalır — TO_TECH'te teknisyen
      // raporlamasa da müşteri tarafının izi olur.
      await writeAudit(rooms.db, ctx, { tenantId: room.tenantId, ...actor, action: "file.transfer.sender_report", entity: "support_sessions", entityId: room.sessionId, result: outcome, newValue: value });
      rooms.metrics.inc("rs_file_meta_total", { result: "sender_reported" });
      return "sender_reported";
    }
    const id = newId();
    await rooms.db.$transaction(async (tx) => {
      await tx.sessionFile.create({
        data: { id, sessionId: room.sessionId, tenantId: room.tenantId, direction: m.direction, fileName, sizeBytes: BigInt(m.sizeBytes), sha256: m.sha256, result: m.result },
      });
      await writeAudit(tx, ctx, { tenantId: room.tenantId, ...actor, action: "file.transfer", entity: "session_files", entityId: id, result: outcome, newValue: value });
    });
  } catch (err) {
    if (isCheckViolation(err)) return rejectedByDb(rooms, room, from, ctx, actor, m);
    const ref = newId();
    rooms.log.error({ err, ref, event: "file_meta_write_failed", sessionId: room.sessionId }, "file.meta yazılamadı");
    rooms.metrics.inc("rs_file_meta_total", { result: "error" });
    return "error";
  }
  rooms.metrics.inc("rs_file_meta_total", { result: "recorded" });
  return "recorded";
}

type Actor = { userId?: string; username: string };

/** S-P5-1: kota aşımı sessiz kalmaz — oda + taraf + sınıf başına dakikada en çok 1 audit satırı (S-P5-T2-2: bir tarafın
 * aşımı diğer tarafın aynı dakikadaki aşım kaydını bastıramaz). */
async function auditRateLimited(rooms: Rooms, room: Room, ctx: AuditContext, actor: Actor, side: Reporter["side"], cls: FileMetaClass): Promise<void> {
  const now = rooms.clock.now();
  const key = `${side}:${cls}`;
  const last = room.fileMeta.auditAt.get(key);
  if (last !== undefined && now - last < FILE_META_RATE_AUDIT_MS) return;
  room.fileMeta.auditAt.set(key, now);
  try {
    await writeAudit(rooms.db, ctx, { tenantId: room.tenantId, ...actor, action: "file.meta.rate_limited", entity: "support_sessions", entityId: room.sessionId, result: "fail", newValue: { sessionId: room.sessionId, side, class: cls } });
  } catch (err) {
    rooms.log.error({ err, ref: newId(), event: "file_meta_rate_audit_failed", sessionId: room.sessionId }, "file.meta.rate_limited audit yazılamadı");
  }
}

/** S-P5-8: JS ve MySQL Unicode sürüm farkıyla CHECK (3819) reddi sessiz kalmaz: audit (ad yok, yalnız uzantı) + VALIDATION. */
async function rejectedByDb(rooms: Rooms, room: Room, from: Reporter, ctx: AuditContext, actor: Actor, m: FileMeta): Promise<FileMetaResult> {
  rooms.metrics.inc("rs_file_meta_total", { result: "rejected_by_db" });
  rooms.log.warn({ event: "file_meta_rejected_by_db", sessionId: room.sessionId }, "file.meta DB CHECK reddi");
  try {
    await writeAudit(rooms.db, ctx, {
      tenantId: room.tenantId, ...actor, action: "file.meta.rejected_by_db", entity: "support_sessions", entityId: room.sessionId, result: "fail",
      newValue: fileAuditValue(room.sessionId, m, sanitizeFileName(m.fileName)),
    });
  } catch (err) {
    rooms.log.error({ err, ref: newId(), event: "file_meta_rejected_audit_failed", sessionId: room.sessionId }, "file.meta.rejected_by_db audit yazılamadı");
  }
  from.peer.send({ t: "error", code: "VALIDATION", message: "Dosya adı kaydedilemedi." });
  return "rejected_by_db";
}

export type QualityResult = "written" | "throttled" | "too_large" | "not_active" | "error";

export async function handleQualitySummary(rooms: Rooms, room: Room, q: QualitySummary): Promise<QualityResult> {
  if (!room.admitted) return "not_active";
  const now = rooms.clock.now();
  if (room.qualityAt !== undefined && now - room.qualityAt < QUALITY_MIN_INTERVAL_MS) return "throttled";
  const summary = { fps: q.fps, kbps: q.kbps, rttMs: q.rttMs, connType: q.connType };
  if (JSON.stringify(summary).length > QUALITY_MAX_BYTES) return "too_large";
  room.qualityAt = now;
  try {
    const r = await rooms.db.supportSession.updateMany({ where: { id: room.sessionId, tenantId: room.tenantId, consumedAt: { not: null } }, data: { qualitySummary: summary } });
    return r.count === 1 ? "written" : "not_active";
  } catch (err) {
    const ref = newId();
    rooms.log.error({ err, ref, event: "quality_summary_write_failed", sessionId: room.sessionId }, "quality.summary yazılamadı");
    return "error";
  }
}
