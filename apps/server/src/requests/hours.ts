// P18 mesai takvimi önbelleği + mesai/tatil ayar servisi (mimari-e11 §8b.2, §8b.5; AC-258; S-P18-T12).
//  - Önbellek: tenant başına 60 sn (P15 engel önbelleği kalıbı); ayar/tatil yazımında geçersiz kılınır (tek instance, ADR-0005).
//  - Takvim kurulamazsa (bilinmeyen saat dilimi / şema dışı JSON / RangeError) Europe/Istanbul'a düşülür, `rs_calendar_fallback_total`
//    artar + alarm logu; takvim "bozuk" sayılır → mesai kapalı sayılmaz (talep reddedilmez), SLA NULL.
//  - Tatil ekleme ≤ 200 sınırı `tenant_request_settings` satırı FOR UPDATE altında sayılır (T12). UPDATE yok (sil + ekle).
import type {
  AfterHoursMode,
  BusinessHoursInput,
  BusinessHoursView,
  HolidayImportResponse,
  HolidayInput,
  HolidayItem,
  HolidayListResponse,
  PublicBusinessHours,
} from "@remote/contracts/api/requests";
import { DEFAULT_TIME_ZONE, HOLIDAY_DAY_CONFLICT_MESSAGE, HOLIDAYS_MAX, HOLIDAYS_MAX_MESSAGE } from "@remote/contracts/api/requests";
import { REQUEST_COMMS_AUDIT } from "@remote/contracts/audit";
import { TR_HOLIDAYS } from "@remote/contracts/holidays-tr";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import {
  hhmmToMinutes,
  isOpen,
  nextOpening,
  OPEN_CALENDAR,
  parseWeek,
  timeZoneUsable,
  weekFromJson,
  weekToJson,
  type Calendar,
} from "./calendar.ts";
import { lockSettings } from "./repo.ts";

const CACHE_MS = 60_000;
const HOLIDAY_UQ = "business_holidays_tenant_id_day_key";

/** Takvim + "bozuk" bayrağı (T12: bozuksa mesai uygulanmaz, SLA NULL). */
export interface TenantCalendar {
  cal: Calendar;
  broken: boolean;
}

interface CalendarLog {
  warn(obj: object, msg: string): void;
}

export interface HoursRow {
  timeZone: string;
  hoursEnabled: boolean;
  businessHours: Prisma.JsonValue;
  afterHoursMode: string;
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const timeKey = (d: Date): string => d.toISOString().slice(11, 16);
const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const timeDate = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** Ayar satırı + tatiller → takvim (saf; geri düşüş `onFallback` ile bildirilir). */
export function buildCalendar(
  row: HoursRow | null,
  holidays: readonly { day: Date; openUntil: Date | null }[],
  onFallback: (reason: string) => void,
): TenantCalendar {
  if (!row) return { cal: OPEN_CALENDAR, broken: false };
  const mode = (row.afterHoursMode === "REJECT" ? "REJECT" : "ACCEPT") as AfterHoursMode;
  let timeZone = row.timeZone;
  let broken = false;
  if (!timeZoneUsable(timeZone)) {
    onFallback("time_zone");
    timeZone = DEFAULT_TIME_ZONE;
    broken = true;
  }
  const week = parseWeek(row.businessHours);
  if (row.hoursEnabled && week === null) {
    onFallback("business_hours");
    broken = true;
  }
  const map = new Map<string, number | null>();
  for (const h of holidays) map.set(dayKey(h.day), h.openUntil ? hhmmToMinutes(timeKey(h.openUntil)) : null);
  return {
    cal: { enabled: row.hoursEnabled && !broken, timeZone, week: week ?? OPEN_CALENDAR.week, holidays: map, afterHoursMode: mode },
    broken,
  };
}

const hoursSelect = { timeZone: true, hoursEnabled: true, businessHours: true, afterHoursMode: true } as const;

export class CalendarCache {
  private readonly byTenant = new Map<string, { at: number; p: Promise<TenantCalendar> }>();
  private readonly db: Db;
  private readonly now: () => number;
  private readonly metrics: Metrics;
  private readonly log: CalendarLog;

  constructor(db: Db, now: () => number, metrics: Metrics, log: CalendarLog) {
    this.db = db;
    this.now = now;
    this.metrics = metrics;
    this.log = log;
  }

  invalidate(tenantId: string): void {
    this.byTenant.delete(tenantId);
  }

  /** Bozuk takvimde çağıran hesap hatası (RangeError) da aynı geri düşüşü kullanır. */
  fallback(tenantId: string, reason: string): void {
    this.metrics.inc("rs_calendar_fallback_total", { tenant: tenantId });
    this.log.warn({ alarm: "calendar_fallback", tenantId, reason }, "mesai takvimi kurulamadı; Europe/Istanbul + SLA yok");
  }

