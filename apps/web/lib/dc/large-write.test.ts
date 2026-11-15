import { describe, expect, it } from "vitest";
import { DISK_MIN_BYTES, shouldWarnLargeWrite } from "./files";

describe("AC-230: 256 MB üzerine yazma uyarısı (kabul diyaloğu)", () => {
  it("AC-230: eşik 256 MB", () => {
    expect(DISK_MIN_BYTES).toBe(256 * 1024 * 1024);
  });
  it("AC-230: eşik altı ve tam eşik → uyarı yok", () => {
    expect(shouldWarnLargeWrite(1, true)).toBe(false);
    expect(shouldWarnLargeWrite(DISK_MIN_BYTES - 1, true)).toBe(false);
    expect(shouldWarnLargeWrite(DISK_MIN_BYTES, true)).toBe(false);
  });
  it("AC-230: eşik üstü ve diske akış destekli → uyarı", () => {
    expect(shouldWarnLargeWrite(DISK_MIN_BYTES + 1, true)).toBe(true);
    expect(shouldWarnLargeWrite(2048 * 1024 * 1024, true)).toBe(true);
  });
  it("AC-230: diske akış desteklenmiyorsa (kayıt penceresi açılmaz) üzerine yazma uyarısı yok", () => {
    expect(shouldWarnLargeWrite(DISK_MIN_BYTES + 1, false)).toBe(false);
  });
  it("AC-230: varsayılan destek algısı showSaveFilePicker'a bakar", () => {
    const g = globalThis as { showSaveFilePicker?: unknown };
    const prev = g.showSaveFilePicker;
    try {
      delete g.showSaveFilePicker;
      expect(shouldWarnLargeWrite(DISK_MIN_BYTES + 1)).toBe(false);
      g.showSaveFilePicker = () => undefined;
      expect(shouldWarnLargeWrite(DISK_MIN_BYTES + 1)).toBe(true);
    } finally {
      if (prev === undefined) delete g.showSaveFilePicker;
      else g.showSaveFilePicker = prev;
    }
  });
});
