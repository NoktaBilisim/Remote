/* /admin/tenants liste durumu URL'de: `q`, `status` (all vars. | active | passive), `page` (contracts `listTenantsQuerySchema`). */
import { TENANT_STATUS_FILTERS, type TenantStatusFilter } from "@remote/contracts/api/tenants";
import { searchTerm } from "@/lib/customers/query";
import { TENANT_PAGE_SIZE_DEFAULT } from "./contract";

export interface TenantListParams {
  q?: string;
  status: TenantStatusFilter;
  page: number;
}
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseTenantParams(sp: SP): TenantListParams {
  const s = one(sp.status);
  const page = Number(one(sp.page));
  return {
    q: searchTerm(one(sp.q)),
    status: (TENANT_STATUS_FILTERS as readonly string[]).includes(s ?? "") ? (s as TenantStatusFilter) : "all",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function tenantsHref(p: Partial<TenantListParams>): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.status && p.status !== "all") q.set("status", p.status);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? `/admin/tenants?${s}` : "/admin/tenants";
}

export function tenantsApiPath(p: TenantListParams): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  q.set("status", p.status);
  q.set("page", String(p.page));
  q.set("pageSize", String(TENANT_PAGE_SIZE_DEFAULT));
  return `/admin/tenants?${q.toString()}`;
}
