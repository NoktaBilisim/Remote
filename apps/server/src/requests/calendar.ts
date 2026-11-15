// P18 mesai takvimi ve SLA hesabı (mimari-e11 §8b.2; AC-257, 258; S-P18-T12). Saf fonksiyonlar (saat parametreyle gelir),
// yeni bağımlılık yok: saat dilimi ofseti `Intl.DateTimeFormat(…, {timeZone, timeZoneName: "longOffset"})` (Node 22 tam ICU).
// Yerel gün → UTC dönüşümü her gün için ayrı ofsetle yapılır (DST güvenli): var olmayan yerel saat (ileri atlama) sonraki
// geçerli dakikaya kayar; iki kez yaşanan saatte ilk geçiş (erken UTC anı) alınır. Tarama en çok 366 yerel gündür.
import type { AfterHoursMode, BusinessInterval } from "@remote/contracts/api/requests";
import { DEFAULT_TIME_ZONE } from "@remote/contracts/api/requests";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** Tarama ufku (yerel gün; başlangıç günü dahil). */
export const CALENDAR_SCAN_DAYS = 366;

/** Yerel gün içi dakika aralığı [from, to); to ≤ 1440 ("24:00" = gün sonu). */
export interface MinuteInterval {
  from: number;
  to: number;
}

export interface Calendar {
  enabled: boolean;
  timeZone: string;
  /** 7 gün, Pazartesi = 0; aralıklar `from` artan. */
  week: readonly (readonly MinuteInterval[])[];
  /** `YYYY-MM-DD` → `openUntil` dakikası (null = tam gün kapalı). */
  holidays: ReadonlyMap<string, number | null>;
  afterHoursMode: AfterHoursMode;
}

/** Takvim kapalı (mesai tanımsız): her an açık, SLA duvar saati. */
export const OPEN_CALENDAR: Calendar = {
  enabled: false,
  timeZone: DEFAULT_TIME_ZONE,
  week: [[], [], [], [], [], [], []],
  holidays: new Map(),
  afterHoursMode: "ACCEPT",
};

export const hhmmToMinutes = (v: string): number => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
export const minutesToHhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const formatters = new Map<string, Intl.DateTimeFormat>();
function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }); // geçersiz dilim → RangeError
    formatters.set(tz, f);
  }
  return f;
}