  get(tenantId: string): Promise<TenantCalendar> {
    const hit = this.byTenant.get(tenantId);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.p;
    const p = Promise.all([
      this.db.tenantRequestSettings.findUnique({ where: { tenantId }, select: hoursSelect }),
      this.db.businessHoliday.findMany({ where: { tenantId }, select: { day: true, openUntil: true }, take: HOLIDAYS_MAX }),
    ]).then(([row, hol]) => buildCalendar(row, hol, (reason) => this.fallback(tenantId, reason)));
    p.catch(() => this.byTenant.delete(tenantId));
    this.byTenant.set(tenantId, { at: this.now(), p });
    return p;
  }
}

/** Şu an açık mı + sonraki açılış (bozuk/kapalı takvimde her an açık). Hesap hatası → açık (T12). */
export function openState(tc: TenantCalendar, now: number, onError: () => void): { openNow: boolean; next: number | null } {
  if (tc.broken || !tc.cal.enabled) return { openNow: true, next: now };
  try {
    return { openNow: isOpen(tc.cal, now), next: nextOpening(tc.cal, now) };
  } catch {
    onError();
    return { openNow: true, next: now };
  }
}

export async function publicBusinessHours(cache: CalendarCache, tenantId: string, now: number): Promise<PublicBusinessHours> {
  const tc = await cache.get(tenantId);
  const s = openState(tc, now, () => cache.fallback(tenantId, "range_error"));
  return {
    openNow: s.openNow,
    // Açıkken null: zamana bağlı alan Genel/müşteri ref yanıtlarını ayırt edilebilir kılmasın (AC-168 aynı şekil).
    nextOpeningAt: s.openNow || s.next === null ? null : new Date(s.next).toISOString(),
    afterHoursMode: tc.cal.afterHoursMode,
  };
}

// ------------------------------------------------------------------ ayar/tatil servisi

export interface HoursDeps {
  db: Db;
  cache: CalendarCache;
  now: () => number;
  /** Tembel ayar satırı (P8b `ensureSettings`; tatil sınırı bu satırın kilidi altında sayılır). */
  ensureSettings: (tenantId: string) => Promise<unknown>;
}

const who = (auth: AuthContext, tenantId: string) => ({ tenantId, userId: auth.user.id, username: auth.user.email });

function inputOf(row: HoursRow | null): BusinessHoursInput {
  if (!row) return { enabled: false, timeZone: DEFAULT_TIME_ZONE, afterHoursMode: "ACCEPT", week: weekFromJson(null) };
  return {
    enabled: row.hoursEnabled,
    timeZone: row.timeZone,
    afterHoursMode: row.afterHoursMode === "REJECT" ? "REJECT" : "ACCEPT",
    week: weekFromJson(row.businessHours),
  };
}

async function view(d: HoursDeps, tenantId: string, row: HoursRow | null): Promise<BusinessHoursView> {
  const now = d.now();
  const s = openState(await d.cache.get(tenantId), now, () => d.cache.fallback(tenantId, "range_error"));
  return {
    ...inputOf(row),
    openNow: s.openNow,
    nextOpeningAt: s.next === null ? null : new Date(s.next).toISOString(),
  };
}

/** GET /settings/business-hours (settings.view) — satır yoksa varsayılan (yazma yok). */
export async function getBusinessHours(d: HoursDeps, tenantId: string): Promise<BusinessHoursView> {
  const row = await d.db.tenantRequestSettings.findUnique({ where: { tenantId }, select: hoursSelect });
  return view(d, tenantId, row);
}

/** PUT /settings/business-hours (settings.edit): kilitli satır → güncelle → audit eski→yeni (aynı TX); önbellek geçersiz. */
export async function updateBusinessHours(
  d: HoursDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: BusinessHoursInput,
): Promise<BusinessHoursView> {
  await d.ensureSettings(tenantId);
  const week = weekToJson(input.week);
  await d.db.$transaction(async (tx) => {
    await lockSettings(tx, tenantId);
    const before = await tx.tenantRequestSettings.findUniqueOrThrow({ where: { tenantId }, select: hoursSelect });
    await tx.tenantRequestSettings.update({
      where: { tenantId },
      data: { hoursEnabled: input.enabled, timeZone: input.timeZone, afterHoursMode: input.afterHoursMode, businessHours: week },
      select: { tenantId: true },
    });
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: REQUEST_COMMS_AUDIT.BUSINESS_HOURS_UPDATED,
      entity: "tenant_request_settings",
      entityId: tenantId,
      result: "success",
      oldValue: { ...inputOf(before) },
      newValue: { enabled: input.enabled, timeZone: input.timeZone, afterHoursMode: input.afterHoursMode, week },
    });
  });
  d.cache.invalidate(tenantId);
  return getBusinessHours(d, tenantId);
}

