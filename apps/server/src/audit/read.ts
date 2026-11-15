// Audit ekranı servisi (P11; AC-76, AC-124). Kapsam: Admin/User yalnız etkin tenant; firma seçmemiş SUPER_ADMIN tüm
// tenant'lar + sistem kayıtları (tenant NULL) + isteğe bağlı tenantId. Liste keyset (50), CSV akış (≤ 50.000).
import { Readable } from "node:stream";
import {
  AUDIT_CSV_COLUMNS,
  AUDIT_CSV_TENANT_COLUMN,
  AUDIT_DEFAULT_RANGE_DAYS,
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_EXPORT_TOO_MANY,
  AUDIT_MAX_RANGE_DAYS,
  AUDIT_PAGE_SIZE,
  AUDIT_RANGE_TOO_LONG,
  AUDIT_RESULT_LABELS,
  type AuditItem,
  type AuditListResponse,
  type AuditResult,
  type ListAuditQuery,
} from "@remote/contracts/api/audit";
import { SYSTEM_AUDIT } from "@remote/contracts/audit";
import { labelOf } from "@remote/contracts/labels";
import type { AuthContext } from "../auth/session.ts";
import { CSV_BOM, csvRow, istanbulDateTime } from "../lib/csv.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { avatarUrlFor, type AvatarViewer } from "../uploads/urls.ts";
import * as repo from "./repo.ts";
import { writeAudit, type AuditContext } from "./service.ts";
import { auditValueView } from "./view.ts";

const DAY_MS = 86_400_000;
const EXPORT_BATCH = 1000;
const istanbulDayStart = (day: string): Date => new Date(`${day}T00:00:00+03:00`);

export function auditScope(auth: AuthContext): repo.AuditScope {
  if (auth.user.role === "SUPER_ADMIN" && !auth.tenantId) return { kind: "all" };
  if (!auth.tenantId) throw new AppError("FORBIDDEN");
  return { kind: "tenant", tenantId: auth.tenantId };
}

/** Sorgu → filtre. Varsayılan son 30 gün; aralık > 731 gün → 400. Tenant kapsamında `tenantId` yok sayılır. */
export function resolveAuditFilter(scope: repo.AuditScope, q: ListAuditQuery, now: Date): repo.AuditFilter {
  const to = q.to ? new Date(istanbulDayStart(q.to).getTime() + DAY_MS) : now;
  const from = q.from ? istanbulDayStart(q.from) : new Date(to.getTime() - AUDIT_DEFAULT_RANGE_DAYS * DAY_MS);
  if (to.getTime() - from.getTime() > AUDIT_MAX_RANGE_DAYS * DAY_MS)
    throw new AppError("VALIDATION", { fields: { from: AUDIT_RANGE_TOO_LONG } });
  return {
    from,
    to,
    ...(q.tenantId && scope.kind === "all" ? { tenantId: q.tenantId } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.action
      ? { action: q.action.endsWith(".*") ? { value: q.action.slice(0, -1), prefix: true } : { value: q.action, prefix: false } }
      : {}),
    ...(q.result ? { result: q.result } : {}),
  };
}

const BIGINT_MAX = 9_223_372_036_854_775_807n;

/** İmleç: base64url(`<createdAt ms>.<id>`). Biçim dışı veya id BIGINT aralığı dışında (B-P11-5) → 400 `fields.cursor`. */
export function encodeCursor(c: repo.AuditCursor): string {
  return Buffer.from(`${c.createdAt.getTime()}.${c.id}`, "utf8").toString("base64url");
}
export function decodeCursor(s: string): repo.AuditCursor {
  const m = /^(\d{1,15})\.(\d{1,19})$/.exec(Buffer.from(s, "base64url").toString("utf8"));
  const id = m ? BigInt(m[2] ?? "0") : 0n;
  if (!m || id > BIGINT_MAX) throw new AppError("VALIDATION", { fields: { cursor: "Geçersiz sayfa imleci" } });
  return { createdAt: new Date(Number(m[1])), id };
}

/** `viewer` verilirse avatar yalnız görüntüleyenin erişebildiği dosyaysa döner (başka tenant/sistem avatarı → null). */
function toItem(r: repo.AuditRow, names: Map<string, repo.AuditUserInfo>, viewer?: AvatarViewer): AuditItem {
  const u = r.userId ? names.get(r.userId) : undefined;
  return {
    id: r.id.toString(),
    createdAt: r.createdAt.toISOString(),
    tenantId: r.tenantId,
    tenantName: r.tenant?.name ?? null,
    userId: r.userId,
    username: r.username,
    userFullName: u?.fullName ?? null,
    avatarUrl: viewer ? avatarUrlFor(u?.avatarPath, viewer) : null,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    oldValue: auditValueView(r.action, r.oldValue),
    newValue: auditValueView(r.action, r.newValue),
    ipAddress: r.ipAddress || null,
    userAgent: r.userAgent || null,
    result: (r.result === "fail" ? "fail" : "success") as AuditResult,
  };
}

