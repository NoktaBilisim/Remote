// Firma silme hata sınıfları (jobs/tenant-purge.ts; ADR-0030 m.2): db_fk | db_signal | fs | other (+ invalid_job, yürütücü).
import { isP16Signal } from "../lib/db.ts";

type PurgeErrorClass = "db_fk" | "db_signal" | "fs" | "invalid_job" | "other";

/** Dosya adımı (uploads/{tenantId}) hatası → sınıf `fs`. */
export class FsStepError extends Error {}

/** MySQL FK ihlali (1451/1452) ya da Prisma P2003. */
function isFkError(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } } } } | null;
  if (!e || typeof e !== "object") return false;
  if (e.code === "P2003") return true;
  const c = e.meta?.driverAdapterError?.cause;
  const code = Number(c?.code ?? c?.originalCode);
  return code === 1451 || code === 1452;
}

export function classifyPurgeError(err: unknown): PurgeErrorClass {
  if (err instanceof FsStepError) return "fs";
  if (isP16Signal(err)) return "db_signal";
  if (isFkError(err)) return "db_fk";
  return "other";
}
