// P28e kayıt veri erişimi (mimari-p28e r2 §3, §5.1, §5.5; db-notlari "P28e"). Kilit sırası TEK yardımcıdan (S-P28e-9):
// `tenant_settings` (gerekiyorsa, çağıran) → `tenants FOR UPDATE` → `session_recordings` artan `id` FOR UPDATE. Parçalar
// append-only (UPDATE grant'ı yok); DELETED geçişinde `size_bytes = part_count = 0` aynı UPDATE'te (CHECK).
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import type { Tx } from "./types.ts";

type DbOrTx = Db | Tx;

export const recSelect = {
  id: true,
  tenantId: true,
  sessionId: true,
  basis: true,
  state: true,
  stopReason: true,
  deleteReason: true,
  recorderUserId: true,
  startedAt: true,
  stoppedAt: true,
  expiresAt: true,
  durationMs: true,
  sizeBytes: true,
  partCount: true,
} as const;
export type RecRow = Prisma.SessionRecordingGetPayload<{ select: typeof recSelect }>;

/** §5.5: `tenants` → kayıtlar (artan id). Dönen: kilitlenen kayıt satırları (tenant'a ait olanlar). */
export async function lockTenantRecording(tx: Tx, tenantId: string, rids: readonly string[] = []): Promise<RecRow[]> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
  const ids = [...new Set(rids)].sort();
  if (ids.length === 0) return [];
  await tx.$queryRaw`SELECT id FROM session_recordings WHERE id IN (${Prisma.join(ids)}) AND tenant_id = ${tenantId}
    ORDER BY id FOR UPDATE`;
  return tx.sessionRecording.findMany({ where: { id: { in: ids }, tenantId }, select: recSelect, orderBy: { id: "asc" } });
}

export const findById = (db: DbOrTx, rid: string): Promise<RecRow | null> =>
  db.sessionRecording.findUnique({ where: { id: rid }, select: recSelect });

export const findBySession = (db: DbOrTx, tenantId: string, sessionId: string): Promise<RecRow | null> =>
  db.sessionRecording.findUnique({ where: { sessionId_tenantId: { sessionId, tenantId } }, select: recSelect });

export interface RecSettings {
  enabled: boolean;
  retentionDays: number;
  unattendedEnabled: boolean;
  unattendedAckAt: Date | null;
  sessionRetentionDays: number;
}

/** Ayar satırı (kilitsiz). Yoksa kapalı + varsayılanlar. */
export async function settingsOf(db: DbOrTx, tenantId: string): Promise<RecSettings> {
  const s = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      recordingEnabled: true,
      recordingRetentionDays: true,
      unattendedRecordingEnabled: true,
      unattendedRecordingAckAt: true,
      retentionDays: true,
    },
  });
  return {
    enabled: s?.recordingEnabled === true,
    retentionDays: s?.recordingRetentionDays ?? 30,
    unattendedEnabled: s?.unattendedRecordingEnabled === true,
    unattendedAckAt: s?.unattendedRecordingAckAt ?? null,
    sessionRetentionDays: s?.retentionDays ?? 365,
  };
}

/** TX içi kilitli okuma (`FOR SHARE` başlatma; `FOR UPDATE` ayar PUT'u). Satır yoksa null. */
export async function lockSettings(tx: Tx, tenantId: string, mode: "share" | "update"): Promise<RecSettings | null> {
  const lock = mode === "update" ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
  const r = await tx.$queryRaw<{ e: unknown; d: number; u: unknown; a: Date | null; r: number }[]>`SELECT recording_enabled AS e,
    recording_retention_days AS d, unattended_recording_enabled AS u, unattended_recording_ack_at AS a, retention_days AS r
    FROM tenant_settings WHERE tenant_id = ${tenantId} ${lock}`;
  const row = r[0];
  if (!row) return null;
  const bool = (v: unknown): boolean => v === true || Number(v) === 1;
  return {
    enabled: bool(row.e),
    retentionDays: Number(row.d),
    unattendedEnabled: bool(row.u),
    unattendedAckAt: row.a,
    sessionRetentionDays: Number(row.r),
  };
}

/** Bölüm durumu: son bölüm (yoksa null), bölüm 0. parçasının ofseti, parça sayısı, süre toplamı. */
export interface SeriesState {
  series: number;
  count: number;
  offsetMs: number;
  durationMs: number;
}

