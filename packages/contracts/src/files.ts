// Alınan dosya adı güvenliği (G-06, AC-36, AC-117; mimari-protokol §4.2). Tek kural: tarayıcı (web), sunucu
// (`file.meta` → session_files.file_name CHECK) ve Go istemci (`internal/files`) aynı sonucu verir; ortak örnekler
// `fixtures/file-names.json`. Sıra protokoldekiyle birebir; değiştirilirse fixture ve Go eşi birlikte güncellenir.

/** Dosya adı üst sınırı (karakter = Unicode kod noktası; MySQL VARCHAR(255) utf8mb4 ile aynı sayım). */
export const FILE_NAME_MAX = 255;
/** Temizleme sonrası boş kalan ada verilen ad. */
export const FILE_NAME_FALLBACK = "dosya";
/** Uzantı bu uzunluğu (nokta dahil) aşmıyorsa kısaltmada korunur. */
const EXT_KEEP_MAX = 32;

// eslint-disable-next-line no-control-regex -- C0 kontrol karakterleri bilinçli olarak hedefleniyor
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F]|\p{Cf}/gu;
const TRAILING = /[. ]+$/u;
// S-P5-7: Windows CONIN$/CONOUT$ ve üst simge rakamlı COM¹-³/LPT¹-³ adlarını da ayrılmış sayar.
const RESERVED = /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00B9\u00B2\u00B3]|LPT[1-9\u00B9\u00B2\u00B3])$/i;

/**
 * Protokol §4.2/1: son yol bileşeni → yasak karakterler ve Unicode Cf (RTLO dahil) silinir → sondaki nokta/boşluk
 * silinir → Windows ayrılmış adı (uzantılı da) `_` önekli → boşsa `dosya` → ≤ 255 karakter (uzantı korunarak).
 */
export function sanitizeFileName(raw: string): string {
  const parts = raw.split(/[\\/]/);
  let name = (parts[parts.length - 1] ?? "").replace(FORBIDDEN, "").replace(TRAILING, "");
  const stem = name.split(".")[0] ?? "";
  if (RESERVED.test(stem.trimEnd())) name = `_${name}`;
  if (name === "") return FILE_NAME_FALLBACK;
  return truncate(name);
}

function truncate(name: string): string {
  const cps = Array.from(name);
  if (cps.length <= FILE_NAME_MAX) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? Array.from(name.slice(dot)) : [];
  if (ext.length === 0 || ext.length > EXT_KEEP_MAX)
    return cps.slice(0, FILE_NAME_MAX).join("").replace(TRAILING, "") || FILE_NAME_FALLBACK;
  const base = cps
    .slice(0, FILE_NAME_MAX - ext.length)
    .join("")
    .replace(TRAILING, "");
  return `${base}${ext.join("")}`;
}

/** DB CHECK (`session_files.file_name`) ile aynı koşul: temizlenmiş, 1..255 karakter. */
export function isSanitizedFileName(name: string): boolean {
  return name !== "" && sanitizeFileName(name) === name;
}

/** AC-36 (rev.) tehlikeli uzantı listesi — tek sabit; küçük harf, noktasız. S-P5-7 ile genişletildi (betik/kurulum
 * yardımcıları, Office makro eklentileri, kabuk kısayolları ve tarayıcıda açılıp oltalama için kullanılan HTML/SVG/MHT);
 * S6-8 ile yine genişletildi. Go eşi (`apps/agent-win/internal/files`) bu listeyle test ile karşılaştırılır. */
export const DANGEROUS_EXT: ReadonlySet<string> = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "ps1",
  "psm1",
  "vbs",
  "js",
  "wsf",
  "sh",
  "scr",
  "lnk",
  "hta",
  "cpl",
  "msc",
  "jar",
  "dll",
  "com",
  "pif",
  "reg",
  "scf",
  "url",
  "chm",
  "iso",
  "img",
  "vhd",
  "vhdx",
  "appx",
  "msix",
  "appinstaller",
  "application",
  "xll",
  "docm",
  "xlsm",
  "vbe",
  "jse",
  "ws",
  "wsh",
  "msp",
  "mst",
  "inf",
  "ps1xml",
  "psc1",
  "psd1",
  "settingcontent-ms",
  "library-ms",
  "searchconnector-ms",
  "appref-ms",
  "gadget",
  "xbap",
  "xlam",
  "xla",
  "pptm",
  "dotm",
  "html",
  "htm",
  "mht",
  "mhtml",
  "svg",
  // S6-8: OneNote eki, betik bileşenleri, tanılama paketi, internet kısayolu, Access projeleri, Java Web Start, kabin.
  "one",
  "onepkg",
  "wsc",
  "sct",
  "diagcab",
  "website",
  "ade",
  "adp",
  "mde",
  "mshxml",
  "jnlp",
  "cab",
]);

function extensions(name: string): string[] {
  return name.toLowerCase().split(".").slice(1);
}

/** Son uzantı tehlikeli mi (`a.EXE` → true). Ad önce `sanitizeFileName`'den geçirilmiş olmalı. */
export function isDangerousExtension(name: string): boolean {
  const ext = extensions(name).at(-1);
  return ext !== undefined && DANGEROUS_EXT.has(ext);
}

/** Çift uzantı aldatması: tehlikeli son uzantıdan önce uzantı benzeri bir parça (`fatura.pdf.exe`). */
export function isDoubleExtension(name: string): boolean {
  const ext = extensions(name);
  const prev = ext.at(-2);
  return isDangerousExtension(name) && prev !== undefined && /^(?=[a-z0-9]*[a-z])[a-z0-9]{1,5}$/.test(prev);
}

export type FileNameWarning = "none" | "dangerous" | "double_extension";

/** Kabul diyaloğunda gösterilecek uyarı düzeyi (AC-36): çift uzantı ayrıca vurgulanır. */
export function fileNameWarning(name: string): FileNameWarning {
  if (isDoubleExtension(name)) return "double_extension";
  return isDangerousExtension(name) ? "dangerous" : "none";
}
