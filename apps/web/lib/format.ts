/*
 * Arayüz biçimlendirme yardımcıları (ham toFixed / Date string'i yerine).
 * Saatler Europe/Istanbul'da gösterilir (sunucu ve tarayıcı saat diliminden bağımsız).
 */

import { t } from "@/lib/i18n";

const TZ = "Europe/Istanbul";

/** 8 haneli oturum kodu → "4829 1376" (AC-3). Biçimsiz değer olduğu gibi döner. */
export function formatSessionCode(code: string): string {
  return /^\d{8}$/.test(code) ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/** Kalan süre (ms) → "14:52" (dk:sn); 1 saati aşarsa "1:02:05". Negatif → "0:00". */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const timeFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const timeSecFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO → "14:28" */
export function formatTime(iso: string | number | Date): string {
  return timeFmt.format(new Date(iso));
}

/** ISO → "14:28:05" */
export function formatTimeSeconds(iso: string | number | Date): string {
  return timeSecFmt.format(new Date(iso));
}

/** ISO → "11.11.2026 14:28" */
export function formatDateTime(iso: string | number | Date): string {
  return dateTimeFmt.format(new Date(iso));
}

/** Retry-After (sn) → en az 1, yukarı yuvarlanmış dakika. */
export function retryMinutes(seconds: number | undefined): number {
  return Math.max(1, Math.ceil((seconds ?? 60) / 60));
}

/** Ad soyad → en çok 2 baş harf ("Ayşe Yılmaz" → "AY"), Türkçe büyük harf. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => (p ?? "").charAt(0).toLocaleUpperCase("tr-TR")).join("") || "?";
}

const num = (d: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** Sayı (tr-TR, ondalık virgül). */
export function formatNumber(n: number, digits = 0): string {
  return num(digits).format(n);
}

/** Bayt → "12,5 MB" (1024 tabanı; AC-53 sınır metniyle aynı birim). */
export function formatBytes(b: number): string {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${num(i === 0 ? 0 : 1).format(v)} ${u[i]}`;
}

/** Süre (sn) → "45 sn", "12 dk 5 sn", "1 sa 2 dk" (oturum geçmişi, P8). */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return t("h.dur.hm", { h, m });
  if (m > 0) return t("h.dur.ms", { m, s: s % 60 });
  return t("h.dur.s", { s });
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Europe/Istanbul takvim günü "YYYY-MM-DD" (tarih filtresinin üst sınırı; sunucu da bu günü kullanır). */
export function istanbulDay(at: number | Date = Date.now()): string {
  return dayFmt.format(at);
}

/**
 * P18 (AC-258): firmanın mesai saat diliminde "11.11.2026 14:28 (GMT+3)" — sonraki açılış önizlemesi. Geçersiz dilimde
 * Europe/Istanbul.
 */
export function formatDateTimeInZone(iso: string | number | Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("tr-TR", { ...opts, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("tr-TR", { ...opts, timeZone: TZ }).format(new Date(iso));
  }
}

/** "YYYY-MM-DD" yerel gün → "1 Ocak 2026 Perşembe" (gün adı takvimden; saat dilimi kayması yok). */
export function formatDayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(
    new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)),
  );
}
