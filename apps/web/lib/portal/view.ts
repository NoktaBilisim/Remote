/*
 * P21 portal geçmişi görünüm yardımcıları (saf, testli): sekme/sayfa sorgusu, sayfa sayısı, meta etiketleri (K-P21-7 —
 * yalnız sözleşmedeki alanlar; açıklama/not/IP/cihaz yok). Anonim satırda kişi adı "—".
 */
import { PORTAL_PAGE_MAX, PORTAL_PAGE_SIZE_DEFAULT, type PortalRequestItem, type PortalSessionItem } from "@remote/contracts/api/portal";
import { labelOf, PRIORITY_LABELS, REQUEST_SOURCE_LABELS, SESSION_MODE_LABELS } from "@remote/contracts/labels";
import { formatDateTime, formatDuration } from "@/lib/format";

export type PortalTab = "requests" | "sessions";

/** `?tab=&page=` → geçerli sekme ve sayfa (bilinmeyen → varsayılan; sunucu şeması strict olduğu için yalnız page/pageSize gider). */
export function parsePortalQuery(q: { tab?: string; page?: string }): { tab: PortalTab; page: number } {
  const tab: PortalTab = q.tab === "sessions" ? "sessions" : "requests";
  const n = Number(q.page);
  const page = Number.isInteger(n) && n >= 1 && n <= PORTAL_PAGE_MAX ? n : 1;
  return { tab, page };
}

export const pagesOf = (total: number, pageSize = PORTAL_PAGE_SIZE_DEFAULT): number => Math.max(1, Math.ceil(total / pageSize));

export const portalHref = (tab: PortalTab, page = 1): string =>
  `/portal?${new URLSearchParams({ ...(tab === "sessions" ? { tab } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`.replace(
    /\?$/,
    "",
  );

const dash = (v: string | null | undefined): string => (v && v.trim() ? v : "—");

export function requestFacts(r: PortalRequestItem) {
  return {
    created: formatDateTime(r.createdAt),
    closed: r.closedAt ? formatDateTime(r.closedAt) : "—",
    source: labelOf(REQUEST_SOURCE_LABELS, r.source),
    priority: labelOf(PRIORITY_LABELS, r.priority),
    requester: dash(r.requesterName),
  };
}

export function sessionFacts(s: PortalSessionItem) {
  return {
    created: formatDateTime(s.createdAt),
    started: s.startedAt ? formatDateTime(s.startedAt) : "—",
    ended: s.endedAt ? formatDateTime(s.endedAt) : "—",
    duration: s.durationSec === null ? "—" : formatDuration(s.durationSec),
    mode: s.mode ? labelOf(SESSION_MODE_LABELS, s.mode) : "—",
    technician: dash(s.technicianName),
    contact: dash(s.customerName),
    ticket: dash(s.ticketNo),
  };
}
