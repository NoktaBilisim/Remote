/*
 * /audit filtre durumu URL'de (AC-76): `from`, `to` (YYYY-MM-DD, Türkiye günü), `tenantId` (yalnız Super Admin), `userId`,
 * `action` (tam ad veya `grup.*`), `result` (success | fail). Sayfalama keyset: `cursor` URL'de tutulmaz ("Daha fazla yükle"
 * istemcide ekler). Geçersiz değer API'ye gönderilmez — yok sayılır ve "bazı filtreler yok sayıldı" denir (kısmi durum).
 */
import { isCalendarDay } from "@/lib/history/query";
import { AUDIT_MAX_RANGE_DAYS, AUDIT_RESULTS, auditActionFilterSchema, type AuditResult } from "./contract";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DAY_MS = 86_400_000;

export interface AuditFilters {
  from?: string;
  to?: string;
  tenantId?: string;
  userId?: string;
  action?: string;
  result?: AuditResult;
}
export type AuditField = keyof AuditFilters;
type SP = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export const isAuditAction = (v: string): boolean => auditActionFilterSchema.safeParse(v).success;

/** İki gün arası gün farkı (YYYY-MM-DD; UTC gece yarısı, DST'den bağımsız). */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** YYYY-MM-DD'den n gün önce/sonra. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Tarih aralığı denetimi (sunucuyla aynı kural): geçerli gün, başlangıç ≤ bitiş, aralık ≤ 731 gün (bitiş yoksa bugüne kadar).
 * Hata anahtarı döner; geçerliyse null.
 */
export function rangeError(from: string | undefined, to: string | undefined, today: string): "date" | "order" | "range" | null {
  if ((from && !isCalendarDay(from)) || (to && !isCalendarDay(to))) return "date";
  if (from && to && from > to) return "order";
  if (from && daySpan(from, to ?? today) > AUDIT_MAX_RANGE_DAYS) return "range";
  return null;
}

/** URL sorgusu → doğrulanmış filtreler + yok sayılan alanlar. `allowTenant` yalnız Super Admin. */
export function parseAuditParams(sp: SP, opts: { allowTenant: boolean; today: string }): { filters: AuditFilters; ignored: AuditField[] } {
  const f: AuditFilters = {};
  const ignored: AuditField[] = [];
  const take = (key: AuditField, ok: (v: string) => boolean, set: (v: string) => void) => {
    const v = one(sp[key]);
    if (v === undefined) return;
    if (ok(v)) set(v);
    else ignored.push(key);
  };
  take("from", isCalendarDay, (v) => (f.from = v));
  take("to", isCalendarDay, (v) => (f.to = v));
  take("tenantId", (v) => opts.allowTenant && ULID.test(v), (v) => (f.tenantId = v));
  take("userId", (v) => ULID.test(v), (v) => (f.userId = v));
  take("action", isAuditAction, (v) => (f.action = v));
  take("result", (v) => (AUDIT_RESULTS as readonly string[]).includes(v), (v) => (f.result = v as AuditResult));
  const err = rangeError(f.from, f.to, opts.today);
  if (err === "order") {
    delete f.to;
    ignored.push("to");
  } else if (err === "range") {
    delete f.from;
    ignored.push("from");
  }
  return { filters: f, ignored };
}

const ORDER: AuditField[] = ["from", "to", "tenantId", "userId", "action", "result"];

/** Filtre → sorgu dizesi (boşlar yazılmaz; sabit sıra → kararlı URL). */
export function auditQuery(f: AuditFilters): string {
  const q = new URLSearchParams();
  for (const k of ORDER) {
    const v = f[k];
    if (v) q.set(k, v);
  }
  return q.toString();
}

export function auditHref(f: AuditFilters): string {
  const q = auditQuery(f);
  return q ? `/audit?${q}` : "/audit";
}

/** GET /audit (+ keyset `cursor`). */
export function auditApiPath(f: AuditFilters, cursor?: string | null): string {
  const q = new URLSearchParams(auditQuery(f));
  if (cursor) q.set("cursor", cursor);
  return `/audit?${q.toString()}`;
}

/** GET /audit/export.csv (aynı filtreler). */
export function auditExportPath(f: AuditFilters): string {
  const q = auditQuery(f);
  return q ? `/audit/export.csv?${q}` : "/audit/export.csv";
}

export const hasAuditFilters = (f: AuditFilters): boolean => ORDER.some((k) => Boolean(f[k]));
