// P18 (mimari-e11 §8b.2; AC-258): Türkiye resmî tatil listesi — dış API yok, yıllık sabit liste. "Resmî tatilleri ekle (yıl)"
// düğmesi bu listeden ekler (zaten olan günler atlanır). Dini bayram tarihleri Diyanet takvimindendir; liste her yıl kod
// güncellemesiyle uzatılır (runbook yıllık kontrol maddesi). Arifeler yarım gün: `openUntil: "13:00"`.

export interface TrHoliday {
  /** Yerel gün `YYYY-MM-DD`. */
  day: string;
  name: string;
  /** null = tam gün kapalı; dolu = o gün bu saate kadar açık. */
  openUntil: string | null;
}

const fixed = (y: number): TrHoliday[] => [
  { day: `${y}-01-01`, name: "Yılbaşı", openUntil: null },
  { day: `${y}-04-23`, name: "Ulusal Egemenlik ve Çocuk Bayramı", openUntil: null },
  { day: `${y}-05-01`, name: "Emek ve Dayanışma Günü", openUntil: null },
  { day: `${y}-05-19`, name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", openUntil: null },
  { day: `${y}-07-15`, name: "Demokrasi ve Millî Birlik Günü", openUntil: null },
  { day: `${y}-08-30`, name: "Zafer Bayramı", openUntil: null },
  { day: `${y}-10-28`, name: "Cumhuriyet Bayramı arifesi", openUntil: "13:00" },
  { day: `${y}-10-29`, name: "Cumhuriyet Bayramı", openUntil: null },
];

const religious = (ramazanArife: string, ramazan: string[], kurbanArife: string, kurban: string[]): TrHoliday[] => [
  { day: ramazanArife, name: "Ramazan Bayramı arifesi", openUntil: "13:00" },
  ...ramazan.map((day, i) => ({ day, name: `Ramazan Bayramı ${i + 1}. gün`, openUntil: null })),
  { day: kurbanArife, name: "Kurban Bayramı arifesi", openUntil: "13:00" },
  ...kurban.map((day, i) => ({ day, name: `Kurban Bayramı ${i + 1}. gün`, openUntil: null })),
];

/** Gün başına tek satır (DB UQ(tenant_id, day)): çakışan günler (ör. 2027-05-19 = 19 Mayıs + Kurban 4. gün) adları birleşir, tam gün kapalı kazanır. */
function sorted(list: TrHoliday[]): readonly TrHoliday[] {
  const byDay = new Map<string, TrHoliday>();
  for (const h of list) {
    const prev = byDay.get(h.day);
    byDay.set(
      h.day,
      prev
        ? {
            day: h.day,
            name: `${prev.name} / ${h.name}`.slice(0, 100),
            openUntil: prev.openUntil === null || h.openUntil === null ? null : prev.openUntil,
          }
        : h,
    );
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export const TR_HOLIDAYS: Readonly<Record<number, readonly TrHoliday[]>> = {
  2026: sorted([
    ...fixed(2026),
    ...religious("2026-03-19", ["2026-03-20", "2026-03-21", "2026-03-22"], "2026-05-26", [
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
    ]),
  ]),
  2027: sorted([
    ...fixed(2027),
    ...religious("2027-03-08", ["2027-03-09", "2027-03-10", "2027-03-11"], "2027-05-15", [
      "2027-05-16",
      "2027-05-17",
      "2027-05-18",
      "2027-05-19",
    ]),
  ]),
};

/** Listesi olan yıllar (içe aktarma ucu yalnız bunları kabul eder). */
export const TR_HOLIDAY_YEARS: readonly number[] = Object.keys(TR_HOLIDAYS).map(Number);
