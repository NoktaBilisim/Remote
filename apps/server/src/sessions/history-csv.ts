// Oturum geçmişi CSV'si (history.ts `exportHistoryCsv`'den taşındı ve bölündü, PT-K12; AC-63, 124, §5).
import {
  SESSION_CSV_ANONYMIZED,
  SESSION_CSV_COLUMNS,
  SESSION_CSV_TENANT_COLUMN,
  SESSION_EXPORT_MAX_ROWS,
  type ListSessionsQuery,
} from "@remote/contracts/api/sessions";
import {
  END_REASON_LABELS,
  SESSION_ENDED_BY_LABELS,
  SESSION_MODE_LABELS,
  SESSION_SOURCE_LABELS,
  SESSION_STATUS_LABELS,
  labelOf,
} from "@remote/contracts/labels";
import { slaBreachedAt } from "@remote/contracts/api/requests";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { CSV_BOM, csvRow, hms, istanbulDateTime } from "../lib/csv.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import type { HistoryLog } from "./history.ts";
import * as hrepo from "./history-repo.ts";
import { durationSec, fileSummaryCell, waitSecOf, type FileReportRow } from "./history-view.ts";

const EXPORT_BATCH = 1000;

type SlaRow = Awaited<ReturnType<typeof hrepo.requestSlaOf>>[number];

/** "SLA aşıldı" hücresi: talepsiz oturum ya da SLA'sız talep boş; aksi `slaBreachedAt` (web/sunucu ortak). */
function slaCell(sla: SlaRow | undefined, now: number): string {
  if (!sla || sla.slaDueAt === null) return "";
  return slaBreachedAt(sla, now) ? "Evet" : "Hayır";
}

function csvCells(r: hrepo.HistoryExportRow, withTenant: boolean, files: readonly FileReportRow[], sla: string): string[] {
  return [
    r.id,
    ...(withTenant ? [r.tenant.name] : []),
    istanbulDateTime(r.createdAt),
    istanbulDateTime(r.consumedAt),
    istanbulDateTime(r.endedAt),
    hms(durationSec(r)),
    labelOf(SESSION_STATUS_LABELS, r.status),
    labelOf(SESSION_MODE_LABELS, r.mode),
    labelOf(SESSION_SOURCE_LABELS, r.requestId ? "REQUEST" : "TECH"),
    r.customer?.name ?? "", // P8c AC-179: müşterisizde boş ("Genel" değil)
    hms(waitSecOf(r)),
    r.technician.fullName,
    r.anonymizedAt !== null ? SESSION_CSV_ANONYMIZED : (r.customerName ?? ""),
    r.ticketNo ?? "",
    labelOf(SESSION_ENDED_BY_LABELS, r.endedBy),
    labelOf(END_REASON_LABELS, r.endReason),
    r.anonymizedAt !== null ? "" : (r.note ?? ""),
    r.anonymizedAt !== null ? "" : fileSummaryCell(files),
    sla,
  ];
}

export const exportFilename = (now: Date): string => {
  const t = istanbulDateTime(now); // YYYY-MM-DD HH:mm:ss
  return `oturumlar-${t.slice(0, 10).replaceAll("-", "")}-${t.slice(11, 13)}${t.slice(14, 16)}.csv`;
};

/** Audit `session.exported` (müşteri arama metni yazılmaz). */
export async function auditExport(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  scope: hrepo.HistoryScope,
  filter: hrepo.HistoryFilter,
  q: ListSessionsQuery,
  rows: number,
): Promise<void> {
  await writeAudit(db, ctx, {
    tenantId: scope.kind === "tenant" ? scope.tenantId : null,
    userId: auth.user.id,
    username: auth.user.email,
    action: "session.exported",
    entity: "support_sessions",
    result: "success",
    newValue: {
      status: q.status ?? null,
      mode: q.mode ?? null,
      from: q.from ?? null,
      to: q.to ?? null,
      technicianId: filter.technicianId ?? null,
      tenantId: filter.tenantId ?? null,
      customerFilter: filter.customer !== undefined,
      customerFirm: filter.customerFirm ?? null,
      rows,
    },
  });
}

/** Bir keyset partisinin CSV satırları (dosya raporları + SLA tek sorguda). */
async function batchCsv(db: Db, batch: hrepo.HistoryExportRow[], withTenant: boolean, now: Date): Promise<string> {
  const reports = await hrepo.fileReportsOf(
    db,
    [...new Set(batch.map((r) => r.tenantId))],
    batch.map((r) => r.id),
  );
  const bySession = new Map<string, FileReportRow[]>();
  for (const f of reports) bySession.set(f.sessionId, [...(bySession.get(f.sessionId) ?? []), f]);
  const slaRows = await hrepo.requestSlaOf(
    db,
    [...new Set(batch.map((r) => r.tenantId))],
    batch.flatMap((r) => (r.requestId ? [r.requestId] : [])),
  );
  const slaById = new Map(slaRows.map((x) => [x.id, x]));
  const at = now.getTime();
  return batch
    .map((r) => csvRow(csvCells(r, withTenant, bySession.get(r.id) ?? [], slaCell(r.requestId ? slaById.get(r.requestId) : undefined, at))))
    .join("");
}

/** Başlık + keyset partileriyle akış. Akış sırasında hata: log + ref, bağlantı kesilir (dosya yarım kalır). */
export async function* csvStream(
  db: Db,
  log: HistoryLog,
  scope: hrepo.HistoryScope,
  filter: hrepo.HistoryFilter,
  q: ListSessionsQuery,
  now: Date,
): AsyncGenerator<string> {
  const withTenant = scope.kind === "all";
  const header = withTenant
    ? [SESSION_CSV_COLUMNS[0], SESSION_CSV_TENANT_COLUMN, ...SESSION_CSV_COLUMNS.slice(1)]
    : [...SESSION_CSV_COLUMNS];
  yield CSV_BOM + csvRow(header);
  let after: { createdAt: Date; id: string } | null = null;
  let written = 0;
  try {
    while (written < SESSION_EXPORT_MAX_ROWS) {
      const batch = await hrepo.exportBatch(db, scope, filter, q.sort, after, Math.min(EXPORT_BATCH, SESSION_EXPORT_MAX_ROWS - written));
      if (batch.length === 0) return;
      yield await batchCsv(db, batch, withTenant, now);
      written += batch.length;
      const last = batch[batch.length - 1];
      if (!last || batch.length < EXPORT_BATCH) return;
      after = { createdAt: last.createdAt, id: last.id };
    }
  } catch (err) {
    log.error({ err, ref: newId(), event: "session_export_stream_failed" }, "CSV akışı kesildi");
    throw err;
  }
}
