// Oturum geçmişi detayı (history.ts `buildDetail`'den taşındı ve bölündü, PT-K12; AC-62, K-P13-3, S-P13a-1/5, P18 §8b.8).
import type { StoredFileItem } from "@remote/contracts/api/fsrv";
import {
  AV_SIGNATURE_PATTERN,
  FSRV_PRINT_FILE_NAME,
  type AvScanReason,
  type FsrvDirection,
  type FsrvPurpose,
  type StoredFileState,
} from "@remote/contracts/ws-fsrv";
import { listForSession, type StoredRow } from "../fsrv/repo.ts";
import type { SessionRecordingSummary } from "@remote/contracts/api/recording";
import { recFromDb, type RecBasis, type RecDeleteReason, type RecState, type RecStopReason } from "@remote/contracts/ws-rec";
import { findBySession, type RecRow } from "../rec/repo.ts";
import { actorLabelOf } from "../audit/view.ts";
import {
  SESSION_HISTORY_LIST_MAX,
  TIMELINE_ACTIONS,
  storedQualitySummarySchema,
  type ConsentDecision,
  type ConsentLevel,
  type ConsentRecordSource,
  type SessionConsentRecord,
  type SessionHistoryDetail,
  type TimelineActor,
  type TimelineDetailValue,
  type TimelineEvent,
} from "@remote/contracts/api/sessions";
import { slaBreachedAt } from "@remote/contracts/api/requests";
import type { Db } from "../lib/db.ts";
import type { HistoryLog } from "./history.ts";
import * as hrepo from "./history-repo.ts";
import { unattendedInfo } from "./history-unattended.ts";
import { participantsOf } from "./history-participants.ts";
import { countSessionChat, hasLegacyAudit } from "./chat.ts";
import {
  CONTROL_PERIOD_ACTIONS,
  actorOf,
  asObject,
  collapseFileReports,
  deriveControlPeriods,
  projectDetails,
  toListItem,
  waitSecOf,
  type Json,
} from "./history-view.ts";

type Users = Parameters<typeof actorLabelOf>[1];
type AuditRow = Awaited<ReturnType<typeof hrepo.auditsOf>>[number];

function qualityOf(log: HistoryLog, row: hrepo.HistoryDetailRow): SessionHistoryDetail["quality"] {
  let quality: SessionHistoryDetail["quality"] = null;
  if (row.qualitySummary !== null) {
    const parsed = storedQualitySummarySchema.safeParse(row.qualitySummary);
    if (parsed.success) quality = parsed.data;
    else log.warn({ event: "quality_summary_unparsable", sessionId: row.id }, "kalite özeti ayrıştırılamadı");
  }
  return quality;
}

/** Zaman çizelgesi aktör adı; CUSTOMER için olayın adı, yoksa yalnız kabul edilen misafire oturumdaki müşteri adı. */
function actorNameOf(
  a: AuditRow,
  actor: TimelineActor,
  details: Record<string, TimelineDetailValue>,
  ctx: { row: hrepo.HistoryDetailRow; users: Users; anonymized: boolean; isAdmittedGuest: (a: { newValue: Json }) => boolean },
): string | null {
  if (actor === "TECH" || actor === "ADMIN") return a.userId ? actorLabelOf(a.userId, ctx.users) : null;
  if (actor !== "CUSTOMER" || ctx.anonymized) return null;
  if (typeof details.name === "string") return details.name;
  return ctx.isAdmittedGuest(a) ? ctx.row.customerName : null;
}

