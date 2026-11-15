// P18 H2 — mesai takvimi / SLA saf fonksiyonları (mimari-e11 §8b.2; AC-258, AC-257; S-P18-T12). Tablo testleri: Europe/Istanbul
// (DST yok) ve America/New_York (2026 DST: 8 Mart ileri, 1 Kasım geri).
import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  CALENDAR_SCAN_DAYS,
  isOpen,
  localToUtc,
  nextOpening,
  outsideHoursMessage,
  parseWeek,
  type Calendar,
  type MinuteInterval,
} from "../../src/requests/calendar.ts";
import { buildCalendar } from "../../src/requests/hours.ts";

const iv = (from: string, to: string): MinuteInterval => ({
  from: Number(from.slice(0, 2)) * 60 + Number(from.slice(3)),
  to: Number(to.slice(0, 2)) * 60 + Number(to.slice(3)),
});
const weekdays = (from: string, to: string): MinuteInterval[][] => [0, 1, 2, 3, 4, 5, 6].map((d) => (d < 5 ? [iv(from, to)] : []));
const cal = (o: Partial<Calendar> & { week: MinuteInterval[][] }): Calendar => ({
  enabled: true,
  timeZone: "Europe/Istanbul",
  holidays: new Map(),
  afterHoursMode: "ACCEPT",
  ...o,
});
const T = (iso: string): number => Date.parse(iso);
const Z = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

