import { describe, expect, it } from "vitest";
import { titleWithCount } from "./requests/panel-socket";
import { applyTitle, composeTitle, getTitleParts, setTitlePart, stripPrefixes, subscribeTitleParts } from "./tab-title";

// AC-308 (mimari-lobi §6.6): lobi ve talep önekleri tek yazıcıda birleşir, birbirini silmez.
const BASE = "Taban";
const P = "/sessions";

describe("sekme başlığı (AC-308)", () => {
  it("gizli sekme + 1 bekleyen → lobi öneki", () => {
    expect(applyTitle(BASE, { lobby: 1, requests: 0 }, P)).toBe("(1) Müşteri bekliyor — Taban");
  });
  it("görünür sekme (lobi parçası 0) → önek yok, eski başlık geri gelir", () => {
    expect(applyTitle("(1) Müşteri bekliyor — Taban", { lobby: 0, requests: 0 }, P)).toBe(BASE);
  });
  it("lobi + talep → önce lobi, sonra talep", () => {
    expect(applyTitle(BASE, { lobby: 1, requests: 3 }, P)).toBe("(1) Müşteri bekliyor — (3) Taban");
    expect(composeTitle(BASE, { lobby: 0, requests: 3 })).toBe("(3) Taban");
  });
  it("iki kez uygulama idempotent; sayı değişince önek güncellenir", () => {
    const once = applyTitle(BASE, { lobby: 2, requests: 3 }, P);
    expect(applyTitle(once, { lobby: 2, requests: 3 }, P)).toBe(once);
    expect(applyTitle(once, { lobby: 1, requests: 0 }, P)).toBe("(1) Müşteri bekliyor — Taban");
  });
  it("strip her iki öneki temizler; yalnız talep öneki de silinir", () => {
    expect(stripPrefixes("(2) Müşteri bekliyor — (5) Talepler · Nokta")).toBe("Talepler · Nokta");
    expect(stripPrefixes("(5) Talepler · Nokta")).toBe("Talepler · Nokta");
    expect(stripPrefixes("Talepler · Nokta")).toBe("Talepler · Nokta");
  });
  it("/console yolunda başlığa dokunulmaz (konsolun kendi sohbet öneki korunur)", () => {
    expect(applyTitle("(2) Konsol: Ayşe", { lobby: 1, requests: 3 }, `/sessions/01JSES0000000000000000000A/console`)).toBe("(2) Konsol: Ayşe");
  });
  it("titleWithCount (P8b-1) davranışı değişmedi", () => {
    expect(titleWithCount("Talepler · Nokta", 3)).toBe("(3) Talepler · Nokta");
  });
  it("depo: aynı değer abonelere bildirilmez, farklı değer bildirilir", () => {
    let calls = 0;
    const off = subscribeTitleParts(() => calls++);
    setTitlePart("lobby", 2);
    setTitlePart("lobby", 2);
    expect(getTitleParts().lobby).toBe(2);
    setTitlePart("lobby", 0);
    off();
    expect(calls).toBe(2);
  });
});
