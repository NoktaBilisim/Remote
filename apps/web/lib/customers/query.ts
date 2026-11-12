/*
 * /customers liste durumu URL'de (AC-166): `q` (2..100, trim), `status` (active vars. | passive | all), `page`.
 * Sunucu `listCustomersQuerySchema` strict olduğundan geçersiz değer API'ye hiç gönderilmez (yok sayılır).
 */
import { UNSAFE_NAME_CHARS } from "@remote/contracts/api/sessions";
import { CUSTOMER_PAGE_SIZE_DEFAULT, CUSTOMER_STATUS_FILTERS, type CustomerStatusFilter } from "./contract";

export interface CustomerListParams {
  q?: string;
  status: CustomerStatusFilter;
  page: number;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Arama metni: trim, 2..100 kod noktası, görünmez/kontrol karakteri yok; geçersiz → undefined (arama yapılmaz). */
export function searchTerm(raw: string | undefined): string | undefined {
  const v = raw?.trim() ?? "";
  const n = [...v].length;
  if (n < 2 || n > 100 || UNSAFE_NAME_CHARS.test(v)) return undefined;
  return v;
}

export function parseCustomerParams(sp: SP): CustomerListParams {
  const status = one(sp.status);
  const page = Number(one(sp.page));
  return {
    q: searchTerm(one(sp.q)),
    status: (CUSTOMER_STATUS_FILTERS as readonly string[]).includes(status ?? "") ? (status as CustomerStatusFilter) : "active",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Uygulama içi bağlantı (varsayılanlar yazılmaz → kararlı URL). */
export function customersHref(p: Partial<CustomerListParams>): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.status && p.status !== "active") q.set("status", p.status);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? `/customers?${s}` : "/customers";
}

/** GET /customers sorgusu (sayfa ve boyut her zaman açık). */
export function customersApiPath(p: CustomerListParams): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  q.set("status", p.status);
  q.set("page", String(p.page));
  q.set("pageSize", String(CUSTOMER_PAGE_SIZE_DEFAULT));
  return `/customers?${q.toString()}`;
}

export const customerPageCount = (total: number, pageSize = CUSTOMER_PAGE_SIZE_DEFAULT) => Math.max(1, Math.ceil(total / pageSize));

/** Talepler müşteri filtresi (AC-176): `general` | ULID; diğer değer yok sayılır. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function parseRequestCustomer(raw: string | string[] | undefined): string | undefined {
  const v = one(raw);
  return v === "general" || (v && ULID.test(v)) ? v : undefined;
}