export async function lastSeries(db: DbOrTx, rid: string, tenantId: string): Promise<SeriesState | null> {
  const r = await db.$queryRaw<{ s: number | null; n: bigint; o: number | null; d: number | null }[]>`SELECT p.series_no AS s,
    COUNT(*) AS n, MIN(p.offset_ms) AS o, SUM(p.duration_ms) AS d FROM session_recording_parts p
    WHERE p.recording_id = ${rid} AND p.tenant_id = ${tenantId}
      AND p.series_no = (SELECT MAX(series_no) FROM session_recording_parts WHERE recording_id = ${rid} AND tenant_id = ${tenantId})
    GROUP BY p.series_no`;
  const row = r[0];
  if (!row || row.s === null) return null;
  return { series: Number(row.s), count: Number(row.n), offsetMs: Number(row.o ?? 0), durationMs: Number(row.d ?? 0) };
}

export async function partExists(db: DbOrTx, rid: string, tenantId: string, s: number, p: number): Promise<boolean> {
  const row = await db.sessionRecordingPart.findUnique({
    where: { recordingId_tenantId_seriesNo_partNo: { recordingId: rid, tenantId, seriesNo: s, partNo: p } },
    select: { id: true },
  });
  return row !== null;
}

export const findPart = (db: DbOrTx, rid: string, tenantId: string, s: number, p: number) =>
  db.sessionRecordingPart.findUnique({
    where: { recordingId_tenantId_seriesNo_partNo: { recordingId: rid, tenantId, seriesNo: s, partNo: p } },
    select: { id: true, storageRel: true, keyVer: true, sizeBytes: true },
  });

export const listParts = (db: DbOrTx, rid: string, tenantId: string) =>
  db.sessionRecordingPart.findMany({
    where: { recordingId: rid, tenantId },
    select: { seriesNo: true, partNo: true, offsetMs: true, durationMs: true, storageRel: true },
    orderBy: [{ seriesNo: "asc" }, { partNo: "asc" }],
  });

export interface NewPart {
  id: string;
  recordingId: string;
  tenantId: string;
  seriesNo: number;
  partNo: number;
  offsetMs: number;
  durationMs: number;
  sizeBytes: number;
  storageRel: string;
  keyVer: number;
}

/** Parça INSERT + kayıt sayaçları (aynı TX). */
export async function insertPart(tx: Tx, p: NewPart, recorderUserId: string): Promise<void> {
  await tx.sessionRecordingPart.create({ data: p, select: { id: true } });
  await tx.sessionRecording.update({
    where: { id: p.recordingId },
    data: {
      sizeBytes: { increment: BigInt(p.sizeBytes) },
      durationMs: { increment: p.durationMs },
      partCount: { increment: 1 },
      recorderUserId,
    },
    select: { id: true },
  });
}

/** ACTIVE → STOPPED (koşullu; 0 → zaten durmuş). */
export async function markStopped(tx: Tx, rid: string, reason: string, now: Date): Promise<number> {
  const r = await tx.sessionRecording.updateMany({
    where: { id: rid, state: "ACTIVE" },
    data: { state: "STOPPED", stopReason: reason, stoppedAt: now },
  });
  return r.count;
}

/** Parçalar → DELETED (sayaçlar sıfır, CHECK). */
export async function markDeleted(tx: Tx, rid: string, tenantId: string, reason: "MANUAL", now: Date): Promise<void> {
  await tx.sessionRecordingPart.deleteMany({ where: { recordingId: rid, tenantId } });
  await tx.sessionRecording.update({
    where: { id: rid },
    data: { state: "DELETED", deleteReason: reason, deletedAt: now, sizeBytes: 0n, partCount: 0 },
    select: { id: true },
  });
}

/** `RECORDING` rıza satırının bağlanacağı aydınlatma metni: oturumun son VIEW GRANTED satırı (yoksa null alanlar). */
export async function viewConsentText(db: DbOrTx, tenantId: string, sessionId: string) {
  return db.sessionConsent.findFirst({
    where: { sessionId, tenantId, level: "VIEW", decision: "GRANTED" },
    select: { consentTextId: true, consentSha256: true },
    orderBy: { createdAt: "desc" },
  });
}
