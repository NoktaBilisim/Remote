/*
 * P29 (mimari-p29 §4.8, §6; AC-486, 490): gözetimsiz cihaz "Sürüm" sütunu rozeti ve sürüm dağılımı şeridinin saf
 * yardımcıları. Metinler contracts'tan (`DEVICE_UPDATE_BADGE_LABELS`, `UPDATE_REASON_LABELS`); burada yalnız birleştirme.
 */
import {
  DEVICE_UPDATE_BADGE_LABELS,
  UPDATE_REASON_LABELS,
  type DeviceUpdateBadge,
  type DeviceVersionsResponse,
  type UpdatePlatform,
} from "./contract";

const hasOwn = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.hasOwn(o, k);

/** Rozet metni: `FAILED` + bilinen neden → "Güncelleme başarısız (bütünlük)"; bilinmeyen/boş neden → yalnız temel metin. */
export function updateBadgeLabel(badge: DeviceUpdateBadge, reason?: string | null): string {
  const base = DEVICE_UPDATE_BADGE_LABELS[badge];
  if (badge !== "FAILED" || !reason || !hasOwn(UPDATE_REASON_LABELS, reason)) return base;
  return `${base} (${UPDATE_REASON_LABELS[reason]})`;
}

/** Hedef sürüm yalnız bekleyen/süren güncellemede anlamlı ("Güncelleme bekliyor → 0.22.1"). */
export function updateTarget(badge: DeviceUpdateBadge, current: string | undefined, target: string | null | undefined): string | null {
  if ((badge !== "PENDING" && badge !== "UPDATING") || !target || target === current) return null;
  return target;
}

export const PLATFORM_LABELS: Readonly<Record<UpdatePlatform, string>> = { windows: "Windows", macos: "macOS", linux: "Linux" };

/** Yayın satırı: hiçbir bileşenin yayını yoksa `null` (kısmi durum: "Yayın bilgisi alınamadı"). */
export function publishedParts(p: DeviceVersionsResponse["published"]): { label: string; version: string | null }[] | null {
  const parts = [
    { key: "service", version: p.service?.version ?? null },
    ...(["windows", "macos", "linux"] as const).map((k) => ({ key: k, version: p.client[k]?.version ?? null })),
  ];
  if (parts.every((x) => x.version === null)) return null;
  return parts.map((x) => ({ label: x.key === "service" ? "Servis" : PLATFORM_LABELS[x.key as UpdatePlatform], version: x.version }));
}

/** Şerit satırları: yeni sürüm önce (sayısal üçlü karşılaştırma, K-P29-4), eşitse platform adına göre. */
export function sortVersionRows<T extends { version: string; platform: string }>(rows: readonly T[]): T[] {
  const n = (v: string) => v.split(".").map(Number);
  return [...rows].sort((a, b) => {
    const x = n(a.version);
    const y = n(b.version);
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return a.platform.localeCompare(b.platform);
  });
}