describe("AC-258 Europe/Istanbul (UTC+3, DST yok)", () => {
  const ist = cal({ week: weekdays("09:00", "18:00") });

  it.each([
    ["Pzt 08:00 kapalı → 09:00", "2026-11-16T05:00:00.000Z", false, "2026-11-16T06:00:00.000Z"],
    ["Pzt 09:00 açık (sınır dahil)", "2026-11-16T06:00:00.000Z", true, "2026-11-16T06:00:00.000Z"],
    ["Pzt 18:00 kapalı (bitiş hariç) → Salı 09:00", "2026-11-16T15:00:00.000Z", false, "2026-11-17T06:00:00.000Z"],
    ["Cuma 20:00 → Pazartesi 09:00", "2026-11-20T17:00:00.000Z", false, "2026-11-23T06:00:00.000Z"],
    ["Cumartesi öğlen → Pazartesi 09:00", "2026-11-21T09:00:00.000Z", false, "2026-11-23T06:00:00.000Z"],
  ])("AC-258 isOpen/nextOpening: %s", (_n, at, open, next) => {
    expect(isOpen(ist, T(at))).toBe(open);
    expect(Z(nextOpening(ist, T(at)))).toBe(next);
  });

  it.each([
    ["aynı gün içinde", "2026-11-16T06:00:00.000Z", 60, "2026-11-16T07:00:00.000Z"],
    ["tam aralık sonu (18:00)", "2026-11-16T06:00:00.000Z", 540, "2026-11-16T15:00:00.000Z"],
    ["Pzt 17:30 + 60 → Salı 09:30", "2026-11-16T14:30:00.000Z", 60, "2026-11-17T06:30:00.000Z"],
    ["Cuma 17:30 + 60 → Pazartesi 09:30", "2026-11-20T14:30:00.000Z", 60, "2026-11-23T06:30:00.000Z"],
    ["kapalıyken başlarsa açılıştan sayar", "2026-11-21T09:00:00.000Z", 30, "2026-11-23T06:30:00.000Z"],
  ])("AC-258 addBusinessMinutes: %s", (_n, start, min, due) => {
    expect(Z(addBusinessMinutes(ist, T(start), min))).toBe(due);
  });

  it("AC-258 tam gün tatil atlanır; arife openUntil 13:00 o günü keser", () => {
    const holiday = cal({ week: weekdays("09:00", "18:00"), holidays: new Map([["2026-11-17", null]]) });
    expect(isOpen(holiday, T("2026-11-17T08:00:00.000Z"))).toBe(false);
    expect(Z(addBusinessMinutes(holiday, T("2026-11-16T14:30:00.000Z"), 60))).toBe("2026-11-18T06:30:00.000Z");
    const arife = cal({ week: weekdays("09:00", "18:00"), holidays: new Map([["2026-11-17", 13 * 60]]) });
    expect(isOpen(arife, T("2026-11-17T09:59:00.000Z"))).toBe(true); // 12:59
    expect(isOpen(arife, T("2026-11-17T10:00:00.000Z"))).toBe(false); // 13:00
    // Salı 12:30 + 60: 30 dk o gün, kalan 30 dk Çarşamba 09:00'dan.
    expect(Z(addBusinessMinutes(arife, T("2026-11-17T09:30:00.000Z"), 60))).toBe("2026-11-18T06:30:00.000Z");
    expect(Z(nextOpening(arife, T("2026-11-17T11:00:00.000Z")))).toBe("2026-11-18T06:00:00.000Z");
  });

  it('AC-258 "24:00" gün sonu: tam gün açık takvim duvar saatiyle aynı; iki aralık (öğle arası)', () => {
    const allDay = cal({ week: [0, 1, 2, 3, 4, 5, 6].map(() => [iv("00:00", "24:00")]) });
    expect(Z(addBusinessMinutes(allDay, T("2026-11-16T20:00:00.000Z"), 600))).toBe("2026-11-17T06:00:00.000Z");
    expect(isOpen(allDay, T("2026-11-16T20:59:59.000Z"))).toBe(true); // 23:59:59 yerel
    const split = cal({ week: [0, 1, 2, 3, 4, 5, 6].map((d) => (d < 5 ? [iv("13:00", "18:00"), iv("09:00", "12:00")] : [])) });
    const w = parseWeek([
      [
        { from: "13:00", to: "18:00" },
        { from: "09:00", to: "12:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(w?.[0]?.map((x) => x.from)).toEqual([540, 780]); // sıra serbest → artan
    expect(Z(addBusinessMinutes(split, T("2026-11-16T08:30:00.000Z"), 60))).toBe("2026-11-16T10:30:00.000Z"); // 11:30 + 30 + 13:00 + 30
  });

  it("AC-258 açık an yoksa nextOpening ve SLA null; 366 gün üst sınırı", () => {
    const never = cal({ week: [[], [], [], [], [], [], []] });
    expect(nextOpening(never, T("2026-11-16T06:00:00.000Z"))).toBeNull();
    expect(addBusinessMinutes(never, T("2026-11-16T06:00:00.000Z"), 5)).toBeNull();
    // 400 günlük tatil: 366. günden sonra açık olsa da tarama durur → null.
    const hol = new Map<string, null>();
    for (let i = 0; i < 400; i++) hol.set(new Date(Date.UTC(2026, 10, 16 + i)).toISOString().slice(0, 10), null);
    const longHoliday = cal({ week: [0, 1, 2, 3, 4, 5, 6].map(() => [iv("09:00", "18:00")]), holidays: hol });
    expect(CALENDAR_SCAN_DAYS).toBe(366);
    expect(nextOpening(longHoliday, T("2026-11-16T06:00:00.000Z"))).toBeNull();
    expect(addBusinessMinutes(longHoliday, T("2026-11-16T06:00:00.000Z"), 5)).toBeNull();
  });

  it("AC-258 takvim kapalıysa her an açık, SLA duvar saati", () => {
    const off = cal({ enabled: false, week: [[], [], [], [], [], [], []] });
    expect(isOpen(off, T("2026-11-21T03:00:00.000Z"))).toBe(true);
    expect(Z(addBusinessMinutes(off, T("2026-11-21T03:00:00.000Z"), 30))).toBe("2026-11-21T03:30:00.000Z");
  });

  it("AC-258 mesai dışı mesajı: gg.aa.yyyy SS:dd (kısaltma); açık an yoksa yalnız ilk cümle", () => {
    expect(outsideHoursMessage(T("2026-11-16T06:00:00.000Z"), "Europe/Istanbul")).toBe(
      "Mesai dışındayız. Sonraki açılış: 16.11.2026 09:00 (GMT+3)",
    );
    expect(outsideHoursMessage(null, "Europe/Istanbul")).toBe("Mesai dışındayız.");
  });
});

describe("AC-258 America/New_York (DST)", () => {
  const ny = (week: MinuteInterval[][]): Calendar => cal({ timeZone: "America/New_York", week });

  it("AC-258 ileri atlama (8 Mart 2026): var olmayan 02:30 sonraki geçerli dakikaya (03:00 EDT) kayar", () => {
    expect(Z(localToUtc("America/New_York", 2026, 3, 8, 150))).toBe("2026-03-08T07:00:00.000Z");
    expect(Z(localToUtc("America/New_York", 2026, 3, 7, 540))).toBe("2026-03-07T14:00:00.000Z"); // EST
    expect(Z(localToUtc("America/New_York", 2026, 3, 9, 540))).toBe("2026-03-09T13:00:00.000Z"); // EDT
  });

  it("AC-258 geri dönüş (1 Kasım 2026): iki kez yaşanan 01:30'da ilk geçiş (EDT)", () => {
    expect(Z(localToUtc("America/New_York", 2026, 11, 1, 90))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("AC-258 addBusinessMinutes DST gününde gerçek dakikayı sayar (01:00–04:00 günü 2 saat)", () => {
    const c = ny([0, 1, 2, 3, 4, 5, 6].map(() => [iv("01:00", "04:00")]));
    // 8 Mart: 01:00 EST (06:00Z) – 04:00 EDT (08:00Z) = 120 dk; kalan 30 dk 9 Mart 01:00 EDT (05:00Z).
    expect(Z(addBusinessMinutes(c, T("2026-03-08T06:00:00.000Z"), 150))).toBe("2026-03-09T05:30:00.000Z");
    // 1 Kasım: 01:00 EDT (05:00Z) – 04:00 EST (09:00Z) = 240 dk.
    expect(Z(addBusinessMinutes(c, T("2026-11-01T05:00:00.000Z"), 240))).toBe("2026-11-01T09:00:00.000Z");
  });

  it("AC-258 nextOpening hafta sonu + saat değişimi: Pazartesi 09:00 EST", () => {
    const c = ny(weekdays("09:00", "17:00"));
    expect(Z(nextOpening(c, T("2026-10-31T12:00:00.000Z")))).toBe("2026-11-02T14:00:00.000Z");
    expect(isOpen(c, T("2026-11-02T13:30:00.000Z"))).toBe(false);
    expect(isOpen(c, T("2026-11-02T14:00:00.000Z"))).toBe(true);
    expect(isOpen(c, T("2026-10-30T13:00:00.000Z"))).toBe(true); // Cuma 09:00 EDT
  });
});

describe("S-P18-T12 takvim kurulamazsa geri düşüş", () => {
  const row = (o: Partial<{ timeZone: string; hoursEnabled: boolean; businessHours: unknown; afterHoursMode: string }>) => ({
    timeZone: "Europe/Istanbul",
    hoursEnabled: true,
    businessHours: [[{ from: "09:00", to: "18:00" }], [], [], [], [], [], []],
    afterHoursMode: "REJECT",
    ...o,
  });

  it("S-P18-T12: bilinmeyen saat dilimi → Europe/Istanbul + bozuk (mesai uygulanmaz) + bildirim", () => {
    const seen: string[] = [];
    const tc = buildCalendar(row({ timeZone: "Mars/Olympus" }) as never, [], (r) => seen.push(r));
    expect(seen).toEqual(["time_zone"]);
    expect(tc.broken).toBe(true);
    expect(tc.cal.timeZone).toBe("Europe/Istanbul");
    expect(tc.cal.enabled).toBe(false);
  });

  it("S-P18-T12: şema dışı business_hours → bozuk; geçerli satır bozuk değil, tatil openUntil okunur", () => {
    const seen: string[] = [];
    expect(buildCalendar(row({ businessHours: { x: 1 } }) as never, [], (r) => seen.push(r)).broken).toBe(true);
    expect(seen).toEqual(["business_hours"]);
    const ok = buildCalendar(
      row({}) as never,
      [{ day: new Date("2026-10-28T00:00:00.000Z"), openUntil: new Date("1970-01-01T13:00:00.000Z") }],
      () => seen.push("x"),
    );
    expect(ok.broken).toBe(false);
    expect(ok.cal.holidays.get("2026-10-28")).toBe(780);
    expect(buildCalendar(null, [], () => undefined).cal.enabled).toBe(false);
  });
});