const holidayItem = (r: { id: string; day: Date; name: string; openUntil: Date | null }): HolidayItem => ({
  id: r.id,
  day: dayKey(r.day),
  name: r.name,
  openUntil: r.openUntil ? timeKey(r.openUntil) : null,
});

/** GET /settings/holidays?year= — o yılın günleri, artan. */
export async function listHolidays(d: HoursDeps, tenantId: string, year: number): Promise<HolidayListResponse> {
  const rows = await d.db.businessHoliday.findMany({
    where: { tenantId, day: { gte: dayDate(`${year}-01-01`), lte: dayDate(`${year}-12-31`) } },
    select: { id: true, day: true, name: true, openUntil: true },
    orderBy: { day: "asc" },
    take: HOLIDAYS_MAX,
  });
  return { items: rows.map(holidayItem) };
}

const dayConflict = (): AppError =>
  new AppError("CONFLICT", { message: HOLIDAY_DAY_CONFLICT_MESSAGE, fields: { day: HOLIDAY_DAY_CONFLICT_MESSAGE } });

/** POST /settings/holidays: kilit → sayım (≤ 200) → INSERT (aynı gün → 409) → audit. */
export async function addHoliday(
  d: HoursDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: HolidayInput,
): Promise<HolidayItem> {
  await d.ensureSettings(tenantId);
  const id = newId();
  try {
    await d.db.$transaction(async (tx) => {
      await lockSettings(tx, tenantId);
      if ((await tx.businessHoliday.count({ where: { tenantId } })) >= HOLIDAYS_MAX)
        throw new AppError("CONFLICT", { message: HOLIDAYS_MAX_MESSAGE });
      await tx.businessHoliday.create({
        data: {
          id,
          tenantId,
          day: dayDate(input.day),
          name: input.name,
          openUntil: input.openUntil ? timeDate(input.openUntil) : null,
          createdBy: auth.user.id,
          createdAt: new Date(d.now()),
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: REQUEST_COMMS_AUDIT.HOLIDAY_ADDED,
        entity: "business_holidays",
        entityId: id,
        result: "success",
        newValue: { day: input.day, name: input.name, openUntil: input.openUntil },
      });
    });
  } catch (err) {
    if (conflictIndex(err) === HOLIDAY_UQ) throw dayConflict();
    throw err;
  }
  d.cache.invalidate(tenantId);
  return { id, day: input.day, name: input.name, openUntil: input.openUntil };
}

/** DELETE /settings/holidays/:id — başka tenant'ın / olmayan → 404. */
export async function removeHoliday(d: HoursDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<void> {
  await d.db.$transaction(async (tx) => {
    const row = await tx.businessHoliday.findFirst({
      where: { id, tenantId },
      select: { id: true, day: true, name: true, openUntil: true },
    });
    if (!row) throw new AppError("NOT_FOUND");
    if ((await tx.businessHoliday.deleteMany({ where: { id, tenantId } })).count !== 1) throw new AppError("NOT_FOUND");
    const it = holidayItem(row);
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: REQUEST_COMMS_AUDIT.HOLIDAY_REMOVED,
      entity: "business_holidays",
      entityId: id,
      result: "success",
      oldValue: { day: it.day, name: it.name, openUntil: it.openUntil },
    });
  });
  d.cache.invalidate(tenantId);
}

/** POST /settings/holidays/import-tr: listede olmayan yıl 400; zaten olan günler atlanır; sınır aşılırsa 409 (hiçbiri eklenmez). */
export async function importTrHolidays(
  d: HoursDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  year: number,
): Promise<HolidayImportResponse> {
  const list = TR_HOLIDAYS[year];
  if (!list) throw new AppError("VALIDATION", { fields: { year: "Bu yıl için resmî tatil listesi yok" } });
  await d.ensureSettings(tenantId);
  const out = await d.db.$transaction(async (tx) => {
    await lockSettings(tx, tenantId);
    const existing = await tx.businessHoliday.findMany({ where: { tenantId }, select: { day: true }, take: HOLIDAYS_MAX + 1 });
    const have = new Set(existing.map((r) => dayKey(r.day)));
    const add = list.filter((h) => !have.has(h.day));
    if (existing.length + add.length > HOLIDAYS_MAX) throw new AppError("CONFLICT", { message: HOLIDAYS_MAX_MESSAGE });
    const now = new Date(d.now());
    if (add.length > 0)
      await tx.businessHoliday.createMany({
        data: add.map((h) => ({
          id: newId(),
          tenantId,
          day: dayDate(h.day),
          name: h.name,
          openUntil: h.openUntil ? timeDate(h.openUntil) : null,
          createdBy: auth.user.id,
          createdAt: now,
        })),
      });
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: REQUEST_COMMS_AUDIT.HOLIDAYS_IMPORTED,
      entity: "business_holidays",
      result: "success",
      newValue: { year, added: add.length },
    });
    return { added: add.length, skipped: list.length - add.length };
  });
  d.cache.invalidate(tenantId);
  return out;
}
