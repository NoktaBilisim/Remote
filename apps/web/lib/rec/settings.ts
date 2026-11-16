/*
 * P28e "Oturum kaydı" ayar formunun saf mantığı (mimari-p28e r2 §5 PUT /settings/recording; AC-380, 447; S-P28e-4/8).
 * Gövde katı şema (`putRecordingSettingsInputSchema`): `consentUpdated` / `employeeNoticeAck` YALNIZ ilgili false→true
 * geçişinde `true` gider, `false` asla gönderilmez. Ana anahtar kapanınca gözetimsiz anahtar da kapanır (AC-447).
 */
import {
  putRecordingSettingsInputSchema,
  REC_CONSENT_UPDATED_REQUIRED_MESSAGE,
  REC_EMPLOYEE_NOTICE_REQUIRED_MESSAGE,
  REC_RETENTION_EXCEEDS_MESSAGE,
  type PutRecordingSettingsInput,
  type RecordingSettingsView,
} from "@remote/contracts/api/recording";

export type RecSettingsSaved = Pick<RecordingSettingsView, "enabled" | "retentionDays" | "unattendedEnabled">;
export type RecSettingsField = "enabled" | "retentionDays" | "unattendedEnabled" | "consentUpdated" | "employeeNoticeAck";
export type RecSettingsErrors = Partial<Record<RecSettingsField, string>>;

export interface RecSettingsDraft {
  enabled: boolean;
  days: string;
  unattended: boolean;
  consent: boolean;
  notice: boolean;
}

/** Ana anahtar kapanırsa gözetimsiz de kapanır (UI ve gövde aynı kural). */
export const effectiveUnattended = (d: Pick<RecSettingsDraft, "enabled" | "unattended">) => d.enabled && d.unattended;

export function isDirty(d: RecSettingsDraft, saved: RecSettingsSaved): boolean {
  return d.enabled !== saved.enabled || effectiveUnattended(d) !== saved.unattendedEnabled || d.days.trim() !== String(saved.retentionDays);
}

/** Form → gövde ya da alan hataları (istek gitmez). `maxDays` = firma oturum saklama süresiyle sınırlı üst değer. */
export function buildRecordingBody(
  d: RecSettingsDraft,
  saved: RecSettingsSaved,
  maxDays: number,
): { body?: PutRecordingSettingsInput; errors: RecSettingsErrors } {
  const errors: RecSettingsErrors = {};
  const unattended = effectiveUnattended(d);
  const raw = d.days.trim();
  const body: PutRecordingSettingsInput = {
    enabled: d.enabled,
    retentionDays: /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN,
    unattendedEnabled: unattended,
  };
  if (d.enabled && !saved.enabled) {
    if (d.consent) body.consentUpdated = true;
    else errors.consentUpdated = REC_CONSENT_UPDATED_REQUIRED_MESSAGE;
  }
  if (unattended && !saved.unattendedEnabled) {
    if (d.notice) body.employeeNoticeAck = true;
    else errors.employeeNoticeAck = REC_EMPLOYEE_NOTICE_REQUIRED_MESSAGE;
  }
  const p = putRecordingSettingsInputSchema.safeParse(body);
  if (!p.success)
    for (const i of p.error.issues) {
      const k = i.path[0] as RecSettingsField;
      errors[k] ??= k === "retentionDays" && Number.isNaN(body.retentionDays) ? "Gün sayısı girin" : i.message;
    }
  if (!errors.retentionDays && body.retentionDays > maxDays) errors.retentionDays = REC_RETENTION_EXCEEDS_MESSAGE;
  return Object.keys(errors).length ? { errors } : { body, errors };
}
