// P13a (AC-197): firma veri saklama süresi (gün). Aralık tek kaynaktan: contracts `TENANT_SETTINGS_LIMITS.retentionDays`
// (DB CHECK ile aynı, 90–730; varsayılan 365). Sunucu son sözü söyler: 400 `fields.retentionDays` alana yazılır.
import { TENANT_SETTINGS_LIMITS } from "@remote/contracts/api/tenants";

export const RETENTION_LIMITS = TENANT_SETTINGS_LIMITS.retentionDays;
export const RETENTION_DEFAULT_DAYS = 365;

/** Alan metni → tam sayı gün; boş, ondalık, harf ve aralık dışı reddedilir (mesaj Türkçe, aralığı söyler). */
export function checkRetentionDays(raw: string): { days?: number; error?: string } {
  const v = raw.trim();
  const range = `${RETENTION_LIMITS.min}–${RETENTION_LIMITS.max} gün arasında bir tam sayı girin`;
  if (v === "") return { error: "Saklama süresi gerekli" };
  if (!/^\d+$/.test(v)) return { error: range };
  const n = Number(v);
  if (n < RETENTION_LIMITS.min || n > RETENTION_LIMITS.max) return { error: range };
  return { days: n };
}
