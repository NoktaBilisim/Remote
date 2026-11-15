// CSV üretimi (mimari-api "Oturum geçmişi (P8)" §5, AC-124, G-16). P8 oturum ve P11 audit CSV'si aynı modülü kullanır.
// Hücre kaçışı P19'da contracts'a taşındı (web hata raporu aynı kaçışı kullanır; mimari-e11 §8c.5). P19 (AC-263):
// `parseCsv` — müşteri içe aktarma ayrıştırıcısı (RFC 4180; S-P19-8 sınırları).

import { CSV_BOM as CSV_BOM_CHAR } from "@remote/contracts/csv";

export { CSV_BOM, CSV_SEPARATOR, csvCell, csvRow, csvUnescapeCell } from "@remote/contracts/csv";

const istanbulFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** `YYYY-MM-DD HH:mm:ss` (Europe/Istanbul); null → boş hücre. */
export function istanbulDateTime(d: Date | null): string {
  return d ? istanbulFmt.format(d) : "";
}

/** Saniye → `HH:MM:SS`; null → boş. */
export function hms(totalSec: number | null): string {
  if (totalSec === null) return "";
  const s = Math.max(0, Math.floor(totalSec));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// ------------------------------------------------------------------ ayrıştırma (P19, AC-263, S-P19-8)

export interface CsvRecord {
  /** Kaydın başladığı fiziksel satır (1 = başlık satırı). */
  line: number;
  cells: string[];
}

export interface CsvParseResult {
  separator: ";" | ",";
  header: CsvRecord | null;
  records: CsvRecord[];
  /** Ayrıştırılamayan kayıtlar (kapanmamış tırnak, çok uzun satır); fiziksel satır numarasıyla. */
  errors: { line: number; message: string }[];
}

export class CsvTooManyRowsError extends Error {
  constructor() {
    super("csv_too_many_rows");
  }
}

export const CSV_UNCLOSED_QUOTE = "Kapanmamış tırnak işareti";
export const CSV_RECORD_TOO_LONG = "Satır çok uzun";

/**
 * RFC 4180 ayrıştırıcı: tırnaklı hücre, `""` kaçışı, çok satırlı hücre; baştaki BOM atılır; ayraç başlık satırında `;`
 * varsa `;`, yoksa `,`. Satır sonu CRLF / LF / CR. Boş satırlar atlanır. Kayıt `maxRecordChars`'ı aşarsa ya da tırnak
 * kapanmadan dosya biterse kayıt hata olur ve ayrıştırma kaydın başladığı satırın SONRAKİ fiziksel satırından sürer
 * (tek bozuk tırnak dosyanın kalanını yutmaz). Veri kaydı (başlık hariç, hatalı kayıtlar dahil) `maxRows`'u aşarsa
 * `CsvTooManyRowsError`. Tırnaksız hücredeki ya da kapanış tırnağından sonraki `"` olduğu gibi alınır (Excel davranışı).
 */
export function parseCsv(input: string, opts: { maxRows: number; maxRecordChars: number }): CsvParseResult {
  const text = input.startsWith(CSV_BOM_CHAR) ? input.slice(1) : input;
  const firstEol = text.search(/[\r\n]/);
  const separator = (firstEol < 0 ? text : text.slice(0, firstEol)).includes(";") ? ";" : ",";
  const out: CsvParseResult = { separator, header: null, records: [], errors: [] };
  const n = text.length;
  let i = 0;
  let line = 1;
  const push = (rec: CsvRecord): void => {
    if (out.header === null) {
      out.header = rec;
      return;
    }
    out.records.push(rec);
    if (out.records.length + out.errors.length > opts.maxRows) throw new CsvTooManyRowsError();
  };
  const fail = (startLine: number, message: string): void => {
    if (out.header === null) out.header = { line: startLine, cells: [] };
    else {
      out.errors.push({ line: startLine, message });
      if (out.records.length + out.errors.length > opts.maxRows) throw new CsvTooManyRowsError();
    }
  };
  /** `from`'dan sonraki ilk fiziksel satır başı (yoksa n). */
  const nextLineStart = (from: number): number => {
    let j = from;
    while (j < n && text[j] !== "\n" && text[j] !== "\r") j++;
    if (j < n && text[j] === "\r" && text[j + 1] === "\n") return j + 2;
    return j < n ? j + 1 : n;
  };

  while (i < n) {
    const start = i;
    const startLine = line;
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    let wasQuoted = false;
    let ok = true;
    let curLine = line;
    while (i < n) {
      if (i - start > opts.maxRecordChars) {
        ok = false;
        fail(startLine, CSV_RECORD_TOO_LONG);
        break;
      }
      const c = text[i] as string;
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else {
            quoted = false;
            i++;
          }
          continue;
        }
        if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) curLine++;
        cell += c;
        i++;
        continue;
      }
      if (c === '"' && cell === "" && !wasQuoted) {
        quoted = true;
        wasQuoted = true;
        i++;
        continue;
      }
      if (c === separator) {
        cells.push(cell);
        cell = "";
        wasQuoted = false;
        i++;
        continue;
      }
      if (c === "\r" || c === "\n") {
        i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
        curLine++;
        break;
      }
      cell += c;
      i++;
    }
    if (ok && quoted) {
      ok = false;
      fail(startLine, CSV_UNCLOSED_QUOTE);
    }
    if (!ok) {
      // Kaydın başladığı satırın ardından yeniden başla; satır sayacı o satırın sonuna göre.
      i = nextLineStart(start);
      line = startLine + 1;
      continue;
    }
    cells.push(cell);
    line = curLine;
    if (cells.length === 1 && cells[0] === "" && !wasQuoted) continue; // boş satır
    push({ line: startLine, cells });
  }
  return out;
}
