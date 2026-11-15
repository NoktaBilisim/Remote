// Oturum geçmişi servisi (P8; AC-60..63, 124; mimari-api "Oturum geçmişi (P8)"). Kapsam her uçta `historyScope`.
// Liste (filtreli, sayfalı), detay (onaylar, kontrol dönemleri, zaman çizelgesi izdüşümü, kalite, dosyalar),
// not/ticket PATCH (audit'te not metni yok), CSV (formül kaçışı → RFC 4180; BOM, `;`, Europe/Istanbul).
// PT-K12: saf izdüşümler history-view.ts, detay history-detail.ts, CSV akışı history-csv.ts (adlar burada yeniden dışa verilir).
import { Readable } from "node:stream";
import {
  SESSION_EXPORT_MAX_ROWS,
  SESSION_EXPORT_TOO_MANY,
  type ListSessionsQuery,
  type SessionHistoryDetail,
  type SessionListItem,
  type SessionListResponse,
  type UpdateSessionData,
} from "@remote/contracts/api/sessions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { auditExport, csvStream, exportFilename } from "./history-csv.ts";
import { buildDetail } from "./history-detail.ts";
import * as hrepo from "./history-repo.ts";
import { toListItem } from "./history-view.ts";
import { historyScope } from "./service.ts";

export { deriveControlPeriods, groupFileReports, projectDetails, toListItem } from "./history-view.ts";

/** Uyarı/hata logu için dar arayüz (Fastify/pino logger uyar). */
export interface HistoryLog {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const DAY_MS = 86_400_000;
/** Europe/Istanbul UTC+3 (DST yok, §1): gün başı = `YYYY-MM-DDT00:00:00+03:00`. */
const istanbulDayStart = (day: string): Date => new Date(`${day}T00:00:00+03:00`);

/** Sorgu → repository filtresi. USER'da technicianId, tenant kapsamında tenantId yok sayılır (kapsam ezer, §1–2). */
export function resolveFilter(scope: hrepo.HistoryScope, q: ListSessionsQuery): hrepo.HistoryFilter {
  const ownOnly = scope.kind === "tenant" && scope.technicianId !== undefined;
  return {
    ...(q.status ? { status: q.status } : {}),
    ...(q.mode ? { mode: q.mode } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.from ? { from: istanbulDayStart(q.from) } : {}),
    ...(q.to ? { to: new Date(istanbulDayStart(q.to).getTime() + DAY_MS) } : {}),
    ...(q.technicianId && !ownOnly ? { technicianId: q.technicianId } : {}),
    ...(q.tenantId && scope.kind === "all" ? { tenantId: q.tenantId } : {}),
    ...(q.customer ? { customer: q.customer } : {}),
    ...(q.customerFirm ? { customerFirm: q.customerFirm } : {}),
    ...(q.deviceId ? { deviceId: q.deviceId } : {}),
  };
}

/** GET /sessions (AC-60, 61). Müşteri filtresi doluyken kullanıcı başına hız sınırı (S8-3; `%x%` taraması pahalı). */
export async function listHistorySessions(
  db: Db,
  auth: AuthContext,
  q: ListSessionsQuery,
  customerLimit?: FixedWindowCounter,
): Promise<Omit<SessionListResponse, "items"> & { items: Omit<SessionListItem, "waitingGuests">[] }> {
  if (q.customer !== undefined && customerLimit) {
    const wait = customerLimit.blockedFor(auth.user.id);
    if (wait > 0 || customerLimit.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  }
  const scope = historyScope(auth);
  const { rows, total } = await hrepo.listHistory(db, scope, resolveFilter(scope, q), q.sort, {
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  return { items: rows.map((r) => toListItem(r, scope, auth.user.id)), page: q.page, pageSize: q.pageSize, total };
}

/** GET /sessions/:id/history (AC-61, 62). Kapsam dışı/yok → 404. */
export async function getHistoryDetail(
  db: Db,
  log: HistoryLog,
  auth: AuthContext,
  id: string,
  now = Date.now(),
): Promise<SessionHistoryDetail> {
  const scope = historyScope(auth);
  const row = await hrepo.findHistory(db, scope, id);
  if (!row) throw new AppError("NOT_FOUND");
  return buildDetail(db, log, scope, row, auth.user.id, now);
}

// ---- PATCH (AC-63) ----

/**
 * Not/ticket güncelleme (§4): kapsam koşulu UPDATE'te; count 0 → 404. Audit `session.updated` yalnız ticketNo ve not
 * uzunluğu (not metni audit'e yazılmaz — audit 730 gün, KVKK). UPDATE + audit tek TX.
 */
export async function updateHistory(
  db: Db,
  log: HistoryLog,
  ctx: AuditContext,
  auth: AuthContext,
  id: string,
  data: UpdateSessionData,
): Promise<SessionHistoryDetail> {
  const scope = historyScope(auth);
  const patch = {
    ...(data.ticketNo !== undefined ? { ticketNo: data.ticketNo } : {}),
    ...(data.note !== undefined ? { note: data.note } : {}),
  };
  await db.$transaction(async (tx) => {
    const before = await hrepo.findHistory(tx, scope, id);
    if (!before) throw new AppError("NOT_FOUND");
    // P13a (AC-197): anonim oturumda düzenleme yok; koşullu UPDATE 0 → eşzamanlı anonimleştirme (kapsam aynı TX'te doğrulandı).
    if (before.anonymizedAt !== null || (await hrepo.updateNotes(tx, scope, id, patch)) === 0) throw new AppError("SESSION_ANONYMIZED");
    const after = { ticketNo: before.ticketNo, note: before.note, ...patch };
    await writeAudit(tx, ctx, {
      tenantId: before.tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: "session.updated",
      entity: "support_sessions",
      entityId: id,
      result: "success",
      oldValue: { ticketNo: before.ticketNo, noteLength: before.note?.length ?? 0 },
      newValue: { ticketNo: after.ticketNo, noteLength: after.note?.length ?? 0 },
    });
  });
  return getHistoryDetail(db, log, auth, id);
}

// ---- CSV (AC-63, 124) ----

interface CsvExport {
  filename: string;
  body: Readable;
}

/**
 * GET /sessions/export.csv (§5). Sıra: hız sınırı (5/dk/kullanıcı) → count (> 50.000 → 400, yarım dosya yok) → audit
 * `session.exported` (müşteri arama metni yazılmaz) → keyset partileriyle akış. Akış sırasında hata: log + ref, bağlantı
 * kesilir (dosya yarım kalır, istemci indirme hatası görür).
 */
export async function exportHistoryCsv(
  db: Db,
  log: HistoryLog,
  ctx: AuditContext,
  auth: AuthContext,
  q: ListSessionsQuery,
  limiter: FixedWindowCounter,
  now = new Date(),
): Promise<CsvExport> {
  const wait = limiter.blockedFor(auth.user.id);
  if (wait > 0 || limiter.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  const scope = historyScope(auth);
  const filter = resolveFilter(scope, q);
  const rows = await hrepo.countHistory(db, scope, filter);
  if (rows > SESSION_EXPORT_MAX_ROWS) throw new AppError("VALIDATION", { fields: { to: SESSION_EXPORT_TOO_MANY } });
  await auditExport(db, ctx, auth, scope, filter, q, rows);
  return { filename: exportFilename(now), body: Readable.from(csvStream(db, log, scope, filter, q, now), { objectMode: false }) };
}
