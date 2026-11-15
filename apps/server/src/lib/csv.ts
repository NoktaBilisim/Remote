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

interface CsvRecord {
  /** Kaydın başladığı fiziksel satır (1 = başlık satırı). */
  line: number;
  cells: string[];
}

interface CsvParseResult {
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

/** Tek kaydın okuma durumu (`readRecord` durum makinesi). `curLine`: kaydın bittiği konumdaki fiziksel satır. */
interface RecordState {
  i: number;
  cells: string[];
  cell: string;
  quoted: boolean;
  wasQuoted: boolean;
  curLine: number;
}

type RecordRead = { error: string } | { error: null; end: number; cells: string[]; wasQuoted: boolean; curLine: number };

/** Tırnak içi: `""` → `"`, tek `"` tırnağı kapatır; satır sonu hücreye girer (satır sayacı ilerler). */
function quotedStep(text: string, st: RecordState, c: string): void {
  if (c === '"') {
    if (text[st.i + 1] === '"') {
      st.cell += '"';
      st.i += 2;
    } else {
      st.quoted = false;
      st.i++;
    }
    return;
  }
  if (c === "\n" || (c === "\r" && text[st.i + 1] !== "\n")) st.curLine++;
  st.cell += c;
  st.i++;
}

/** Tırnak dışı tek karakter; `true` → satır sonu (kayıt bitti). */
function plainStep(text: string, separator: string, st: RecordState, c: string): boolean {
  if (c === '"' && st.cell === "" && !st.wasQuoted) {
    st.quoted = true;
    st.wasQuoted = true;
    st.i++;
    return false;
  }
  if (c === separator) {
    st.cells.push(st.cell);
    st.cell = "";
    st.wasQuoted = false;
    st.i++;
    return false;
  }
  if (c === "\r" || c === "\n") {
    st.i += c === "\r" && text[st.i + 1] === "\n" ? 2 : 1;
    st.curLine++;
    return true;
  }
  st.cell += c;
  st.i++;
  return false;
}

/** `start`'tan bir kayıt okur; çok uzun kayıt ya da kapanmamış tırnak → `error`. */
function readRecord(text: string, separator: string, start: number, line: number, maxRecordChars: number): RecordRead {
  const st: RecordState = { i: start, cells: [], cell: "", quoted: false, wasQuoted: false, curLine: line };
  const n = text.length;
  while (st.i < n) {
    if (st.i - start > maxRecordChars) return { error: CSV_RECORD_TOO_LONG };
    const c = text[st.i] as string;
    if (st.quoted) quotedStep(text, st, c);
    else if (plainStep(text, separator, st, c)) break;
  }
  if (st.quoted) return { error: CSV_UNCLOSED_QUOTE };
  st.cells.push(st.cell);
  return { error: null, end: st.i, cells: st.cells, wasQuoted: st.wasQuoted, curLine: st.curLine };
}

/** `from`'dan sonraki ilk fiziksel satır başı (yoksa metin sonu). */
function nextLineStart(text: string, from: number): number {
  const n = text.length;
  let j = from;
  while (j < n && text[j] !== "\n" && text[j] !== "\r") j++;
  if (j < n && text[j] === "\r" && text[j + 1] === "\n") return j + 2;
  return j < n ? j + 1 : n;
}

function pushRecord(out: CsvParseResult, rec: CsvRecord, maxRows: number): void {
  if (out.header === null) {
    out.header = rec;
    return;
  }
  out.records.push(rec);
  if (out.records.length + out.errors.length > maxRows) throw new CsvTooManyRowsError();
}

function failRecord(out: CsvParseResult, startLine: number, message: string, maxRows: number): void {
  if (out.header === null) out.header = { line: startLine, cells: [] };
  else {
    out.errors.push({ line: startLine, message });
    if (out.records.length + out.errors.length > maxRows) throw new CsvTooManyRowsError();
  }
}

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
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const startLine = line;
    const r = readRecord(text, separator, i, line, opts.maxRecordChars);
    if (r.error !== null) {
      failRecord(out, startLine, r.error, opts.maxRows);
      // Kaydın başladığı satırın ardından yeniden başla; satır sayacı o satırın sonuna göre.
      i = nextLineStart(text, i);
      line = startLine + 1;
      continue;
    }
    i = r.end;
    line = r.curLine;
    if (r.cells.length === 1 && r.cells[0] === "" && !r.wasQuoted) continue; // boş satır
    pushRecord(out, { line: startLine, cells: r.cells }, opts.maxRows);
  }
  return out;
}
