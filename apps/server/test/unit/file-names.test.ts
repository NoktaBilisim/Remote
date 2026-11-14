// Ortak dosya adı fixture'ı (packages/contracts/fixtures/file-names.json; G-06, AC-36, AC-117): web/sunucu ve Go
// istemci (P6 internal/files) aynı sonucu vermeli.
import { readFileSync } from "node:fs";
import { fileNameWarning, isSanitizedFileName, sanitizeFileName } from "@remote/contracts/files";
import { describe, expect, it } from "vitest";

const fx = JSON.parse(readFileSync(new URL("../../../../packages/contracts/fixtures/file-names.json", import.meta.url), "utf8")) as {
  sanitize: { in: string; out: string }[];
  warning: { name: string; warning: string }[];
};

describe("file-names fixture", () => {
  it.each(fx.sanitize.map((c) => [JSON.stringify(c.in).slice(0, 50), c]))("AC-117 sanitize: %s", (_n, c) => {
    const out = sanitizeFileName(c.in);
    expect(out).toBe(c.out);
    expect(isSanitizedFileName(out)).toBe(true); // idempotent + DB CHECK ile uyumlu
  });
  it.each(fx.warning.map((c) => [c.name, c]))("AC-36 uyarı: %s", (_n, c) => {
    expect(fileNameWarning(sanitizeFileName(c.name))).toBe(c.warning);
  });
});

describe("S-P13a-8 audit'te yalnız dosya uzantısı", () => {
  it("S-P13a-8: uzantı küçük harf, ASCII harf/rakam, ≤ 10 karakter; yoksa/uymazsa null", async () => {
    const { fileExtOf } = await import("../../src/signaling/collab.ts");
    const cases: [string, string | null][] = [
      ["rapor.PDF", "pdf"],
      ["arsiv.tar.gz", "gz"],
      ["Ayşe_Yılmaz_maaş.xlsx", "xlsx"],
      ["README", null],
      [".bashrc", null],
      ["dosya.", null],
      ["x.abcdefghijk", null],
      ["x.abcdefghij", "abcdefghij"],
      ["x.ğüş", null],
      ["x.tar-gz", null],
    ];
    for (const [name, ext] of cases) expect(fileExtOf(name), name).toBe(ext);
  });
});
