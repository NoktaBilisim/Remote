/*
 * P18 (mimari-e11 §8b.2, §8b.5, §8b.8; AC-258) Ayarlar > Mesai saatleri formu: durum ↔ PUT gövdesi. Doğrulama contracts
 * `businessHoursSchema` (sunucuyla aynı kural); 400 `fields` aynı yollarla (`week.2.0.to`) alanlara yansır.
 */
import {
  AFTER_HOURS_MODES,
  BUSINESS_DAY_INTERVALS_MAX,
  businessHoursSchema,
  DEFAULT_TIME_ZONE,
  HOLIDAYS_MAX,
  holidayInputSchema,
  type AfterHoursMode,
  type BusinessHoursInput,
  type BusinessHoursView,
  type HolidayInput,
  type HolidayItem,
  type HolidayListResponse,
  type HolidayImportResponse,
} from "@remote/contracts/api/requests";
import { TR_HOLIDAY_YEARS } from "@remote/contracts/holidays-tr";

export {
  AFTER_HOURS_MODES,
  BUSINESS_DAY_INTERVALS_MAX,
  HOLIDAYS_MAX,
  TR_HOLIDAY_YEARS,
  type AfterHoursMode,
  type BusinessHoursView,
  type HolidayItem,
  type HolidayListResponse,
  type HolidayImportResponse,
};

export interface IntervalState {
  from: string;
  to: string;
}
export interface HoursState {
  enabled: boolean;
  timeZone: string;
  afterHoursMode: AfterHoursMode;
  /** Pazartesi = 0 … Pazar = 6. */
  week: IntervalState[][];
}

export const toHoursState = (v: BusinessHoursInput): HoursState => ({
  enabled: v.enabled,
  timeZone: v.timeZone,
  afterHoursMode: v.afterHoursMode,
  week: Array.from({ length: 7 }, (_, i) => (v.week[i] ?? []).map((x) => ({ from: x.from, to: x.to }))),
});

const norm = (s: HoursState) => JSON.stringify({ ...s, week: s.week.map((d) => d.map((x) => ({ from: x.from.trim(), to: x.to.trim() }))) });
export const hoursDirty = (a: HoursState, b: HoursState): boolean => norm(a) !== norm(b);

/** Varsayılan yeni aralık (gün satırına "Aralık ekle"). İkinci aralık birincinin bitişinden başlar. */
export function nextInterval(day: readonly IntervalState[]): IntervalState {
  const last = day.at(-1);
  if (!last) return { from: "09:00", to: "18:00" };
  return { from: last.to === "24:00" ? "23:00" : last.to, to: "24:00" };
}

/** Pazartesi aralıklarını Salı–Cuma'ya kopyalar (hafta sonu değişmez). */
export function copyMondayToWeekdays(s: HoursState): HoursState {
  const mon = s.week[0] ?? [];
  return { ...s, week: s.week.map((d, i) => (i >= 1 && i <= 4 ? mon.map((x) => ({ ...x })) : d)) };
}

/** Zod yolu → alan anahtarı ("week.2.0.to", "timeZone", "week"). */
const keyOf = (path: readonly PropertyKey[]) => path.map(String).join(".");

export function buildHours(s: HoursState): { input?: BusinessHoursInput; errors: Record<string, string> } {
  const body = {
    enabled: s.enabled,
    timeZone: s.timeZone.trim(),
    afterHoursMode: s.afterHoursMode,
    week: s.week.map((d) => d.map((x) => ({ from: x.from.trim(), to: x.to.trim() }))),
  };
  const r = businessHoursSchema.safeParse(body);
  if (r.success) return { input: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = keyOf(i.path) || "week";
    errors[k] ??= i.message;
  }
  return { errors };
}

/** IANA saat dilimleri (tarayıcı `Intl`) + UTC; varsayılan başta. */
export function timeZoneList(): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  const set = new Set([DEFAULT_TIME_ZONE, ...all, "UTC"]);
  return [...set];
}

export function filterTimeZones(list: readonly string[], q: string, max = 50): string[] {
  const n = q.trim().toLocaleLowerCase("tr").replace(/\s+/g, "_");
  return (n ? list.filter((z) => z.toLocaleLowerCase("tr").includes(n)) : list).slice(0, max);
}

// --- Tatiller ---

export interface HolidayDraft {
  day: string;
  name: string;
  /** Boş = tam gün kapalı. */
  openUntil: string;
}

export function buildHoliday(d: HolidayDraft): { input?: HolidayInput; errors: Record<string, string> } {
  const r = holidayInputSchema.safeParse({ day: d.day, name: d.name, openUntil: d.openUntil.trim() ? d.openUntil.trim() : null });
  if (r.success) return { input: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) errors[keyOf(i.path) || "name"] ??= i.message;
  return { errors };
}

/** Yıl seçici: içinde bulunulan yıl − 1 … + 2 ve TR listesinin yılları (tekil, artan). */
export function holidayYears(currentYear: number): number[] {
  return [...new Set([currentYear - 1, currentYear, currentYear + 1, currentYear + 2, ...TR_HOLIDAY_YEARS])].sort((a, b) => a - b);
}

export const sortHolidays = (xs: readonly HolidayItem[]): HolidayItem[] => [...xs].sort((a, b) => a.day.localeCompare(b.day));
