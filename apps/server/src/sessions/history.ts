// Oturum geçmişi servisi (P8; AC-60..63, 124; mimari-api "Oturum geçmişi (P8)"). Kapsam her uçta `historyScope`.
// Liste (filtreli, sayfalı), detay (onaylar, kontrol dönemleri, zaman çizelgesi izdüşümü, kalite, dosyalar),
// not/ticket PATCH (audit'te not metni yok), CSV (formül kaçışı → RFC 4180; BOM, `;`, Europe/Istanbul).
import { actorLabelOf } from "../audit/view.ts";
import { Readable } from "node:stream";
import {
  SESSION_CSV_ANONYMIZED,
  SESSION_CSV_COLUMNS,
  SESSION_CSV_TENANT_COLUMN,
  SESSION_EXPORT_MAX_ROWS,
  SESSION_EXPORT_TOO_MANY,
  SESSION_HISTORY_LIST_MAX,
  TIMELINE_ACTIONS,
  TIMELINE_DETAIL_KEYS,
  storedQualitySummarySchema,
  type ConsentDecision,
  type ConsentLevel,
  type ConsentRecordSource,
  type ControlPeriod,
  type ListSessionsQuery,
  type SessionConsentRecord,
  type SessionFileRecord,
  type SessionHistoryDetail,
  type SessionListItem,
  type SessionListResponse,
  type SessionMode,
  type TimelineActor,
  type TimelineDetailValue,
  type TimelineEvent,
  type UpdateSessionData,
} from "@remote/contracts/api/sessions";
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import type { CustomerFirmRef, CustomerStatus } from "@remote/contracts/api/customers";
import {
  END_REASON_LABELS,
  FILE_CUSTOMER_REPORT_LABEL,
  FILE_VERIFIED_LABEL,
  SESSION_ENDED_BY_LABELS,
  SESSION_MODE_LABELS,
  SESSION_SOURCE_LABELS,
  SESSION_STATUS_LABELS,
  labelOf,
} from "@remote/contracts/labels";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { slaBreachedAt } from "@remote/contracts/api/requests";
import { CSV_BOM, csvRow, hms, istanbulDateTime } from "../lib/csv.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import * as hrepo from "./history-repo.ts";
import { historyScope, toView } from "./service.ts";

/** Uyarı/hata logu için dar arayüz (Fastify/pino logger uyar). */
export interface HistoryLog {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const DAY_MS = 86_400_000;
const EXPORT_BATCH = 1000;
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
  };
}

const durationSec = (r: { consumedAt: Date | null; endedAt: Date | null }): number | null =>
  r.consumedAt && r.endedAt ? Math.max(0, Math.floor((r.endedAt.getTime() - r.consumedAt.getTime()) / 1000)) : null;

/** Talep→kabul saniyesi (AC-158); TECH kaynağında null. */
const waitSecOf = (r: { request: { createdAt: Date; acceptedAt: Date | null } | null }): number | null =>
  r.request?.acceptedAt ? Math.max(0, Math.floor((r.request.acceptedAt.getTime() - r.request.createdAt.getTime()) / 1000)) : null;

/** P8c müşteri firma özeti (talep ve oturum listeleri aynı biçim). */
export const firmOf = (c: { id: string; name: string; status: string } | null): CustomerFirmRef | null =>
  c ? { id: c.id, name: c.name, status: c.status as CustomerStatus } : null;