function timelineOf(
  events: AuditRow[],
  row: hrepo.HistoryDetailRow,
  users: Users,
  anonymized: boolean,
  techIds: ReadonlySet<string> = new Set(),
): TimelineEvent[] {
  // S-P13a-1: yeni guest.* kayıtlarında ad yok; müşteri adı oturum satırından ve yalnız kabul edilen misafire (guestId
  // eşleşmesi; guestId'siz müşteri olayları = kabul edilen misafir) gösterilir. Eski kayıtların `details.name`'i önceliklidir.
  const admittedGuestId = events
    .map((a) => (a.action === "guest.admitted" ? asObject(a.newValue).guestId : undefined))
    .find((g) => typeof g === "string");
  const isAdmittedGuest = (a: { newValue: Json }): boolean => {
    const g = asObject(a.newValue).guestId;
    return typeof g !== "string" || g === admittedGuestId;
  };
  return events.map((a) => {
    // P28c (AC-369): katılımcı/izleyici ve devreden eski sahip de teknisyendir (yönetici değil).
    const base = actorOf(a, row.technicianId);
    const actor: TimelineActor = base === "ADMIN" && a.userId !== null && techIds.has(a.userId) ? "TECH" : base;
    const details = projectDetails(a.action, a.oldValue, a.newValue);
    const actorName = actorNameOf(a, actor, details, { row, users, anonymized, isAdmittedGuest });
    // K-P13-3: anonim oturumda zaman çizelgesi müşteri adını taşımaz (audit 730 g append-only kalır; ad yalnız audit.view ile).
    if (anonymized) {
      delete details.name;
      // S-P13a-5: sonlandırma gerekçesi serbest metin (kişisel veri içerebilir) → anonim oturumda gösterilmez.
      if (a.action === "session.terminated") delete details.reason;
    }
    return { at: a.createdAt.toISOString(), action: a.action, actor, actorName, result: a.result === "fail" ? "fail" : "success", details };
  });
}

const consentRecordOf = (c: Awaited<ReturnType<typeof hrepo.consentsOf>>[number]): SessionConsentRecord => ({
  id: c.id,
  at: c.createdAt.toISOString(),
  level: c.level as ConsentLevel,
  decision: c.decision as ConsentDecision,
  source: c.source as ConsentRecordSource,
  consentText: c.consentText ? { id: c.consentText.id, version: c.consentText.version, sha256: c.consentText.sha256 } : null,
});

function requestOf(row: hrepo.HistoryDetailRow, anonymized: boolean, now: number): SessionHistoryDetail["request"] {
  return row.request
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
        // P18 (§8b.8): CSV "SLA aşıldı" hücresiyle aynı hesap (`slaCell` → `slaBreachedAt`); SLA yoksa ikisi de null.
        slaDueAt: row.request.slaDueAt?.toISOString() ?? null,
        slaBreached: row.request.slaDueAt === null ? null : slaBreachedAt(row.request, now),
      }
    : null;
}

export async function buildDetail(
  db: Db,
  log: HistoryLog,
  scope: hrepo.HistoryScope,
  row: hrepo.HistoryDetailRow,
  viewerId: string,
  now: number,
  canFiles = false,
  recPerms: { view: boolean; del: boolean } = { view: false, del: false },
  canChat = false,
): Promise<SessionHistoryDetail> {
  const s = { id: row.id, tenantId: row.tenantId };
  const anonymized = row.anonymizedAt !== null;
  const [consents, files, timelineRows, controlAudits, stored, rec, participants] = await Promise.all([
    hrepo.consentsOf(db, s, SESSION_HISTORY_LIST_MAX),
    hrepo.filesOf(db, s, SESSION_HISTORY_LIST_MAX),
    hrepo.auditsOf(db, s, TIMELINE_ACTIONS, SESSION_HISTORY_LIST_MAX + 1),
    hrepo.auditsOf(db, s, CONTROL_PERIOD_ACTIONS, 2 * SESSION_HISTORY_LIST_MAX),
    listForSession(db, row.tenantId, row.id, SESSION_HISTORY_LIST_MAX),
    findBySession(db, row.tenantId, row.id),
    participantsOf(db, s),
  ]);
  const timelineTruncated = timelineRows.length > SESSION_HISTORY_LIST_MAX;
  const events = timelineRows.slice(0, SESSION_HISTORY_LIST_MAX);
  const userIds = new Set(events.flatMap((a) => (a.userId ? [a.userId] : [])));
  if (row.endedBy === "ADMIN" && row.terminatedBy) userIds.add(row.terminatedBy);
  // P16 (AC-241, S16-1): aktör etiketi audit görünümüyle aynı kural (`actorLabelOf`): satırı yok/DELETED → "Silinmiş kullanıcı #X".
  const users = new Map((await hrepo.userNames(db, [...userIds])).map((u) => [u.id, u]));
  const quality = qualityOf(log, row);
  const timeline = timelineOf(events, row, users, anonymized, new Set(participants.map((p) => p.userId)));

  return {
    ...toListItem(row, scope, viewerId),
    customerEmail: anonymized ? null : row.customerEmail,
    note: anonymized ? null : row.note,
    terminatedBy:
      row.endedBy === "ADMIN" && row.terminatedBy ? { id: row.terminatedBy, name: actorLabelOf(row.terminatedBy, users) } : null,
    quality,
    files: anonymized ? [] : collapseFileReports(files),
    consents: consents.map(consentRecordOf),
    controlPeriods: deriveControlPeriods(consents, controlAudits),
    timeline,
    timelineTruncated,
    request: requestOf(row, anonymized, now),
    storedFiles: anonymized ? [] : stored.map((f) => storedFileItem(f, canFiles)),
    ...(row.mode === "UNATTENDED" ? { unattended: await unattendedInfo(db, row, anonymized) } : {}),
    recording: rec ? recordingSummary(rec, recPerms) : null,
    participants,
    ...(canChat ? { chat: await chatSummaryOf(db, s) } : {}),
  };
}

