// P28e saklama adımları (mimari-p28e r2 §3.4, §5.5; AC-386, S-P28e-10). 03:30 turunda tenant başına `recExpire` (`STOPPED`,
// `expires_at <= now` → disk sil → aynı TX'te parça satırları DELETE + kayıt `DELETED{EXPIRED}`, sayaçlar 0; tenant başına tek
// `recording.expired{count, bytes}`). Global mutabakat (b) `recReconcileMissing`: dosyası olmayan parça satırı silinir, sayaçlar
// düşülür; parça kalmazsa `DELETED{MISSING}`; etkilenen kayıt başına `recording.delete{deleteReason:"missing"}` (aktör sistem).
// `ACTIVE` kayda dokunulmaz. Disk her zaman TX'ten ÖNCE silinir (güvenli yön: satır kalırsa (b) temizler). Kilit §5.5 tek yardımcı.
import { RECORDING_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { FsrvRuntime } from "../fsrv/wiring.ts";
import type { Db } from "../lib/db.ts";
import { TX_OPTIONS } from "../lib/db.ts";
import { lockTenantRecording } from "../rec/repo.ts";
import { SYSTEM } from "../requests/service.ts";

type Store = FsrvRuntime["store"];

/** Tenant başına TX'te işlenen kayıt sayısı (parça satırı ≤ 5760/kayıt). */
const REC_BATCH = 20;
const PART_BATCH = 2000;

/** Süresi dolan `STOPPED` kaydı olan firmalar (tur başına tek sorgu; IX(state, expires_at)). */
export async function tenantsWithExpiredRecordings(db: Db, now: Date): Promise<Set<string>> {
  const rows = await db.sessionRecording.findMany({
    where: { state: "STOPPED", expiresAt: { lte: now } },
    distinct: ["tenantId"],
    select: { tenantId: true },
  });
  return new Set(rows.map((r) => r.tenantId));
}

/** Kayıtların parça dosyalarını diskten siler (TX'ten önce). */
export async function removeRecordingFiles(db: Db, store: Store, tenantId: string, recordingIds: readonly string[]): Promise<void> {
  if (recordingIds.length === 0) return;
  let cursor: string | undefined;
  for (;;) {
    const parts = await db.sessionRecordingPart.findMany({
      where: { tenantId, recordingId: { in: [...recordingIds] }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PART_BATCH,
      select: { id: true, storageRel: true },
    });
    for (const p of parts) await store.remove(p.storageRel);
    if (parts.length < PART_BATCH) return;
    cursor = parts[parts.length - 1]?.id;
  }
}

/** Oturumların kayıt parça dosyaları (anonimleştirme / kalıcı silme partisinden ÖNCE; `removeSessionFiles` eki). */
export async function removeSessionRecordingFiles(db: Db, store: Store, tenantId: string, sessionIds: readonly string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  const recs = await db.sessionRecording.findMany({
    where: { tenantId, sessionId: { in: [...sessionIds] } },
    select: { id: true },
  });
  await removeRecordingFiles(
    db,
    store,
    tenantId,
    recs.map((r) => r.id),
  );
}

/** Tenant başına süresi dolan kayıtlar. Dönen: silinen kayıt sayısı. */
export async function recExpire(db: Db, store: Store, tenantId: string, now: Date, ctx: AuditContext): Promise<number> {
  let count = 0;
  let bytes = 0;
  for (;;) {
    const rows = await db.sessionRecording.findMany({
      where: { tenantId, state: "STOPPED", expiresAt: { lte: now } },
      orderBy: { id: "asc" },
      take: REC_BATCH,
      select: { id: true },
    });
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    await removeRecordingFiles(db, store, tenantId, ids);
    const r = await db.$transaction(async (tx) => {
      const locked = (await lockTenantRecording(tx, tenantId, ids)).filter((l) => l.state === "STOPPED");
      const due = locked.map((l) => l.id);
      if (due.length === 0) return { n: 0, b: 0 };
      const b = locked.reduce((s, l) => s + Number(l.sizeBytes), 0);
      await tx.sessionRecordingPart.deleteMany({ where: { tenantId, recordingId: { in: due } } });
      const u = await tx.sessionRecording.updateMany({
        where: { tenantId, id: { in: due }, state: "STOPPED" },
        data: { state: "DELETED", deleteReason: "EXPIRED", deletedAt: now, sizeBytes: 0n, partCount: 0 },
      });
      return { n: u.count, b };
    }, TX_OPTIONS);
    count += r.n;
    bytes += r.b;
    if (rows.length < REC_BATCH) break;
  }
  if (count > 0)
    await writeAudit(db, ctx, {
      tenantId,
      ...SYSTEM,
      action: RECORDING_AUDIT.EXPIRED,
      entity: "retention",
      result: "success",
      newValue: { count, bytes },
    });
  return count;
}

/**
 * Mutabakat (b) (§3.4, S-P28e-10): `STOPPED` kayıtların dosyası olmayan parça satırları. Kayıt başına tek TX (kilit §5.5);
 * parça kalmazsa `DELETED{MISSING}`. Dönen: etkilenen kayıt sayısı.
 */
export async function recReconcileMissing(db: Db, store: Store, now: Date, ctx: AuditContext): Promise<number> {
  let affected = 0;
  let cursor: string | undefined;
  for (;;) {
    const recs = await db.sessionRecording.findMany({
      where: { state: "STOPPED", ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: REC_BATCH,
      select: { id: true, tenantId: true },
    });
    for (const rec of recs) if (await reconcileOne(db, store, rec, now, ctx)) affected++;
    if (recs.length < REC_BATCH) return affected;
    cursor = recs[recs.length - 1]?.id;
  }
}

async function missingParts(db: Db, store: Store, rec: { id: string; tenantId: string }) {
  const out: { id: string; durationMs: number; sizeBytes: number }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const parts = await db.sessionRecordingPart.findMany({
      where: { tenantId: rec.tenantId, recordingId: rec.id, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PART_BATCH,
      select: { id: true, storageRel: true, durationMs: true, sizeBytes: true },
    });
    for (const p of parts) if (!(await store.exists(p.storageRel))) out.push(p);
    if (parts.length < PART_BATCH) return out;
    cursor = parts[parts.length - 1]?.id;
  }
}

async function reconcileOne(db: Db, store: Store, rec: { id: string; tenantId: string }, now: Date, ctx: AuditContext) {
  const gone = await missingParts(db, store, rec);
  if (gone.length === 0) return false;
  const res = await db.$transaction(async (tx) => {
    const [l] = await lockTenantRecording(tx, rec.tenantId, [rec.id]);
    if (!l || l.state !== "STOPPED") return null;
    const del = await tx.sessionRecordingPart.deleteMany({
      where: { tenantId: rec.tenantId, recordingId: rec.id, id: { in: gone.map((p) => p.id) } },
    });
    const remaining = await tx.sessionRecordingPart.count({ where: { tenantId: rec.tenantId, recordingId: rec.id } });
    const size = Math.max(0, Number(l.sizeBytes) - gone.reduce((s, p) => s + p.sizeBytes, 0));
    const dur = Math.max(0, l.durationMs - gone.reduce((s, p) => s + p.durationMs, 0));
    await tx.sessionRecording.update({
      where: { id: rec.id },
      data:
        remaining === 0
          ? { state: "DELETED", deleteReason: "MISSING", deletedAt: now, sizeBytes: 0n, partCount: 0, durationMs: dur }
          : { sizeBytes: BigInt(size), partCount: remaining, durationMs: dur },
    });
    await writeAudit(tx, ctx, {
      tenantId: rec.tenantId,
      ...SYSTEM,
      action: RECORDING_AUDIT.DELETE,
      entity: "support_sessions",
      entityId: l.sessionId,
      result: "success",
      newValue: {
        recordingId: rec.id,
        deleteReason: "missing",
        durationMs: dur,
        sizeBytes: remaining === 0 ? 0 : size,
        missingParts: del.count,
        remainingParts: remaining,
      },
    });
    return remaining;
  }, TX_OPTIONS);
  return res !== null;
}
