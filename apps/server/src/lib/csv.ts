// CSV üretimi (mimari-api "Oturum geçmişi (P8)" §5, AC-124, G-16). P8 oturum ve P11 audit CSV'si aynı modülü kullanır.
// Hücre sırası: (1) formül kaçışı, (2) RFC 4180 tırnaklama. Ayraç `;` (tr-TR Excel), satır sonu CRLF, dosya başında BOM.

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";
const CSV_EOL = "\r\n";

/**
 * Excel/LibreOffice'te formül başlatan hücreler: = + - @ TAB CR; baştaki boşluk/NBSP/ideografik boşluktan sonra
 * gelenler ve tam genişlikli ＝＋－＠ varyantları da (S8-1).
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
