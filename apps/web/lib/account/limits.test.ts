import { describe, expect, it } from "vitest";
import { checkLimits, LIMITS, limitFieldErrors, type LimitValues } from "./limits";

const saved: LimitValues = { sessionTtlMin: 15, maxActiveHours: 4, maxOpenSessions: 3, maxFileMb: 100 };
const raw = (o: Partial<Record<keyof LimitValues, string>> = {}) => ({
  sessionTtlMin: "15",
  maxActiveHours: "4",
  maxOpenSessions: "3",
  maxFileMb: "100",
  ...o,
});

describe("AC-224: Ayarlar > Genel sınırları (istemci şeması contracts'tan)", () => {
  it("AC-224: aralıklar sunucu sınırlarıyla aynı", () => {
    expect(LIMITS).toEqual({
      sessionTtlMin: { min: 15, max: 30 },
      maxActiveHours: { min: 1, max: 8 },
      maxOpenSessions: { min: 1, max: 10 },
      maxFileMb: { min: 1, max: 2048 },
    });
  });

  it("AC-224: sınır değerleri kabul edilir, yalnız değişen alanlar gövdeye girer", () => {
    expect(checkLimits(raw({ sessionTtlMin: "30", maxFileMb: "2048" }), saved)).toEqual({
      body: { sessionTtlMin: 30, maxFileMb: 2048 },
      errors: {},
    });
    expect(checkLimits(raw({ maxActiveHours: " 1 ", maxOpenSessions: "10" }), saved).body).toEqual({
      maxActiveHours: 1,
      maxOpenSessions: 10,
    });
    expect(checkLimits(raw(), saved)).toEqual({ body: {}, errors: {} });
  });

  it("AC-224: aralık dışı, ondalık, harf ve boş değer alan bazlı reddedilir", () => {
    const r = checkLimits(raw({ sessionTtlMin: "14", maxActiveHours: "9", maxOpenSessions: "2.5", maxFileMb: "" }), saved);
    expect(r.body).toBeUndefined();
    expect(r.errors).toEqual({
      sessionTtlMin: "15-30 arası olmalı",
      maxActiveHours: "1-8 arası olmalı",
      maxOpenSessions: "1-10 arası olmalı",
      maxFileMb: "Bu alan gerekli",
    });
    expect(checkLimits(raw({ maxFileMb: "2049" }), saved).errors).toEqual({ maxFileMb: "1-2048 arası olmalı" });
    expect(checkLimits(raw({ maxFileMb: "abc" }), saved).errors).toEqual({ maxFileMb: "1-2048 arası olmalı" });
  });

  it("AC-224: sunucu 400 alan hataları yalnız bu formun alanlarına eşlenir", () => {
    expect(limitFieldErrors({ maxFileMb: "Sunucu reddetti", retentionDays: "x", "smtp.host": "y" })).toEqual({
      maxFileMb: "Sunucu reddetti",
    });
    expect(limitFieldErrors(undefined)).toEqual({});
  });
});
