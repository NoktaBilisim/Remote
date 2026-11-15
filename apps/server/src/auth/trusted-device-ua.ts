// P27a UA özeti (mimari-p27a §2; AC-333): tam User-Agent saklanmaz, yalnız sabit etiketlerden kurulan kısa özet.
export const UNKNOWN_BROWSER = "Bilinmeyen tarayıcı";
// Sıra önemli: Edge/Opera/Samsung UA'ları "Chrome/", Chrome UA'sı "Safari/" da içerir.
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+ (?:Mobile\/\w+ )?Safari\//, "Safari"],
];
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b|\bMac OS X\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * AC-333: tam UA saklanmaz; yalnız sabit etiketlerden kurulan "Tarayıcı · İşletim sistemi" (≤ 80 karakter, kontrol
 * karakteri yok — DB CHECK). Bağımlılıksız regex; girdi 512 karakterle sınırlanır.
 */
export function uaSummary(ua: string): string {
  const s = ua.slice(0, 512);
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1] ?? UNKNOWN_BROWSER;
  const os = SYSTEMS.find(([re]) => re.test(s))?.[1];
  return os ? `${browser} · ${os}` : browser;
}
