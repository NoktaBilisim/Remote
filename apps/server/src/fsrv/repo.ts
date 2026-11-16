// P28b `session_stored_files` veri erişimi (mimari-p28b §3, db-notlari "P28b"). Her durum geçişi KOŞULLU `updateMany`
// (`WHERE state IN …`): count 0 → geçiş yok (CANCELLED satıra geç gelen sonuç, çift gönderim, yarış tek kuralla kapanır).
// K1 CHECK'leri: son durumlarda `storage_rel = NULL` + `deleted_at` aynı UPDATE'te; CLEAN'e geçişte `scanned_at`;
// SCAN_FAILED'de `scan_reason`; teslimde `delivered_at` + `expires_at` birlikte. Oturum tavanı / geçmiş sorgusu tenant_id ile.
import { FSRV_SESSION_MAX_BYTES, type AvScanReason, type StoredFileState } from "@remote/contracts/ws-fsrv";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { sha256Hex } from "../lib/ids.ts";
import { storageUsage } from "./usage.ts";

type DbOrTx = Db | Prisma.TransactionClient;
const GB = 1024 ** 3;

export interface NewStoredFile {
  id: string;
  tenantId: string;
  sessionId: string;
  direction: "TO_CUSTOMER" | "TO_TECH";
  purpose: "FILE" | "PRINT";
  uploadedByUserId: string | null;
  fileName: string;
  ext: string;
  sizeBytes: number;
  sha256: string;
  storageRel: string;
  keyVer: number;
  createdAt: Date;
}

/**
 * Kapı 7–8 (§5.2) + INSERT tek TX: `tenants … FOR UPDATE` eşzamanlı rezervasyonu serileştirir. Oturum toplamı TÜM durumlar
 * (O-P28b-2). Dönen: null (eklendi) ya da ret nedeni.
 */
export async function reserveAndInsert(db: Db, f: NewStoredFile): Promise<"SESSION_LIMIT" | "QUOTA" | null> {
  return db.$transaction(async (tx) => {
    const t = await tx.$queryRaw<{ q: number }[]>`SELECT storage_quota_gb AS q FROM tenants WHERE id = ${f.tenantId} FOR UPDATE`;
    const quotaGb = Number(t[0]?.q ?? 0);
    const s = await tx.$queryRaw<{ n: bigint | null }[]>`SELECT SUM(size_bytes) AS n FROM session_stored_files
      WHERE session_id = ${f.sessionId} AND tenant_id = ${f.tenantId}`;
    if (Number(s[0]?.n ?? 0) + f.sizeBytes > FSRV_SESSION_MAX_BYTES) return "SESSION_LIMIT";
    if ((await storageUsage(tx, f.tenantId)) + f.sizeBytes > quotaGb * GB) return "QUOTA";
    await tx.sessionStoredFile.create({
      data: { ...f, sizeBytes: BigInt(f.sizeBytes), state: "UPLOADING" },
      select: { id: true },
    });
    return null;
  });
}

const DISK_STATES = ["UPLOADING", "SCANNING", "CLEAN"] as const;

/** Disk dosyası silinen son duruma geçiş (CANCELLED / REJECTED / INFECTED / SCAN_FAILED / CORRUPT / EXPIRED). */
export async function toFinal(
  db: DbOrTx,
  fid: string,
  from: readonly StoredFileState[],
  to: "CANCELLED" | "REJECTED" | "INFECTED" | "SCAN_FAILED" | "CORRUPT" | "EXPIRED",
  now: Date,
  extra: { scanReason?: AvScanReason; signature?: string | null; scanned?: boolean; delivered?: boolean } = {},
): Promise<number> {
  const r = await db.sessionStoredFile.updateMany({
    where: cleanAware(fid, from, extra.delivered === true),
    data: {
      state: to,
      storageRel: null,
      deletedAt: now,
      ...(to === "SCAN_FAILED" ? { scanReason: extra.scanReason ?? "ERROR" } : {}),
      ...(to === "INFECTED" ? { signature: extra.signature ?? null } : {}),
      ...(extra.scanned ? { scannedAt: now } : {}),
    },
  });
  return r.count;
}

/** `CLEAN` kaynağı yalnız teslim EDİLMEMİŞ satırı eşler (teklif açık); `delivered` → yalnız teslim edilmiş (saklama süresi). */
function cleanAware(fid: string, from: readonly StoredFileState[], delivered: boolean): Prisma.SessionStoredFileWhereInput {
  const others = from.filter((s) => s !== "CLEAN");
  if (others.length === from.length) return { id: fid, state: { in: [...from] } };
  const clean = { state: "CLEAN" as const, deliveredAt: delivered ? { not: null } : null };
  return { id: fid, OR: others.length > 0 ? [{ state: { in: others } }, clean] : [clean] };
}