/** Saat dilimi kurulabilir mi (S-P18-T12: değilse çağıran Europe/Istanbul'a düşer). */
export function timeZoneUsable(tz: string): boolean {
  try {
    offsetFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** UTC anındaki ofset (ms; yerel = utc + ofset). "GMT" → 0, "GMT+03:00" → 3 sa, "GMT-04:00" → −4 sa. */
export function offsetMs(tz: string, utcMs: number): number {
  const name = offsetFormatter(tz)
    .formatToParts(utcMs)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "GMT");
  if (!m) return 0;
  const v = (Number(m[2]) * 60 + Number(m[3])) * MIN_MS;
  return m[1] === "-" ? -v : v;
}

interface LocalDay {
  y: number;
  m: number;
  d: number;
  /** Pazartesi = 0. */
  weekday: number;
  key: string;
}

function dayOf(utcMidnightMs: number): LocalDay {
  const t = new Date(utcMidnightMs);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  return { y, m, d, weekday: (t.getUTCDay() + 6) % 7, key: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

/** `at` anının yerel günü. */
function localDayOf(tz: string, at: number): LocalDay {
  const local = at + offsetMs(tz, at);
  return dayOf(Math.floor(local / DAY_MS) * DAY_MS);
}

/**
 * Yerel (gün, dakika) → UTC ms. Aday ofsetler günün iki yanından alınır; geçerli adaylardan en erkeni (iki kez yaşanan
 * saatte ilk geçiş). Hiçbiri geçerli değilse yerel saat boşluktadır (ileri atlama) → sonraki geçerli dakika.
 */
export function localToUtc(tz: string, y: number, m: number, d: number, minute: number): number {
  const wall0 = Date.UTC(y, m - 1, d) + minute * MIN_MS;
  for (let k = 0; k <= 24 * 60; k++) {
    const wall = wall0 + k * MIN_MS;
    const offs = new Set([offsetMs(tz, wall - DAY_MS), offsetMs(tz, wall), offsetMs(tz, wall + DAY_MS)]);
    let best: number | null = null;
    for (const off of offs) {
      const t = wall - off;
      if (t + offsetMs(tz, t) === wall && (best === null || t < best)) best = t;
    }
    if (best !== null) return best;
  }
  return wall0 - offsetMs(tz, wall0); // ulaşılmaz (boşluk ≤ 24 sa); savunma
}

/** Günün açık aralıkları (UTC [start, end), artan). Tatil tam gün → boş; `openUntil` doluysa aralıklar o dakikada kesilir. */
function openSpans(cal: Calendar, day: LocalDay): [number, number][] {
  const holiday = cal.holidays.get(day.key);
  const cut = holiday === undefined ? 1440 : holiday === null ? 0 : holiday;
  const out: [number, number][] = [];
  for (const iv of cal.week[day.weekday] ?? []) {
    const to = Math.min(iv.to, cut);
    if (to <= iv.from) continue;
    const start = localToUtc(cal.timeZone, day.y, day.m, day.d, iv.from);
    const end = to === 1440 ? localToUtc(cal.timeZone, day.y, day.m, day.d + 1, 0) : localToUtc(cal.timeZone, day.y, day.m, day.d, to);
    if (end > start) out.push([start, end]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Yerel günleri `at`'in gününden başlayarak en çok 366 gün gezer; `visit` true dönerse durur. */
function scanDays(cal: Calendar, at: number, visit: (spans: [number, number][]) => boolean): void {
  const first = localDayOf(cal.timeZone, at);
  const base = Date.UTC(first.y, first.m - 1, first.d);
  for (let i = 0; i < CALENDAR_SCAN_DAYS; i++) if (visit(openSpans(cal, dayOf(base + i * DAY_MS)))) return;
}

export function isOpen(cal: Calendar, at: number): boolean {
  if (!cal.enabled) return true;
  return openSpans(cal, localDayOf(cal.timeZone, at)).some(([s, e]) => s <= at && at < e);
}

/** Açıksa `at`; kapalıysa sonraki açılış; 366 yerel gün içinde açık an yoksa null. */
export function nextOpening(cal: Calendar, at: number): number | null {
  if (!cal.enabled) return at;
  let found: number | null = null;
  scanDays(cal, at, (spans) => {
    for (const [s, e] of spans) {
      if (e <= at) continue;
      found = Math.max(s, at);
      return true;
    }
    return false;
  });
  return found;
}

/**
 * Takvim kapalıysa duvar saati (`start + minutes`). Açıksa yalnız açık aralıklardaki dakikalar sayılır (tatil kapalı,
 * `openUntil` keser). 366 yerel gün içinde tamamlanmazsa null.
 */
export function addBusinessMinutes(cal: Calendar, start: number, minutes: number): number | null {
  if (!cal.enabled) return start + minutes * MIN_MS;
  let remaining = minutes * MIN_MS;
  let due: number | null = null;
  scanDays(cal, start, (spans) => {
    for (const [s, e] of spans) {
      const from = Math.max(s, start);
      if (e <= from) continue;
      if (e - from >= remaining) {
        due = from + remaining;
        return true;
      }
      remaining -= e - from;
    }
    return false;
  });
  return due;
}

/** DB `business_hours` JSON → dakika aralıkları; şema dışıysa null (çağıran takvimi "bozuk" sayar). */
export function parseWeek(json: unknown): MinuteInterval[][] | null {
  if (!Array.isArray(json) || json.length !== 7) return null;
  const week: MinuteInterval[][] = [];
  for (const day of json) {
    if (!Array.isArray(day)) return null;
    const out: MinuteInterval[] = [];
    for (const iv of day as unknown[]) {
      const o = iv as { from?: unknown; to?: unknown } | null;
      if (typeof o?.from !== "string" || typeof o.to !== "string") return null;
      if (!/^\d{2}:\d{2}$/.test(o.from) || !/^\d{2}:\d{2}$/.test(o.to)) return null;
      out.push({ from: hhmmToMinutes(o.from), to: hhmmToMinutes(o.to) });
    }
    week.push(out.sort((a, b) => a.from - b.from));
  }
  return week;
}

export const weekToJson = (week: readonly (readonly BusinessInterval[])[]): BusinessInterval[][] =>
  week.map((d) => [...d].sort((a, b) => (a.from < b.from ? -1 : 1)).map((i) => ({ from: i.from, to: i.to })));

export const weekFromJson = (json: unknown): BusinessInterval[][] =>
  (parseWeek(json) ?? OPEN_CALENDAR.week.map(() => [])).map((d) =>
    d.map((i) => ({ from: minutesToHhmm(i.from), to: minutesToHhmm(i.to) })),
  );

/** "Mesai dışındayız. Sonraki açılış: gg.aa.yyyy SS:dd (GMT+3)" — açık an yoksa yalnız ilk cümle. */
export function outsideHoursMessage(next: number | null, tz: string): string {
  if (next === null) return "Mesai dışındayız.";
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(next);
  const p = (t: Intl.DateTimeFormatPartTypes): string => parts.find((x) => x.type === t)?.value ?? "";
  const abbr =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(next).find((x) => x.type === "timeZoneName")
      ?.value ?? tz;
  return `Mesai dışındayız. Sonraki açılış: ${p("day")}.${p("month")}.${p("year")} ${p("hour")}:${p("minute")} (${abbr})`;
}
