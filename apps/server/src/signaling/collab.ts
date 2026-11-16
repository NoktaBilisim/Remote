// P5 konsol işbirliği sinyalleri (mimari-protokol §3; AC-46, AC-53, AC-55, AC-117, AC-119; db-notlari P5).
// `file.meta`: alıcının raporu session_files + audit (tek TX); P15 (AC-238): `fid`'li gönderen raporu da ayrı satır
// (`reported_by`, `match_key` ile eşlenir); fid'siz gönderen raporu yalnız audit (S-P5-3). Ad sunucuda da
// temizlenir. Kota raporlayan taraf × sınıf başına (S-P5-1; gönderen raporu ayrı `sender` sınıfı, S-P5-T2-3).
// `quality.summary`: yalnız tüketilmiş (ACTIVE) oturuma, periyodik üzerine yazma. İçerik hiçbir zaman WS'den geçmez.
import { maxFileBytes } from "@remote/contracts/dc";
import { sanitizeFileName } from "@remote/contracts/files";
import type { FileMeta, QualitySummary } from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { newId } from "../lib/ids.ts";
import {
  auditRateLimited,
  recordFileMeta,
  senderReportOnly,
  type Actor,
  type FileMetaResult,
  type FileMetaWrite,
  type Reporter,
} from "./file-meta-store.ts";
import { controllerOf } from "./members.ts";
import type { Rooms } from "./rooms.ts";
import type { FileMetaClass, Room } from "./types.ts";

/** Ret/iptal (REJECTED/CANCELLED) raporları: taraf başına dakikada 20, oturum boyunca 500 (tablo şişirme koruması). */
export const FILE_META_PER_MIN = 20;
const FILE_META_PER_SESSION = 500;
/** Kabul edilmiş transferin sonucu (OK/CORRUPT): ayrı ve yüksek kota; ret seli bunu tüketemez (S-P5-1). */
export const FILE_META_ACCEPTED_PER_MIN = 60;
const FILE_META_ACCEPTED_PER_SESSION = 2000;
/** Gönderen raporu (`file.transfer.sender_report`): sonuçtan bağımsız ayrı ve düşük kota; meşru akışta transfer başına 1 (S-P5-T2-3). */
export const FILE_META_SENDER_PER_MIN = 10;
export const FILE_META_SENDER_PER_SESSION = 200;
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
const fileAuditValue = (sessionId: string, m: FileMeta, name: string) => ({
  sessionId,
  direction: m.direction,
  ext: fileExtOf(name),
  sizeBytes: String(m.sizeBytes),
  result: m.result,
});
/** `quality.summary` DB yazımları arası en kısa süre (istemci 60 sn'de bir + oturum sonunda gönderir). */
const QUALITY_MIN_INTERVAL_MS = 5_000;
/** DB CHECK `JSON_STORAGE_SIZE(quality_summary) ≤ 4096` ile aynı tavan (metin uzunluğu üstten sınırlar). */
const QUALITY_MAX_BYTES = 4096;

const GUEST_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };
const LIMITS: Record<FileMetaClass, { perMin: number; perSession: number }> = {
  accepted: { perMin: FILE_META_ACCEPTED_PER_MIN, perSession: FILE_META_ACCEPTED_PER_SESSION },
  declined: { perMin: FILE_META_PER_MIN, perSession: FILE_META_PER_SESSION },
  sender: { perMin: FILE_META_SENDER_PER_MIN, perSession: FILE_META_SENDER_PER_SESSION },
};

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
function isCheckViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const cause = (err as { meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } } }).meta?.driverAdapterError
    ?.cause;
  return cause?.code === 3819 || cause?.originalCode === "3819";
}

/** Prisma P2002 (UQ session_id+match_key+reported_by): aynı taraf aynı aktarımı ikinci kez raporladı → yok sayılır. */
const isDuplicate = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";

