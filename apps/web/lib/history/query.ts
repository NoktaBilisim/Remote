/*
 * /history filtre durumu URL'de (AC-60). Kurallar sunucu `listSessionsQuerySchema` ile aynı (mimari-api P8 §1):
 * sunucu `z.strictObject` olduğundan geçersiz/bilinmeyen değer API'ye hiç gönderilmez — yok sayılır ve
 * kullanıcıya "bazı filtreler yok sayıldı" denir (kısmi durum).
 */
import {
  SESSION_MODES,
  SESSION_PAGE_SIZE_MAX,
  SESSION_SOURCES,
  SESSION_STATUSES,
  UNSAFE_NAME_CHARS,
  type SessionMode,
  type SessionSource,
  type SessionStatus,
} from "@remote/contracts/api/sessions";

export const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryFilters {
  status?: SessionStatus;
  mode?: SessionMode;
  /** P8b (AC-158): Talep / Teknisyen */
  source?: SessionSource;
  from?: string;
  to?: string;
  technicianId?: string;
  tenantId?: string;
  customer?: string;
  /** P8c (AC-179): müşteri FİRMA filtresi — `none` (müşterisiz) | ULID (sorgu adı `customerFirm`). */
  customerFirm?: string;
  page: number;
  pageSize: number;
}

type FilterField = Exclude<keyof HistoryFilters, "page" | "pageSize"> | "page" | "pageSize";
export type SearchParams = Record<string, string | string[] | undefined>;

/** "2026-02-30" gibi var olmayan günleri de reddeder. */
export function isCalendarDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Müşteri arama metni: trim, 2..100, görünmez/kontrol karakteri yok. Geçersizse hata anahtarı. */
export function checkCustomer(raw: string): { value?: string; error?: "short" | "long" | "chars" } {
  const v = raw.trim();
  if (!v) return {};
  if (UNSAFE_NAME_CHARS.test(v)) return { error: "chars" };
  if (v.length < 2) return { error: "short" };
  if (v.length > 100) return { error: "long" };
  return { value: v };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const int = (v: string | undefined) => (v && /^\d{1,6}$/.test(v) ? Number(v) : NaN);

/** URL sorgusu → doğrulanmış filtreler + yok sayılan alanlar. */
export function parseFilters(sp: SearchParams): { filters: HistoryFilters; ignored: FilterField[] } {
  const ignored: FilterField[] = [];
  const f: HistoryFilters = { page: 1, pageSize: DEFAULT_PAGE_SIZE };
  const take = <K extends FilterField>(key: K, ok: (v: string) => boolean, set: (v: string) => void) => {
    const v = one(sp[key]);
    if (v === undefined) return;
    if (ok(v)) set(v);
    else ignored.push(key);
  };
  take(
    "status",
    (v) => (SESSION_STATUSES as readonly string[]).includes(v),
    (v) => (f.status = v as SessionStatus),
  );
  take(
    "mode",
    (v) => (SESSION_MODES as readonly string[]).includes(v),
    (v) => (f.mode = v as SessionMode),
  );
  take(
    "source",
    (v) => (SESSION_SOURCES as readonly string[]).includes(v),
    (v) => (f.source = v as SessionSource),
  );
  take("from", isCalendarDay, (v) => (f.from = v));
  take("to", isCalendarDay, (v) => (f.to = v));
  take(
    "technicianId",
    (v) => ULID.test(v),
    (v) => (f.technicianId = v),
  );
  take(
    "tenantId",
    (v) => ULID.test(v),
    (v) => (f.tenantId = v),
  );
  take(
    "customer",
    (v) => checkCustomer(v).value !== undefined,
    (v) => (f.customer = checkCustomer(v).value),
  );
  take(
    "customerFirm",
    (v) => v === "none" || ULID.test(v),
    (v) => (f.customerFirm = v),
  );
  take(
    "page",
    (v) => int(v) >= 1 && int(v) <= 10_000,
    (v) => (f.page = int(v)),
  );
  take(
    "pageSize",
    (v) => int(v) >= 1 && int(v) <= SESSION_PAGE_SIZE_MAX,
    (v) => (f.pageSize = int(v)),
  );
  // from > to → sunucu 400 verir; bitişi yok say (başlangıç korunur)
  if (f.from && f.to && f.from > f.to) {
    delete f.to;
    ignored.push("to");
  }
  return { filters: f, ignored };
}

/** Filtre → sorgu dizesi (varsayılanlar yazılmaz; sabit sıra → kararlı URL). */
function toQuery(f: Partial<HistoryFilters>, opts: { paging?: boolean } = {}): string {
  const q = new URLSearchParams();
  const put = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== "") q.set(k, String(v));
  };
  put("from", f.from);
  put("to", f.to);
  put("status", f.status);
  put("mode", f.mode);
  put("source", f.source);
  put("technicianId", f.technicianId);
  put("tenantId", f.tenantId);
  put("customer", f.customer);
  put("customerFirm", f.customerFirm);
  if (opts.paging !== false) {
    if (f.page && f.page > 1) put("page", f.page);
    if (f.pageSize && f.pageSize !== DEFAULT_PAGE_SIZE) put("pageSize", f.pageSize);
  }
  return q.toString();
}

/** /history bağlantısı (sayfa/sayfa boyutu dahil). */
export function historyHref(f: Partial<HistoryFilters>): string {
  const q = toQuery(f);
  return q ? `/history?${q}` : "/history";
}

/** GET /sessions sorgusu: sayfa/sayfa boyutu her zaman açık (sunucu varsayılanına bağlı kalınmaz). */
export function listApiPath(f: HistoryFilters): string {
  const q = new URLSearchParams(toQuery(f, { paging: false }));
  q.set("page", String(f.page));
  q.set("pageSize", String(f.pageSize));
  return `/sessions?${q.toString()}`;
}

/** GET /sessions/export.csv sorgusu (sayfa yok sayılır, mimari-api §5). */
export function exportApiPath(f: Partial<HistoryFilters>): string {
  const q = toQuery(f, { paging: false });
  return q ? `/sessions/export.csv?${q}` : "/sessions/export.csv";
}

export const hasFilters = (f: HistoryFilters) =>
  Boolean(f.status || f.mode || f.source || f.from || f.to || f.technicianId || f.tenantId || f.customer || f.customerFirm);

/** Sayfa düğmeleri için toplam sayfa (en az 1). */
export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));
