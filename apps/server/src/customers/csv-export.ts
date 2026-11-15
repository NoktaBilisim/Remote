// P19 müşteri CSV dışa aktarma (AC-263; mimari-e11 §8c.5). Sıra: hız sınırı (10/dk/kullanıcı) → sayım (> 50.000 → 400,
// yarım dosya yok) → audit `customer.exported {count, status}` → 500'lük `id` imleçli partilerle akış. Ref dışa aktarılmaz
// (K-P19-5); anonimleşmiş müşterinin kişisel hücreleri boş. Kaçış `csvRow` (`;`, BOM, CRLF, formül kaçışı).
import {
  CUSTOMER_CSV_COLUMNS,
  CUSTOMER_EXPORT_MAX_ROWS,
  CUSTOMER_IMPORT_MESSAGES,
  type CustomerStatus,
  type ExportCustomersQuery,
} from "@remote/contracts/api/customers";
import type { RequestPriority } from "@remote/contracts/api/requests";
import { CUSTOMER_AUDIT } from "@remote/contracts/audit";
import { CUSTOMER_STATUS_LABELS, PRIORITY_LABELS } from "@remote/contracts/labels";
import { Readable } from "node:stream";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { CSV_BOM, csvRow, istanbulDateTime } from "../lib/csv.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import * as repo from "./repo.ts";

const BATCH = 500;

/** Tek satır (sütun sırası `CUSTOMER_CSV_COLUMNS`). İçe aktarma aynı biçimi okur (gidiş-dönüş). */
function customerCsvCells(c: repo.CustomerExportRow): string[] {
  const pii = (v: string | null): string => (c.anonymizedAt ? "" : (v ?? ""));
  return [
    c.name,
    pii(c.contactName),
    pii(c.phone),
    pii(c.email),
    pii(c.note),
    c.fileLabel,
    c.defaultPriority ? (PRIORITY_LABELS[c.defaultPriority as RequestPriority] ?? "") : "",
    c.slaMinutes === null ? "" : String(c.slaMinutes),
    CUSTOMER_STATUS_LABELS[c.status as CustomerStatus] ?? c.status,
  ];
}

interface CustomerCsvExport {
  filename: string;
  body: Readable;
}

/** Başlık + 500'lük `id` imleçli partiler (en çok `CUSTOMER_EXPORT_MAX_ROWS`); akış hatası loglanıp yeniden fırlatılır. */
async function* exportStream(
  db: Db,
  log: { error(o: object, m: string): void },
  tenantId: string,
  status: ExportCustomersQuery["status"],
): AsyncGenerator<string> {
  yield CSV_BOM + csvRow(CUSTOMER_CSV_COLUMNS);
  let after: string | null = null;
  let written = 0;
  try {
    while (written < CUSTOMER_EXPORT_MAX_ROWS) {
      const batch = await repo.exportPage(db, tenantId, status, after, Math.min(BATCH, CUSTOMER_EXPORT_MAX_ROWS - written));
      if (batch.length === 0) return;
      yield batch.map((c) => csvRow(customerCsvCells(c))).join("");
      written += batch.length;
      const last = batch[batch.length - 1];
      if (!last || batch.length < BATCH) return;
      after = last.id;
    }
  } catch (err) {
    log.error({ err, ref: newId(), event: "customer_export_stream_failed" }, "müşteri CSV akışı kesildi");
    throw err;
  }
}

export async function exportCustomersCsv(
  db: Db,
  log: { error(o: object, m: string): void },
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  q: ExportCustomersQuery,
  limiter: FixedWindowCounter,
  now = new Date(),
): Promise<CustomerCsvExport> {
  const wait = limiter.blockedFor(auth.user.id);
  if (wait > 0 || limiter.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  const count = await repo.countForExport(db, tenantId, q.status);
  if (count > CUSTOMER_EXPORT_MAX_ROWS)
    throw new AppError("VALIDATION", {
      message: CUSTOMER_IMPORT_MESSAGES.exportTooMany,
      fields: { status: CUSTOMER_IMPORT_MESSAGES.exportTooMany },
    });
  await writeAudit(db, ctx, {
    tenantId,
    userId: auth.user.id,
    username: auth.user.email,
    action: CUSTOMER_AUDIT.EXPORTED,
    entity: "customer",
    result: "success",
    newValue: { count, status: q.status },
  });
  const day = istanbulDateTime(now).slice(0, 10).replaceAll("-", "");
  return { filename: `musteriler-${day}.csv`, body: Readable.from(exportStream(db, log, tenantId, q.status), { objectMode: false }) };
}