export async function listAuditItems(db: Db, auth: AuthContext, q: ListAuditQuery, now = new Date()): Promise<AuditListResponse> {
  const scope = auditScope(auth);
  const filter = resolveAuditFilter(scope, q, now);
  const rows = await repo.listAudit(db, scope, filter, q.cursor ? decodeCursor(q.cursor) : null, AUDIT_PAGE_SIZE + 1);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const names = await repo.userNames(
    db,
    page.flatMap((r) => (r.userId ? [r.userId] : [])),
  );
  const last = page[page.length - 1];
  const viewer: AvatarViewer = { role: auth.user.role, tenantId: auth.user.tenantId };
  return {
    items: page.map((r) => toItem(r, names, viewer)),
    nextCursor: rows.length > AUDIT_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

// ---- CSV (AC-124) ----

export interface AuditCsvExport {
  filename: string;
  body: Readable;
}

const json = (v: unknown): string => (v === null || v === undefined ? "" : JSON.stringify(v));

function csvCells(i: AuditItem, withTenant: boolean): string[] {
  return [
    istanbulDateTime(new Date(i.createdAt)),
    ...(withTenant ? [i.tenantName ?? ""] : []),
    i.username ?? "",
    i.userFullName ?? "",
    i.action,
    i.entity,
    i.entityId ?? "",
    labelOf(AUDIT_RESULT_LABELS, i.result),
    i.ipAddress ?? "",
    i.userAgent ?? "",
    json(i.oldValue),
    json(i.newValue),
  ];
}

const exportFilename = (now: Date): string => {
  const t = istanbulDateTime(now);
  return `audit-${t.slice(0, 10).replaceAll("-", "")}-${t.slice(11, 13)}${t.slice(14, 16)}.csv`;
};

/**
 * GET /audit/export.csv: hız sınırı (5/dk/kullanıcı) → üst sınırlı sayım (> 50.000 → 400, yarım dosya yok) → audit
 * `audit.exported` (filtre özeti) → keyset partileriyle akış. Akış hatası: log + ref, bağlantı kesilir.
 */
export async function exportAuditCsv(
  db: Db,
  log: { error(o: object, m: string): void },
  ctx: AuditContext,
  auth: AuthContext,
  q: ListAuditQuery,
  limiter: FixedWindowCounter,
  now = new Date(),
): Promise<AuditCsvExport> {
  const wait = limiter.blockedFor(auth.user.id);
  if (wait > 0 || limiter.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  const scope = auditScope(auth);
  const filter = resolveAuditFilter(scope, q, now);
  const rows = await repo.countAuditUpTo(db, scope, filter, AUDIT_EXPORT_MAX_ROWS);
  if (rows > AUDIT_EXPORT_MAX_ROWS) throw new AppError("VALIDATION", { fields: { to: AUDIT_EXPORT_TOO_MANY } });
  await writeAudit(db, ctx, {
    tenantId: scope.kind === "tenant" ? scope.tenantId : null,
    userId: auth.user.id,
    username: auth.user.email,
    action: SYSTEM_AUDIT.AUDIT_EXPORTED,
    entity: "audit_logs",
    result: "success",
    newValue: {
      from: filter.from.toISOString(),
      to: filter.to.toISOString(),
      tenantId: filter.tenantId ?? null,
      userId: filter.userId ?? null,
      action: q.action ?? null,
      result: filter.result ?? null,
      rows,
    },
  });
  const withTenant = scope.kind === "all";
  const header = withTenant ? [AUDIT_CSV_COLUMNS[0], AUDIT_CSV_TENANT_COLUMN, ...AUDIT_CSV_COLUMNS.slice(1)] : [...AUDIT_CSV_COLUMNS];
  async function* generate(): AsyncGenerator<string> {
    yield CSV_BOM + csvRow(header);
    let after: repo.AuditCursor | null = null;
    let written = 0;
    try {
      while (written < AUDIT_EXPORT_MAX_ROWS) {
        const batch = await repo.listAudit(db, scope, filter, after, Math.min(EXPORT_BATCH, AUDIT_EXPORT_MAX_ROWS - written));
        if (batch.length === 0) return;
        const names = await repo.userNames(
          db,
          batch.flatMap((r) => (r.userId ? [r.userId] : [])),
        );
        yield batch.map((r) => csvRow(csvCells(toItem(r, names), withTenant))).join("");
        written += batch.length;
        const last = batch[batch.length - 1];
        if (!last || batch.length < EXPORT_BATCH) return;
        after = { createdAt: last.createdAt, id: last.id };
      }
    } catch (err) {
      log.error({ err, ref: newId(), event: "audit_export_stream_failed" }, "audit CSV akışı kesildi");
      throw err;
    }
  }
  return { filename: exportFilename(now), body: Readable.from(generate(), { objectMode: false }) };
}