export function toListItem(r: hrepo.HistoryListRow, scope: hrepo.HistoryScope, viewerId: string): Omit<SessionListItem, "waitingGuests"> {
  return {
    ...toView(r, viewerId),
    mode: (r.mode as SessionMode | null) ?? null,
    startedAt: r.consumedAt?.toISOString() ?? null,
    durationSec: durationSec(r),
    customerName: r.customerName,
    ticketNo: r.ticketNo,
    tenant: scope.kind === "all" ? { id: r.tenant.id, name: r.tenant.name } : null,
    source: r.requestId ? "REQUEST" : "TECH",
    waitSec: waitSecOf(r),
    customerFirm: firmOf(r.customer),
    anonymized: r.anonymizedAt !== null,
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

// ---- Detay (AC-62) ----

type Json = unknown;
const asObject = (v: Json): Record<string, Json> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
const MASKED = "***";
const NUMERIC_KEYS: ReadonlySet<string> = new Set(["ttlMin", "request", "monitorId"]);

function primitive(key: string, v: Json): TimelineDetailValue | undefined {
  if (v === MASKED) return undefined; // maskeli değer hiç dönmez
  if (NUMERIC_KEYS.has(key)) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d{1,9}$/.test(v)) return Number(v);
    return undefined;
  }
  if (typeof v === "string") return v.slice(0, 200);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  return undefined;
}

const selfElevatedOf = (v: Json): boolean | null => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);

/** Eylem başına izinli alan izdüşümü (§3); ham `new_value` dönmez. */
export function projectDetails(action: string, oldValue: Json, newValue: Json): Record<string, TimelineDetailValue> {
  const keys: readonly string[] = (TIMELINE_DETAIL_KEYS as Record<string, readonly string[]>)[action] ?? [];
  const nv = asObject(newValue);
  const out: Record<string, TimelineDetailValue> = {};
  for (const key of keys) {
    if (key === "selfElevated") {
      out[key] = selfElevatedOf(nv[key]);
      continue;
    }
    const raw = key === "oldCaps" ? asObject(oldValue).caps : key === "newCaps" ? nv.caps : nv[key];
    const val = primitive(key, raw);
    if (val !== undefined) out[key] = val;
  }
  if (action === CONTROL_AUDIT.CANCELLED && out.by === undefined) out.by = "tech"; // alan yoksa teknisyen (§3)
  return out;
}

function actorOf(a: { userId: string | null; username: string | null }, technicianId: string): TimelineActor {
  if (a.userId) return a.userId === technicianId ? "TECH" : "ADMIN";
  return a.username === "customer" ? "CUSTOMER" : "SYSTEM";
}

const CONTROL_PERIOD_ACTIONS = [CONTROL_AUDIT.GRANTED, CONTROL_AUDIT.REVOKED, CONTROL_AUDIT.RELEASED] as const;
const MATCH_SLACK_MS = 1000;

/**
 * Kontrol dönemleri (§3): CONTROL satırları sırayla; her GRANTED ardından gelen ilk REVOKED ile kapanır. Kapanış yoksa
 * null (tahmin yok). `revokedReason`/`selfElevated` sıradaki ilk uygun audit'ten (≥ zaman − 1 sn); her audit bir kez eşleşir.
 */
