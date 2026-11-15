/*
 * /users liste durumu URL'de: `q` (2..100, trim), `role` (all vars. | ADMIN | USER), `status` (active vars. | passive | all), `page`.
 * Geçersiz değer yok sayılır (API'ye gönderilmez). Sorgu şeması `listUsersQuerySchema` (contracts).
 */
import { searchTerm } from "@/lib/customers/query";
import { USER_PAGE_SIZE_DEFAULT, USER_ROLE_FILTERS, USER_STATUS_FILTERS, type UserRoleFilter, type UserStatusFilter } from "./contract";

export interface UserListParams {
  q?: string;
  role: UserRoleFilter;
  status: UserStatusFilter;
  page: number;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

export function parseUserParams(sp: SP): UserListParams {
  const page = Number(one(sp.page));
  return {
    q: searchTerm(one(sp.q)),
    role: pick(one(sp.role), USER_ROLE_FILTERS, "all"),
    status: pick(one(sp.status), USER_STATUS_FILTERS, "active"),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Uygulama içi bağlantı (varsayılanlar yazılmaz → kararlı URL). */
export function usersHref(p: Partial<UserListParams>): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.role && p.role !== "all") q.set("role", p.role);
  if (p.status && p.status !== "active") q.set("status", p.status);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  const s = q.toString();
  return s ? `/users?${s}` : "/users";
}

/** GET /users sorgusu (sayfa ve boyut her zaman açık; `role=all` gönderilmez). */
export function usersApiPath(p: UserListParams): string {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.role !== "all") q.set("role", p.role);
  q.set("status", p.status);
  q.set("page", String(p.page));
  q.set("pageSize", String(USER_PAGE_SIZE_DEFAULT));
  return `/users?${q.toString()}`;
}

export const userPageCount = (total: number, pageSize = USER_PAGE_SIZE_DEFAULT) => Math.max(1, Math.ceil(total / pageSize));
