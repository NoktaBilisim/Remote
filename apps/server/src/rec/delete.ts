// P28e elle silme (mimari-p28e r2 §3.4 "Elle silme", §5 DELETE; AC-386, K-P28e-15, S-P28e-9). Kilit `lockTenantRecording`;
// sıra disk → parça satırları → `DELETED{MANUAL}` (sayaçlar sıfır). Audit satırı silinmez. Diskte silinip TX'i düşen satır
// mutabakatta `MISSING` olur (güvenli yön).
import { RECORDING_AUDIT } from "@remote/contracts/audit";
import { REC_DELETE_ACTIVE_MESSAGE } from "@remote/contracts/api/recording";
import { AppError } from "../lib/errors.ts";
import * as repo from "./repo.ts";
import type { RecServiceImpl } from "./service.ts";
import type { RecActor } from "./types.ts";

/** Dönen: true → silindi; false → zaten DELETED (idempotent 204). ACTIVE → 409 CONFLICT. */
export async function deleteRecording(svc: RecServiceImpl, tenantId: string, rid: string, actor: RecActor): Promise<boolean> {
  const now = new Date(svc.d.clock.now());
  const done = await svc.d.db.$transaction(async (tx) => {
    const [rec] = await repo.lockTenantRecording(tx, tenantId, [rid]);
    if (!rec || rec.state === "DELETED") return false;
    if (rec.state === "ACTIVE") throw new AppError("CONFLICT", { message: REC_DELETE_ACTIVE_MESSAGE });
    const parts = await repo.listParts(tx, rid, tenantId);
    for (const p of parts) await svc.d.store.remove(p.storageRel);
    await repo.markDeleted(tx, rid, tenantId, "MANUAL", now);
    await svc.audit(tx, rec, actor, RECORDING_AUDIT.DELETE, true, {
      recordingId: rid,
      deleteReason: "manual",
      durationMs: rec.durationMs,
      sizeBytes: Number(rec.sizeBytes),
    });
    return true;
  });
  if (done) svc.dropUploadTokens({ by: "rid", rid });
  return done;
}
