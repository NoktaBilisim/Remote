/*
 * P28b ayar ekranlarının saf mantığı (birim testli): Dosyalar ayarı gövdesi (AC-354), kullanım yüzdesi (AC-362), ClamAV
 * formu (AC-353, 361) ve firma kotası (AC-362, K-P28b-10). Şemalar contracts'tan; burada şema tanımı yok.
 */
import { FILE_MODE_CONSENT_REQUIRED_MESSAGE, type TenantStorageUsage } from "@remote/contracts/api/fsrv";
import { clamavSettingsInputSchema, type ClamavSettingsData } from "@remote/contracts/api/clamav";
import { storageQuotaGbSchema, updateTenantSettingsInputSchema, type UpdateTenantSettingsInput } from "@remote/contracts/api/tenants";

export interface FilesSaved {
  fileServerMode: boolean;
  fileRetentionDays: number;
}
export type FilesErrors = Partial<Record<"fileServerMode" | "consentUpdated" | "fileRetentionDays", string>>;

/**
 * Form → PUT /settings/tenant gövdesi. Yalnız değişen alanlar; `consentUpdated: true` yalnız kapalı → açık geçişte (strict
 * şemada `false` gönderilmez). Onay kutusu işaretsizse istek gitmez.
 */
export function buildFilesBody(
  f: { on: boolean; days: string; consent: boolean },
  saved: FilesSaved,
): { body?: UpdateTenantSettingsInput; errors: FilesErrors } {
  const errors: FilesErrors = {};
  const body: UpdateTenantSettingsInput = {};
  if (f.on !== saved.fileServerMode) {
    body.fileServerMode = f.on;
    if (f.on) {
      if (!f.consent) errors.consentUpdated = FILE_MODE_CONSENT_REQUIRED_MESSAGE;
      else body.consentUpdated = true;
    }
  }
  const raw = f.days.trim();
  if (raw !== String(saved.fileRetentionDays)) body.fileRetentionDays = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const p = updateTenantSettingsInputSchema.safeParse(body);
  if (!p.success)
    for (const i of p.error.issues) {
      const k = i.path[0];
      if (k === "fileRetentionDays" || k === "fileServerMode") errors[k] ??= i.message;
    }
  if (Object.keys(errors).length) return { errors };
  return Object.keys(body).length ? { body, errors } : { errors };
}

/** Kullanım yüzdesi (0..100, tam sayı; kota 0 → 100). */
export const usagePct = (s: TenantStorageUsage): number =>
  s.quotaBytes <= 0 ? 100 : Math.min(100, Math.floor((s.usedBytes / s.quotaBytes) * 100));

export type ClamavErrors = Partial<Record<"host" | "port", string>>;

/** ClamAV formu → gövde ya da alan hataları (istek gitmez). */
export function buildClamav(f: { host: string; port: string }): { body?: ClamavSettingsData; errors: ClamavErrors } {
  const port = /^\d+$/.test(f.port.trim()) ? Number(f.port.trim()) : Number.NaN;
  const p = clamavSettingsInputSchema.safeParse({ host: f.host, port });
  if (p.success) return { body: p.data, errors: {} };
  const errors: ClamavErrors = {};
  for (const i of p.error.issues) {
    const k = i.path[0];
    if (k === "host" || k === "port") errors[k] ??= i.message;
  }
  return { errors };
}

/** Firma kotası alanı (GB) → sayı ya da hata metni. */
export function checkQuotaGb(raw: string): { gb?: number; error?: string } {
  const v = raw.trim();
  const p = storageQuotaGbSchema.safeParse(/^\d+$/.test(v) ? Number(v) : Number.NaN);
  return p.success ? { gb: p.data } : { error: p.error.issues[0]?.message ?? "" };
}