export async function toScanning(db: DbOrTx, fid: string): Promise<number> {
  return (await db.sessionStoredFile.updateMany({ where: { id: fid, state: "UPLOADING" }, data: { state: "SCANNING" } })).count;
}

export async function toClean(db: DbOrTx, fid: string, now: Date): Promise<number> {
  return (await db.sessionStoredFile.updateMany({ where: { id: fid, state: "SCANNING" }, data: { state: "CLEAN", scannedAt: now } })).count;
}

/**
 * Teslim (`fsrv.result{ok:true}`): `delivered_at` + (FILE) `expires_at`; sunucu `session_files` satırını kendisi yazar (OK) —
 * aynı TX. PRINT diski silinir → EXPIRED (§3.2). count 0 → teslim edilmemiş CLEAN değil (yok sayılır).
 */
export async function deliver(
  db: Db,
  f: {
    fid: string;
    tenantId: string;
    sessionId: string;
    direction: string;
    purpose: "FILE" | "PRINT";
    name: string;
    size: number;
    sha256: string;
  },
  now: Date,
  retentionDays: number,
  reportedBy: "TECH" | "CUSTOMER",
): Promise<number> {
  return db.$transaction(async (tx) => {
    const data =
      f.purpose === "FILE"
        ? { deliveredAt: now, expiresAt: new Date(now.getTime() + retentionDays * 86_400_000) }
        : { deliveredAt: now, state: "EXPIRED", storageRel: null, deletedAt: now };
    const r = await tx.sessionStoredFile.updateMany({ where: { id: f.fid, state: "CLEAN", deliveredAt: null }, data });
    if (r.count !== 1) return 0;
    if (f.purpose === "FILE") await insertSessionFile(tx, f, "OK", reportedBy);
    return 1;
  });
}

/** `session_files` satırı (P5 kalıbı; `match_key` fid ile — iki raporlu eşleşme yolu yok, tek satır sunucunun). */
export async function insertSessionFile(
  tx: DbOrTx,
  f: { fid: string; tenantId: string; sessionId: string; direction: string; name: string; size: number; sha256: string },
  result: "OK" | "CORRUPT",
  reportedBy: "TECH" | "CUSTOMER",
): Promise<void> {
  await tx.sessionFile.create({
    data: {
      id: f.fid,
      sessionId: f.sessionId,
      tenantId: f.tenantId,
      direction: f.direction,
      fileName: f.name,
      sizeBytes: BigInt(f.size),
      sha256: f.sha256,
      result,
      reportedBy,
      matchKey: sha256Hex(`${f.sessionId}\n${f.direction}\n${f.fid}\n${f.sha256}\n${f.size}`),
    },
    select: { id: true },
  });
}

const rowSelect = {
  id: true,
  tenantId: true,
  sessionId: true,
  direction: true,
  purpose: true,
  fileName: true,
  ext: true,
  sizeBytes: true,
  sha256: true,
  storageRel: true,
  keyVer: true,
  state: true,
  scanReason: true,
  signature: true,
  deliveredAt: true,
  expiresAt: true,
  createdAt: true,
} as const;
export type StoredRow = Prisma.SessionStoredFileGetPayload<{ select: typeof rowSelect }>;

export function findRow(db: DbOrTx, fid: string): Promise<StoredRow | null> {
  return db.sessionStoredFile.findUnique({ where: { id: fid }, select: rowSelect });
}

/** Geçmiş detayı (§4): oturumun satırları yükleme sırasıyla (tenant_id yazılır — IX öneki). */
export function listForSession(db: DbOrTx, tenantId: string, sessionId: string, take: number): Promise<StoredRow[]> {
  return db.sessionStoredFile.findMany({
    where: { tenantId, sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
    select: rowSelect,
  });
}

/**
 * Açılış süpürmesi / mutabakat (c) adayları: disk taşıyan durumlar ve teslim edilmemiş CLEAN. `id` imleciyle sayfalı
 * (D-P28b-K1-4: bellekte etkin satırlarla dolu bir sayfa sonraki yetimleri gizlemesin).
 */
export function liveRows(db: DbOrTx, take: number, after?: string): Promise<StoredRow[]> {
  return db.sessionStoredFile.findMany({
    where: {
      OR: [{ state: { in: ["UPLOADING", "SCANNING"] } }, { state: "CLEAN", deliveredAt: null }],
      ...(after ? { id: { gt: after } } : {}),
    },
    orderBy: { id: "asc" },
    take,
    select: rowSelect,
  });
}

export { DISK_STATES };
