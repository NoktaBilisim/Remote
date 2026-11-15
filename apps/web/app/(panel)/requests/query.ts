import { REQUEST_SOURCES, type RequestSource } from "@remote/contracts/api/requests";
import { CLOSED_STATUSES, type RequestStatus } from "@/lib/requests/contract";
import { parseRequestCustomer } from "@/lib/customers/query";
import { parseAssigned, type AssignedFilter } from "@/lib/requests/p18";

/* /requests sayfasının URL durumu: sekme, Geçmiş durum filtresi, sayfa, müşteri, atama (P18), kaynak (P19). */

type SP = Record<string, string | string[] | undefined>;
export type Tab = "pending" | "history";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const PAGE_SIZE = 25;

export interface RequestsQuery {
  tab: Tab;
  status?: RequestStatus;
  page: number;
  customer?: string;
  assigned?: AssignedFilter;
  source?: RequestSource;
}

export function href(tab: Tab, status?: string, page = 1, customer?: string, assigned?: AssignedFilter, source?: RequestSource) {
  const q = new URLSearchParams();
  if (tab === "history") q.set("tab", "history");
  if (status) q.set("status", status);
  if (customer) q.set("customer", customer);
  if (assigned && tab === "pending") q.set("assigned", assigned);
  if (source) q.set("source", source);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/requests?${s}` : "/requests";
}

const oneOf = <T extends string>(list: readonly T[], raw: string | undefined): T | undefined =>
  (list as readonly string[]).includes(raw ?? "") ? (raw as T) : undefined;

export function parseRequestsQuery(sp: SP): RequestsQuery {
  const tab: Tab = one(sp.tab) === "history" ? "history" : "pending";
  const pageRaw = Number(one(sp.page));
  return {
    tab,
    status: oneOf(CLOSED_STATUSES as readonly RequestStatus[], one(sp.status)),
    page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1,
    customer: parseRequestCustomer(sp.customer),
    // P18 (AC-256): bekleyenlerde atama filtresi
    assigned: tab === "pending" ? parseAssigned(sp.assigned) : undefined,
    // P19 (AC-259): kaynak filtresi (İstemci / Web); diğer filtrelerle birlikte URL'de korunur
    source: oneOf(REQUEST_SOURCES, one(sp.source)),
  };
}

/** Kaynak filtresini koruyan sayfa bağlantısı (sekme, durum ve müşteri bağlantıları). */
export const linkFor =
  (q: RequestsQuery) =>
  (tb: Tab, st?: string, pg = 1, cu?: string, as?: AssignedFilter): string =>
    href(tb, st, pg, cu, as, q.source);

/** `GET /support-requests` yolu: bekleyenler (müşteri, atama, kaynak) · Geçmiş (durum, müşteri, kaynak, sayfa). */
export function listPath({ tab, status, page, customer, assigned, source }: RequestsQuery): string {
  const cq = customer ? `&customer=${encodeURIComponent(customer)}` : "";
  const sq = source ? `&source=${source}` : "";
  if (tab === "pending") return `/support-requests?tab=pending${cq}${assigned ? `&assigned=${assigned}` : ""}${sq}`;
  return `/support-requests?tab=history${status ? `&status=${status}` : ""}${cq}${sq}&page=${page}&pageSize=${PAGE_SIZE}`;
}
