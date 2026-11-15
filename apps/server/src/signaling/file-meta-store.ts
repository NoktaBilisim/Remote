// P5/P15 `file.meta` kayıt yolları (collab.ts akışının DB/audit adımları): alıcı/gönderen raporu satırı + audit (tek TX),
// fid'siz gönderen raporu yalnız audit (S-P5-3), kota aşımı audit'i (S-P5-1, S-P5-T2-2). Ad audit'e yazılmaz (S-P13a-8).
import type { FileMeta } from "@remote/contracts/ws";
import type { JsonObject } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { newId, sha256Hex } from "../lib/ids.ts";
import type { Rooms } from "./rooms.ts";
import type { FileMetaClass, Peer, Room } from "./types.ts";

/** `file.meta.rate_limited` audit'i oda + taraf + sınıf başına bu aralıkta en çok 1 kez (S-P5-T2-2). */
export const FILE_META_RATE_AUDIT_MS = 60_000;
export type Reporter = { side: "tech"; peer: Peer } | { side: "guest"; peer: Peer };

export type FileMetaResult =
  "recorded" | "sender_reported" | "duplicate" | "forbidden" | "rate_limited" | "too_large" | "rejected_by_db" | "error";

export type Actor = { userId?: string; username: string };

export type FileMetaWrite = {
  from: Reporter;
  ctx: AuditContext;
  actor: Actor;
  m: FileMeta;
  fileName: string;
  value: JsonObject;
  outcome: "success" | "fail";
  isSender: boolean;
};

export async function senderReportOnly(rooms: Rooms, room: Room, w: FileMetaWrite): Promise<FileMetaResult> {
  await writeAudit(rooms.db, w.ctx, {
    tenantId: room.tenantId,
    ...w.actor,
    action: "file.transfer.sender_report",
    entity: "support_sessions",
    entityId: room.sessionId,
    result: w.outcome,
    newValue: w.value,
  });
  rooms.metrics.inc("rs_file_meta_total", { result: "sender_reported" });
  return "sender_reported";
}

/** P15 (AC-238): fid varsa iki tarafın raporu da ayrı satır (`reported_by` = raporlayan bağlantının rolü); satır + audit tek TX. */
export async function recordFileMeta(rooms: Rooms, room: Room, w: FileMetaWrite): Promise<void> {
  const { m } = w;
  const id = newId();
  const reportedBy = w.from.side === "tech" ? "TECH" : "CUSTOMER";
  const matchKey = fileMatchKey(room.sessionId, m, m.fid ?? `legacy:${id}`);
  await rooms.db.$transaction(async (tx) => {
    await tx.sessionFile.create({
      data: {
        id,
        sessionId: room.sessionId,
        tenantId: room.tenantId,
        direction: m.direction,
        fileName: w.fileName,
        sizeBytes: BigInt(m.sizeBytes),
        sha256: m.sha256,
        result: m.result,
        reportedBy,
        matchKey,
      },
    });
    await writeAudit(tx, w.ctx, {
      tenantId: room.tenantId,
      ...w.actor,
      action: w.isSender ? "file.transfer.sender_report" : "file.transfer",
      entity: "session_files",
      entityId: id,
      result: w.outcome,
      newValue: { ...w.value, reportedBy },
    });
  });
}

/**
 * P15 (AC-238, db-notlari P15): aynı aktarımın iki taraf raporunu eşleyen anahtar. `fid` yoksa (0.10.x) eşleşme
 * olmasın diye satıra özgü rastgele bileşen kullanılır — anahtar yeni satırlarda her zaman dolu (down.sql buna dayanır).
 */
export const fileMatchKey = (sessionId: string, m: FileMeta, fid: string): string =>
  sha256Hex(`${sessionId}\n${m.direction}\n${fid}\n${m.sha256}\n${m.sizeBytes}`);

/** S-P5-1: kota aşımı sessiz kalmaz — oda + taraf + sınıf başına dakikada en çok 1 audit satırı (S-P5-T2-2: bir tarafın
 * aşımı diğer tarafın aynı dakikadaki aşım kaydını bastıramaz). */
export async function auditRateLimited(
  rooms: Rooms,
  room: Room,
  ctx: AuditContext,
  actor: Actor,
  side: Reporter["side"],
  cls: FileMetaClass,
): Promise<void> {
  const now = rooms.clock.now();
  const key = `${side}:${cls}`;
  const last = room.fileMeta.auditAt.get(key);
  if (last !== undefined && now - last < FILE_META_RATE_AUDIT_MS) return;
  room.fileMeta.auditAt.set(key, now);
  try {
    await writeAudit(rooms.db, ctx, {
      tenantId: room.tenantId,
      ...actor,
      action: "file.meta.rate_limited",
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "fail",
      newValue: { sessionId: room.sessionId, side, class: cls },
    });
  } catch (err) {
    rooms.log.error(
      { err, ref: newId(), event: "file_meta_rate_audit_failed", sessionId: room.sessionId },
      "file.meta.rate_limited audit yazılamadı",
    );
  }
}
