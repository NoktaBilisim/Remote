// P28b saklama adımları (mimari-p28b §3.3; AC-360). 03:30 turunda tenant başına `fsrvExpire` (teslim edilmiş FILE+CLEAN,
// `expires_at <= now` → disk sil → EXPIRED; tenant başına tek `file.expired{count, bytes}` audit), global mutabakat:
// (a) satırı UPLOADING|SCANNING|CLEAN olmayan ve 24 sa'ten eski `.part`/`.rsf` dosyaları (yetim) silinir; (b) dosyası olmayan
// teslim edilmiş CLEAN → EXPIRED; (c) bellekte aktarımı (açık odası) olmayan UPLOADING/SCANNING/teslim edilmemiş CLEAN → disk
// sil → CANCELLED. (c) açılış süpürmesiyle aynı fonksiyondur. Disk her zaman satır geçişinden ÖNCE silinir (güvenli yön).
import { FSRV_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import * as frepo from "../fsrv/repo.ts";
import type { FsrvRuntime } from "../fsrv/wiring.ts";
import type { Db } from "../lib/db.ts";
import { SYSTEM } from "../requests/service.ts";
import { removeSessionRecordingFiles } from "./retention-rec.ts";

const BATCH = 500;
const ORPHAN_AGE_MS = 24 * 3_600_000;

/** Süresi dolan teslim edilmiş dosyası olan firmalar (tur başına tek sorgu). */
export async function tenantsWithExpired(db: Db, now: Date): Promise<Set<string>> {
  const rows = await db.sessionStoredFile.findMany({
    where: { state: "CLEAN", deliveredAt: { not: null }, expiresAt: { lte: now } },
    distinct: ["tenantId"],
    select: { tenantId: true },
  });
  return new Set(rows.map((r) => r.tenantId));
}

/** Tenant başına süresi dolan saklanan dosyalar. Dönen: silinen dosya sayısı. */
export async function fsrvExpire(db: Db, rt: FsrvRuntime, tenantId: string, now: Date, ctx: AuditContext): Promise<number> {
  let count = 0;
  let bytes = 0;
  for (;;) {
    const rows = await db.sessionStoredFile.findMany({
      where: { tenantId, state: "CLEAN", deliveredAt: { not: null }, expiresAt: { lte: now } },
      take: BATCH,
      select: { id: true, storageRel: true, sizeBytes: true },
    });
    for (const r of rows) {
      if (r.storageRel) await rt.store.remove(r.storageRel);
      if ((await frepo.toFinal(db, r.id, ["CLEAN"], "EXPIRED", now, { delivered: true })) === 1) {
        count++;
        bytes += Number(r.sizeBytes);
      }
    }
    if (rows.length < BATCH) break;
  }
  if (count > 0)
    await writeAudit(db, ctx, {
      tenantId,
      ...SYSTEM,
      action: FSRV_AUDIT.EXPIRED,
      entity: "retention",
      result: "success",
      newValue: { count, bytes },
    });
  return count;
}

/**
 * (c) + açılış süpürmesi: bellekte aktarımı olmayan canlı satırlar → disk sil → CANCELLED. `id` imleciyle tüm canlı satırlar
 * gezilir (D-P28b-K1-4); `batch` yalnız testte küçültülür.
 */
export async function sweepOrphanRows(db: Db, rt: FsrvRuntime, now: Date, batch = BATCH): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await frepo.liveRows(db, batch, cursor);
    for (const r of rows) {
      if (rt.service.transfers.has(r.id)) continue;
      if (r.storageRel) await rt.store.remove(r.storageRel);
      n += await frepo.toFinal(db, r.id, ["UPLOADING", "SCANNING", "CLEAN"], "CANCELLED", now);
    }
    if (rows.length < batch) return n;
    cursor = rows[rows.length - 1]?.id;
  }
}

export interface ReconcileCounts {
  orphanFiles: number;
  missing: number;
  stale: number;
}

/** Global mutabakat (a)(b)(c). */
export async function reconcile(db: Db, rt: FsrvRuntime, now: Date): Promise<ReconcileCounts> {
  const stale = await sweepOrphanRows(db, rt, now);
  // (a) yetim dosyalar
  let orphanFiles = 0;
  const files = await rt.store.list();
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    const live = await db.sessionStoredFile.findMany({
      where: { storageRel: { in: chunk.map((f) => f.rel) }, state: { in: ["UPLOADING", "SCANNING", "CLEAN"] } },
      select: { storageRel: true },
    });
    // P28e (§3.4, kritik ek): kayıt parçaları da canlıdır — yoksa 24 sa'ten eski kayıt dosyaları silinirdi.
    const recParts = await db.sessionRecordingPart.findMany({
      where: { storageRel: { in: chunk.map((f) => f.rel) } },
      select: { storageRel: true },
    });
    const keep = new Set<string | null>([...live.map((r) => r.storageRel), ...recParts.map((r) => r.storageRel)]);
    for (const f of chunk) {
      if (keep.has(f.rel) || now.getTime() - f.mtimeMs < ORPHAN_AGE_MS) continue;
      await rt.store.remove(f.rel);
      orphanFiles++;
    }
  }
  // (b) dosyası olmayan teslim edilmiş CLEAN
  let missing = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.sessionStoredFile.findMany({
      where: { state: "CLEAN", deliveredAt: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, storageRel: true },
    });
    for (const r of rows) {
      if (r.storageRel && (await rt.store.exists(r.storageRel))) continue;
      missing += await frepo.toFinal(db, r.id, ["CLEAN"], "EXPIRED", now, { delivered: true });
    }
    if (rows.length < BATCH) break;
    cursor = rows[rows.length - 1]?.id;
  }
  return { orphanFiles, missing, stale };
}

/**
 * Anonimleştirme / kalıcı silme partisinden ÖNCE: adayların disk dosyaları (TX geri alınırsa satır CLEAN kalır → (b) EXPIRED yapar).
 * P28e (§3.4): kayıt parçalarının dosyaları da (satır kalırsa kayıt mutabakatı (b) parçayı siler).
 */
export async function removeSessionFiles(db: Db, store: FsrvRuntime["store"], tenantId: string, sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  const rows = await db.sessionStoredFile.findMany({
    where: { tenantId, sessionId: { in: sessionIds }, storageRel: { not: null } },
    select: { storageRel: true },
  });
  for (const r of rows) if (r.storageRel) await store.remove(r.storageRel);
  await removeSessionRecordingFiles(db, store, tenantId, sessionIds);
}
