import { describe, expect, it } from "vitest";
import { formatDateTime, formatRemaining, formatSessionCode, formatTime, initials, retryMinutes } from "./format";

describe("format", () => {
  it("oturum kodunu 4+4 gruplar (AC-3)", () => {
    expect(formatSessionCode("48291376")).toBe("4829 1376");
    expect(formatSessionCode("123")).toBe("123");
  });
  it("kalan süreyi dk:sn biçiminde verir, yukarı yuvarlar, negatifte 0:00", () => {
    expect(formatRemaining(14 * 60_000 + 52_000)).toBe("14:52");
    expect(formatRemaining(1_001)).toBe("0:02");
    expect(formatRemaining(-5_000)).toBe("0:00");
    expect(formatRemaining(3_725_000)).toBe("1:02:05");
  });
  it("saatleri Europe/Istanbul'da gösterir", () => {
    expect(formatTime("2026-11-11T11:28:00Z")).toBe("14:28");
    expect(formatDateTime("2026-11-11T21:05:00Z")).toBe("12.11.2026 00:05");
  });
  it("Retry-After dakikası en az 1, yukarı yuvarlanır", () => {
    expect(retryMinutes(878)).toBe(15);
    expect(retryMinutes(1)).toBe(1);
    expect(retryMinutes(undefined)).toBe(1);
  });
  it("baş harfler Türkçe büyük harfle", () => {
    expect(initials("ayşe yılmaz")).toBe("AY");
    expect(initials("ismail Öztürk Kaya")).toBe("İK");
    expect(initials("  ")).toBe("?");
  });
});
