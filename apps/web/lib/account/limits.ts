// P14b (AC-224): Ayarlar > Genel — oturum ve dosya sınırları. Doğrulama tek kaynaktan: contracts
// `updateTenantSettingsInputSchema` (sunucu PUT /settings/tenant ile aynı şema; aralıklar `TENANT_SETTINGS_LIMITS`, DB CHECK ile aynı).
// Sunucu son sözü söyler: 400 `fields.<alan>` ilgili alana yazılır.
import { TENANT_SETTINGS_LIMITS, updateTenantSettingsInputSchema } from "@remote/contracts/api/tenants";

/** Ekrandaki sıra: kod geçerliliği, en uzun oturum, açık oturum sınırı, dosya sınırı. */
export const LIMIT_FIELDS = ["sessionTtlMin", "maxActiveHours", "maxOpenSessions", "maxFileMb"] as const;
export type LimitField = (typeof LIMIT_FIELDS)[number];
export type LimitValues = Record<LimitField, number>;
export type LimitErrors = Partial<Record<LimitField, string>>;

export const LIMITS: Record<LimitField, { min: number; max: number }> = {
  sessionTtlMin: TENANT_SETTINGS_LIMITS.sessionTtlMin,
  maxActiveHours: TENANT_SETTINGS_LIMITS.maxActiveHours,
  maxOpenSessions: TENANT_SETTINGS_LIMITS.maxOpenSessions,
  maxFileMb: TENANT_SETTINGS_LIMITS.maxFileMb,
};

const isLimitField = (k: unknown): k is LimitField => (LIMIT_FIELDS as readonly unknown[]).includes(k);

/**
 * Form metinleri → PUT gövdesi. Boş alan "gerekli"; tam sayı olmayan ya da aralık dışı değer contracts mesajıyla
 * ("15-30 arası olmalı") reddedilir. Yalnız kayıtlı değerden farklı alanlar gövdeye girer (audit'te gereksiz satır yok).
 */
export function checkLimits(raw: Record<LimitField, string>, saved: LimitValues): { body?: Partial<LimitValues>; errors: LimitErrors } {
  const errors: LimitErrors = {};
  const candidate: Record<string, number> = {};
  for (const k of LIMIT_FIELDS) {
    const v = raw[k].trim();
    if (v === "") errors[k] = "Bu alan gerekli";
    else candidate[k] = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  }
  const parsed = updateTenantSettingsInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (isLimitField(k) && !errors[k]) errors[k] = issue.message;
    }
  }
  if (Object.keys(errors).length > 0) return { errors };
  const body: Partial<LimitValues> = {};
  for (const k of LIMIT_FIELDS) if (candidate[k] !== saved[k]) body[k] = candidate[k];
  return { body, errors };
}

/** Sunucu 400 `fields` → yalnız bu formun alanları. */
export function limitFieldErrors(fields: Record<string, string> | undefined): LimitErrors {
  const out: LimitErrors = {};
  for (const [k, v] of Object.entries(fields ?? {})) if (isLimitField(k)) out[k] = v;
  return out;
}
