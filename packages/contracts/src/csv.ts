// CSV hücre kaçışı (mimari-api "Oturum geçmişi (P8)" §5, AC-124, G-16; P19 AC-263 mimari-e11 §8c.5). Tek kaynak:
// sunucu dışa aktarımları ve web'in istemci tarafı CSV'leri (içe aktarma hata raporu) aynı kaçışı kullanır.
// Hücre sırası: (1) formül kaçışı, (2) RFC 4180 tırnaklama. Ayraç `;` (tr-TR Excel), satır sonu CRLF, dosya başında BOM.

export const CSV_BOM = "\uFEFF";
export const CSV_SEPARATOR = ";";
export const CSV_EOL = "\r\n";

/**
 * Excel/LibreOffice'te formül başlatan hücreler: = + - @ TAB CR; baştaki boşluk/NBSP/ideografik boşluktan sonra
 * gelenler ve tam genişlikli \uFF1D\uFF0B\uFF0D\uFF20 varyantları da (S8-1).
 */
const FORMULA_START = /^[\s\u00A0\u3000]*[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;
const NEEDS_QUOTES = /[;"\r\n]/;

/** Tek hücre: önce formül kaçışı (`'` öneki), sonra gerekirse `"…"` içine alma ve `"` → `""`. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Bir satır (CRLF ile biter). Kaçış başlık dahil her hücreye uygulanır. */
export function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(CSV_SEPARATOR) + CSV_EOL;
}

/**
 * P19 (AC-263): formül kaçışının tersi — hücre `'` + formül başlatıcıyla başlıyorsa baştaki TEK `'` atılır
 * (dışa ↔ içe gidiş-dönüş). Diğer `'` ile başlayan hücreler aynen kalır.
 */
export function csvUnescapeCell(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}
