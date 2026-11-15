// P19 J4 (AC-263, S-P19-8): `parseCsv` + formül kaçışı tersi — DB'siz.
import { describe, expect, it } from "vitest";
import {
  CSV_RECORD_TOO_LONG,
  CSV_UNCLOSED_QUOTE,
  CsvTooManyRowsError,
  csvCell,
  csvRow,
  csvUnescapeCell,
  parseCsv,
} from "../../src/lib/csv.ts";

const OPTS = { maxRows: 5000, maxRecordChars: 8192 };

describe("AC-263 parseCsv", () => {
  it('AC-263: BOM atılır, `;` ayraç, tırnak/`""`/çok satırlı hücre, fiziksel satır numarası', () => {
    const text = '\uFEFFAd;Not\r\n"A; B";"satır1\r\nsatır2"\r\n\r\nC;"x ""y"""\r\n';
    const r = parseCsv(text, OPTS);
    expect(r.separator).toBe(";");
    expect(r.header?.cells).toEqual(["Ad", "Not"]);
    expect(r.records).toEqual([
      { line: 2, cells: ["A; B", "satır1\r\nsatır2"] },
      { line: 5, cells: ["C", 'x "y"'] },
    ]);
    expect(r.errors).toEqual([]);
  });

  it("AC-263: başlıkta `;` yoksa `,` ayraç; LF ve CR satır sonları", () => {
    const r = parseCsv("Ad,Telefon\nA,1\rB,2", OPTS);
    expect(r.separator).toBe(",");
    expect(r.records.map((x) => [x.line, ...x.cells])).toEqual([
      [2, "A", "1"],
      [3, "B", "2"],
    ]);
  });

  it("AC-263 S-P19-8: kapanmamış tırnak yalnız o satırı hata yapar, sonraki satırlar okunur", () => {
    const r = parseCsv('Ad\n"bozuk\nİyi\n', OPTS);
    expect(r.errors).toEqual([{ line: 2, message: CSV_UNCLOSED_QUOTE }]);
    expect(r.records).toEqual([{ line: 3, cells: ["İyi"] }]);
  });

  it("AC-263 S-P19-8: kayıt > sınır → satır hatası; 5 001 satır → CsvTooManyRowsError", () => {
    const r = parseCsv(`Ad\n${"x".repeat(100)}\nB\n`, { maxRows: 10, maxRecordChars: 50 });
    expect(r.errors).toEqual([{ line: 2, message: CSV_RECORD_TOO_LONG }]);
    expect(r.records).toEqual([{ line: 3, cells: ["B"] }]);
    const big = `Ad\n${Array.from({ length: 5001 }, (_, i) => `F${i}`).join("\n")}`;
    expect(() => parseCsv(big, OPTS)).toThrow(CsvTooManyRowsError);
    expect(parseCsv(`Ad\n${Array.from({ length: 5000 }, (_, i) => `F${i}`).join("\n")}`, OPTS).records).toHaveLength(5000);
  });

  it("AC-263: formül kaçışı gidiş-dönüş (`=HYPERLINK`, `+90…`, `-`, `@`) metin olarak döner; diğer `'` korunur", () => {
    for (const v of ['=HYPERLINK("http://x";"y")', "+905321112233", "-5", "@a", "'zaten", "düz"]) {
      const line = csvRow([v]);
      const back = parseCsv(`Ad\r\n${line}`, OPTS).records[0]?.cells[0] ?? "";
      expect(csvUnescapeCell(back)).toBe(v);
    }
    expect(csvCell("=1+1")).toBe("'=1+1");
  });
});