export async function handleFileMeta(rooms: Rooms, room: Room, from: Reporter, m: FileMeta): Promise<FileMetaResult> {
  // P28b §5.4 b (AC-355): SERVER odasında DC dosya yolu yok — rapor yok sayılır (session_files'ı sunucu kendisi yazar).
  if (room.fileMode === "SERVER") {
    rooms.metrics.inc("rs_fsrv_denied_total", { reason: "dc_meta" });
    rooms.log.warn({ event: "fsrv_dc_meta_ignored", sessionId: room.sessionId, side: from.side }, "SERVER odasında file.meta yok sayıldı");
    return "server_mode";
  }
  const refused = refuseFileMeta(rooms, room, from, m);
  if (refused) return refused;
  const tech = controllerOf(room); // P28c: file.meta yalnız kontrol sahibinden (rol kapısı)
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
  const w: FileMetaWrite = {
    from,
    ctx,
    actor,
    m,
    fileName,
    value: fileAuditValue(room.sessionId, m, fileName),
    outcome: m.result === "OK" ? "success" : "fail",
    isSender: from.side !== receiver,
  };
  try {
    // S-P5-3 (fid'siz 0.10.x istemci): gönderenin raporu session_files'a yazılmaz (eşlenemez), ama audit'te kalır.
    if (w.isSender && m.fid === undefined) return await senderReportOnly(rooms, room, w);
    await recordFileMeta(rooms, room, w);
  } catch (err) {
    return fileMetaFailed(rooms, room, w, err);
  }
  rooms.metrics.inc("rs_file_meta_total", { result: w.isSender ? "sender_reported" : "recorded" });
  return w.isSender ? "sender_reported" : "recorded";
}

/** G-09/AC-119 yetki ve AC-53 boyut kapısı; geçerse null. */
function refuseFileMeta(rooms: Rooms, room: Room, from: Reporter, m: FileMeta): FileMetaResult | null {
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
  return null;
}

function fileMetaFailed(rooms: Rooms, room: Room, w: FileMetaWrite, err: unknown): FileMetaResult | Promise<FileMetaResult> {
  if (isDuplicate(err)) {
    rooms.metrics.inc("rs_file_meta_total", { result: "duplicate" });
    return "duplicate";
  }
  if (isCheckViolation(err)) return rejectedByDb(rooms, room, w.from, w.ctx, w.actor, w.m);
  const ref = newId();
  rooms.log.error({ err, ref, event: "file_meta_write_failed", sessionId: room.sessionId }, "file.meta yazılamadı");
  rooms.metrics.inc("rs_file_meta_total", { result: "error" });
  return "error";
}

/** S-P5-8: JS ve MySQL Unicode sürüm farkıyla CHECK (3819) reddi sessiz kalmaz: audit (ad yok, yalnız uzantı) + VALIDATION. */
async function rejectedByDb(
  rooms: Rooms,
  room: Room,
  from: Reporter,
  ctx: AuditContext,
  actor: Actor,
  m: FileMeta,
): Promise<FileMetaResult> {
  rooms.metrics.inc("rs_file_meta_total", { result: "rejected_by_db" });
  rooms.log.warn({ event: "file_meta_rejected_by_db", sessionId: room.sessionId }, "file.meta DB CHECK reddi");
  try {
    await writeAudit(rooms.db, ctx, {
      tenantId: room.tenantId,
      ...actor,
      action: "file.meta.rejected_by_db",
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "fail",
      newValue: fileAuditValue(room.sessionId, m, sanitizeFileName(m.fileName)),
    });
  } catch (err) {
    rooms.log.error(
      { err, ref: newId(), event: "file_meta_rejected_audit_failed", sessionId: room.sessionId },
      "file.meta.rejected_by_db audit yazılamadı",
    );
  }
  from.peer.send({ t: "error", code: "VALIDATION", message: "Dosya adı kaydedilemedi." });
  return "rejected_by_db";
}

type QualityResult = "written" | "throttled" | "too_large" | "not_active" | "error";

export async function handleQualitySummary(rooms: Rooms, room: Room, q: QualitySummary): Promise<QualityResult> {
  if (!room.admitted) return "not_active";
  const now = rooms.clock.now();
  if (room.qualityAt !== undefined && now - room.qualityAt < QUALITY_MIN_INTERVAL_MS) return "throttled";
  const summary = { fps: q.fps, kbps: q.kbps, rttMs: q.rttMs, connType: q.connType };
  if (JSON.stringify(summary).length > QUALITY_MAX_BYTES) return "too_large";
  room.qualityAt = now;
  try {
    const r = await rooms.db.supportSession.updateMany({
      where: { id: room.sessionId, tenantId: room.tenantId, consumedAt: { not: null } },
      data: { qualitySummary: summary },
    });
    return r.count === 1 ? "written" : "not_active";
  } catch (err) {
    const ref = newId();
    rooms.log.error({ err, ref, event: "quality_summary_write_failed", sessionId: room.sessionId }, "quality.summary yazılamadı");
    return "error";
  }
}