export function deriveControlPeriods(
  consents: readonly { createdAt: Date; level: string; decision: string; source: string }[],
  audits: readonly { createdAt: Date; action: string; newValue: Json }[],
): ControlPeriod[] {
  const granted = audits.filter((a) => a.action === CONTROL_AUDIT.GRANTED);
  const closes = audits.filter((a) => a.action === CONTROL_AUDIT.REVOKED || a.action === CONTROL_AUDIT.RELEASED);
  let gi = 0;
  let ci = 0;
  const take = <T extends { createdAt: Date }>(list: readonly T[], from: number, at: Date): [T | undefined, number] => {
    for (let i = from; i < list.length; i++) {
      const item = list[i];
      if (item && item.createdAt.getTime() >= at.getTime() - MATCH_SLACK_MS) return [item, i + 1];
    }
    return [undefined, from];
  };
  const out: ControlPeriod[] = [];
  let open: ControlPeriod | null = null;
  for (const c of consents) {
    if (c.level !== "CONTROL") continue;
    if (c.decision === "GRANTED") {
      if (open) out.push(open);
      const [a, next] = take(granted, gi, c.createdAt);
      gi = next;
      open = {
        grantedAt: c.createdAt.toISOString(),
        revokedAt: null,
        revokedSource: null,
        revokedReason: null,
        selfElevated: a ? selfElevatedOf(asObject(a.newValue).selfElevated) : null,
      };
    } else if (c.decision === "REVOKED" && open) {
      const [a, next] = take(closes, ci, c.createdAt);
      ci = next;
      const reason = a ? (a.action === CONTROL_AUDIT.RELEASED ? "tech" : asObject(a.newValue).reason) : null;
      out.push({
        ...open,
        revokedAt: c.createdAt.toISOString(),
        revokedSource: c.source as ConsentRecordSource,
        revokedReason: typeof reason === "string" ? reason : null,
      });
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

async function buildDetail(
  db: Db,
  log: HistoryLog,
  scope: hrepo.HistoryScope,
  row: hrepo.HistoryDetailRow,
  viewerId: string,
): Promise<SessionHistoryDetail> {
  const s = { id: row.id, tenantId: row.tenantId };
  const anonymized = row.anonymizedAt !== null;
  const [consents, files, timelineRows, controlAudits] = await Promise.all([
    hrepo.consentsOf(db, s, SESSION_HISTORY_LIST_MAX),
    hrepo.filesOf(db, s, SESSION_HISTORY_LIST_MAX),
    hrepo.auditsOf(db, s, TIMELINE_ACTIONS, SESSION_HISTORY_LIST_MAX + 1),
    hrepo.auditsOf(db, s, CONTROL_PERIOD_ACTIONS, 2 * SESSION_HISTORY_LIST_MAX),
  ]);
  const timelineTruncated = timelineRows.length > SESSION_HISTORY_LIST_MAX;
  const events = timelineRows.slice(0, SESSION_HISTORY_LIST_MAX);
  const userIds = new Set(events.flatMap((a) => (a.userId ? [a.userId] : [])));
  if (row.endedBy === "ADMIN" && row.terminatedBy) userIds.add(row.terminatedBy);
  // P16 (AC-241, S16-1): aktör etiketi audit görünümüyle aynı kural (`actorLabelOf`): satırı yok/DELETED → "Silinmiş kullanıcı #X".
  const users = new Map((await hrepo.userNames(db, [...userIds])).map((u) => [u.id, u]));

  let quality: SessionHistoryDetail["quality"] = null;
  if (row.qualitySummary !== null) {
    const parsed = storedQualitySummarySchema.safeParse(row.qualitySummary);
    if (parsed.success) quality = parsed.data;
    else log.warn({ event: "quality_summary_unparsable", sessionId: row.id }, "kalite özeti ayrıştırılamadı");
  }

  // S-P13a-1: yeni guest.* kayıtlarında ad yok; müşteri adı oturum satırından ve yalnız kabul edilen misafire (guestId
  // eşleşmesi; guestId'siz müşteri olayları = kabul edilen misafir) gösterilir. Eski kayıtların `details.name`'i önceliklidir.
  const admittedGuestId = events
    .map((a) => (a.action === "guest.admitted" ? asObject(a.newValue).guestId : undefined))
    .find((g) => typeof g === "string");
  const isAdmittedGuest = (a: { newValue: Json }): boolean => {
    const g = asObject(a.newValue).guestId;
    return typeof g !== "string" || g === admittedGuestId;
  };
  const timeline: TimelineEvent[] = events.map((a) => {
    const actor = actorOf(a, row.technicianId);
    const details = projectDetails(a.action, a.oldValue, a.newValue);
    const actorName =
      actor === "TECH" || actor === "ADMIN"
        ? a.userId
          ? actorLabelOf(a.userId, users)
          : null
        : actor === "CUSTOMER" && !anonymized
          ? typeof details.name === "string"
            ? details.name
            : isAdmittedGuest(a)
              ? row.customerName
              : null
          : null;
    // K-P13-3: anonim oturumda zaman çizelgesi müşteri adını taşımaz (audit 730 g append-only kalır; ad yalnız audit.view ile).
    if (anonymized) {
      delete details.name;
      // S-P13a-5: sonlandırma gerekçesi serbest metin (kişisel veri içerebilir) → anonim oturumda gösterilmez.
      if (a.action === "session.terminated") delete details.reason;
    }
    return { at: a.createdAt.toISOString(), action: a.action, actor, actorName, result: a.result === "fail" ? "fail" : "success", details };
  });

  return {
    ...toListItem(row, scope, viewerId),
    customerEmail: anonymized ? null : row.customerEmail,
    note: anonymized ? null : row.note,
    terminatedBy:
      row.endedBy === "ADMIN" && row.terminatedBy ? { id: row.terminatedBy, name: actorLabelOf(row.terminatedBy, users) } : null,
    quality,
    files: anonymized ? [] : collapseFileReports(files),
    consents: consents.map((c): SessionConsentRecord => ({
      id: c.id,
      at: c.createdAt.toISOString(),
      level: c.level as ConsentLevel,
      decision: c.decision as ConsentDecision,
      source: c.source as ConsentRecordSource,
      consentText: c.consentText ? { id: c.consentText.id, version: c.consentText.version, sha256: c.consentText.sha256 } : null,
    })),
    controlPeriods: deriveControlPeriods(consents, controlAudits),
    timeline,
    timelineTruncated,
    request: row.request
      ? {
          id: row.request.id,
          createdAt: row.request.createdAt.toISOString(),
          acceptedAt: row.request.acceptedAt?.toISOString() ?? null,
          waitSec: waitSecOf(row),
          // P13a: talep aynı turda anonimleşir; oturum anonimse savunma olarak yine boş döner.
          customerName: anonymized ? null : row.request.customerName,
          customerPhone: anonymized ? null : row.request.customerPhone,
          customerEmail: anonymized ? null : row.request.customerEmail,
          description: anonymized ? null : row.request.description,
        }
      : null,
  };
}

/** GET /sessions/:id/history (AC-61, 62). Kapsam dışı/yok → 404. */
export async function getHistoryDetail(db: Db, log: HistoryLog, auth: AuthContext, id: string): Promise<SessionHistoryDetail> {
  const scope = historyScope(auth);
  const row = await hrepo.findHistory(db, scope, id);
  if (!row) throw new AppError("NOT_FOUND");
  return buildDetail(db, log, scope, row, auth.user.id);
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

// ---- P15 (AC-238): dosya raporlarının tekilleştirilmesi ----

type FileReportRow = {
  id: string;
  reportedBy: string;
  matchKey: string | null;
  direction: string;
  sha256: string;
  sizeBytes: bigint | number;
};

/**
 * match_key'e göre grupla (NULL = eski satır, kendi başına bir grup). Teknisyen satırı varsa grup doğrulanmıştır.
 * P15 düzeltme 1 (QA 2): fid'siz istemci (0.10.x Go) alıcı raporu kendi `match_key`'ini taşır ve teknisyenin fid'li
 * gönderen raporuyla eşleşmez. Bu yüzden yalnız müşteri satırından oluşan her grup (fid'li ya da fid'siz; ayrım
 * yapılmaz), aynı yön + SHA-256 + boyuttaki, henüz müşteri eşi olmayan bir teknisyen grubuyla (sırayla, bire bir)
 * birleştirilir: teknisyen raporu varsa "doğrulanmış". fid'li müşteri satırına da uygulanması zararsızdır (doğrulama
 * yine teknisyen satırına bağlı; yalnız sayım etkilenir — guvenlik-raporu P15 kod turu 2). Eşi olmayan müşteri raporu
 * "Müşteri bildirimi" kalır. Gösterilen satır her zaman teknisyeninki.
 */
export function groupFileReports<T extends FileReportRow>(rows: readonly T[]): { row: T; verified: boolean }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.matchKey ?? `id:${r.id}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const content = (r: T) => `${r.direction}\n${r.sha256}\n${String(r.sizeBytes)}`;
  const isTech = (r: T) => r.reportedBy !== "CUSTOMER";
  const unpairedTech = new Map<string, T[][]>();
  for (const g of groups.values()) {
    const t = g.find(isTech);
    if (!t || g.length > 1) continue;
    const q = unpairedTech.get(content(t));
    if (q) q.push(g);
    else unpairedTech.set(content(t), [g]);
  }
  const out: T[][] = [];
  for (const g of groups.values()) {
    const first = g[0] as T;
    const partner = g.some(isTech) ? undefined : unpairedTech.get(content(first))?.shift();
    if (partner) partner.push(...g);
    else out.push(g);
  }
  return out.map((g) => {
    const tech = g.find(isTech);
    return { row: tech ?? (g[0] as T), verified: tech !== undefined };
  });
}

function collapseFileReports(files: Awaited<ReturnType<typeof hrepo.filesOf>>): SessionFileRecord[] {
  return groupFileReports(files).map(({ row: f, verified }): SessionFileRecord => ({
    id: f.id,
    direction: f.direction as SessionFileRecord["direction"],
    fileName: f.fileName,
    sizeBytes: Number(f.sizeBytes),
    sha256: f.sha256,
    result: f.result as SessionFileRecord["result"],
    createdAt: f.createdAt.toISOString(),
    reportedBy: f.reportedBy === "CUSTOMER" ? "CUSTOMER" : "TECH",
    verified,
  }));
}

/** CSV "Dosyalar" hücresi: "N doğrulanmış; M müşteri bildirimi" (sıfır olan kısım yazılmaz; dosya yoksa boş). */
export function fileSummaryCell(rows: readonly FileReportRow[]): string {
  const g = groupFileReports(rows);
  const v = g.filter((x) => x.verified).length;
  const c = g.length - v;
  return [
    v ? `${v} ${FILE_VERIFIED_LABEL.toLocaleLowerCase("tr")}` : "",
    c ? `${c} ${FILE_CUSTOMER_REPORT_LABEL.toLocaleLowerCase("tr")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

// ---- CSV (AC-63, 124) ----

export interface CsvExport {
  filename: string;
  body: Readable;
}

type SlaRow = Awaited<ReturnType<typeof hrepo.requestSlaOf>>[number];

/** "SLA aşıldı" hücresi: talepsiz oturum ya da SLA'sız talep boş; aksi `slaBreachedAt` (web/sunucu ortak). */
export function slaCell(sla: SlaRow | undefined, now: number): string {
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

const exportFilename = (now: Date): string => {
  const t = istanbulDateTime(now); // YYYY-MM-DD HH:mm:ss
  return `oturumlar-${t.slice(0, 10).replaceAll("-", "")}-${t.slice(11, 13)}${t.slice(14, 16)}.csv`;
};

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

  const withTenant = scope.kind === "all";
  const header = withTenant
    ? [SESSION_CSV_COLUMNS[0], SESSION_CSV_TENANT_COLUMN, ...SESSION_CSV_COLUMNS.slice(1)]
    : [...SESSION_CSV_COLUMNS];
  async function* generate(): AsyncGenerator<string> {
    yield CSV_BOM + csvRow(header);
    let after: { createdAt: Date; id: string } | null = null;
    let written = 0;
    try {
      while (written < SESSION_EXPORT_MAX_ROWS) {
        const batch = await hrepo.exportBatch(db, scope, filter, q.sort, after, Math.min(EXPORT_BATCH, SESSION_EXPORT_MAX_ROWS - written));
        if (batch.length === 0) return;
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
        yield batch
          .map((r) =>
            csvRow(csvCells(r, withTenant, bySession.get(r.id) ?? [], slaCell(r.requestId ? slaById.get(r.requestId) : undefined, at))),
          )
          .join("");
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
  return { filename: exportFilename(now), body: Readable.from(generate(), { objectMode: false }) };
}