/**
 * P22 (§5.1, r2 §15.4): `count` = oturum sohbeti satırı sayısı (IX); `legacy` = `session.chat_legacy` audit satırı var
 * (özetten değil; çökmeden etkilenmez). Çağıran `sessions.view_chat` denetler.
 */
async function chatSummaryOf(db: Db, s: { id: string; tenantId: string }): Promise<NonNullable<SessionHistoryDetail["chat"]>> {
  const [count, legacy] = await Promise.all([countSessionChat(db, s.tenantId, s.id), hasLegacyAudit(db, s.tenantId, s.id)]);
  return { count, legacy };
}

/** P28e (§5, AC-385/386/450): kayıt özeti; `canView` silinmemiş kayıtta iki yetki, `canDelete` durmuş kayıtta `edit`. */
function recordingSummary(r: RecRow, perms: { view: boolean; del: boolean }): SessionRecordingSummary {
  const state = recFromDb(r.state) as RecState;
  return {
    state,
    basis: recFromDb(r.basis) as RecBasis,
    ...(r.stopReason ? { stopReason: recFromDb(r.stopReason) as RecStopReason } : {}),
    ...(r.deleteReason ? { deleteReason: recFromDb(r.deleteReason) as RecDeleteReason } : {}),
    durationMs: r.durationMs,
    expiresAt: r.expiresAt.toISOString(),
    canView: perms.view && state !== "deleted",
    canDelete: perms.del && state === "stopped",
  };
}

/** P28b (§4): saklanan dosya satırı; `canDownload` = saklanan dosya (FILE + CLEAN + teslim) ve iki yetki. */
function storedFileItem(f: StoredRow, canFiles: boolean): StoredFileItem {
  const kept = f.purpose === "FILE" && f.state === "CLEAN" && f.deliveredAt !== null;
  return {
    id: f.id,
    direction: f.direction as FsrvDirection,
    purpose: f.purpose as FsrvPurpose,
    name: f.purpose === "PRINT" ? FSRV_PRINT_FILE_NAME : f.fileName,
    sizeBytes: Number(f.sizeBytes),
    state: f.state as StoredFileState,
    ...(f.state === "SCAN_FAILED" && f.scanReason ? { scanReason: f.scanReason as AvScanReason } : {}),
    ...(f.state === "INFECTED" && f.signature && AV_SIGNATURE_PATTERN.test(f.signature) ? { signature: f.signature } : {}),
    ...(kept && f.expiresAt ? { expiresAt: f.expiresAt.toISOString() } : {}),
    canDownload: kept && canFiles,
  };
}
