/*
 * P14a (AC-215) step-up diyaloğunun saf mantığı (bileşenden ayrı → birim testli): girdi doğrulama (contracts
 * `stepUpInputSchema`), sunucu hatasının diyalog durumuna eşlenmesi ve kalan kurtarma kodu uyarısı.
 * Sapma (backend, implementation.md): hatalı kod 401 değil 400 `fields.code` döner.
 */
import { ApiError, NetworkError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { RECOVERY_CODES_LOW_THRESHOLD, stepUpInputSchema, type StepUpMethod, type StepUpResponse } from "./contract";

type StepUpBody = { method: StepUpMethod; code: string };

/** Alan metni → gönderilecek gövde ya da alan hatası (istek atılmaz). */
export function buildStepUp(method: StepUpMethod, raw: string): { body?: StepUpBody; error?: string } {
  if (raw.trim() === "") return { error: t("v.required") };
  const p = stepUpInputSchema.safeParse({ method, code: raw });
  if (!p.success) return { error: t(method === "TOTP" ? "mfa.v.codeInvalid" : "mfa.v.recoveryInvalid") };
  return { body: p.data };
}

/** Sunucu/ağ hatası → diyalogda gösterilecek metin; `clear` = alan temizlenip yeniden odaklansın (hatalı kod). */
export function stepUpErrorOf(e: unknown, method: StepUpMethod): { message: string; clear: boolean } {
  if (e instanceof NetworkError) return { message: t("err.network"), clear: false };
  if (e instanceof ApiError) {
    if (e.status === 400 && e.fields?.code)
      return { message: t(method === "TOTP" ? "mfa.v.wrongCode" : "mfa.v.wrongRecovery"), clear: true };
    if (e.status === 429 || e.status === 423) {
      const min = e.retryAfter ? Math.max(1, Math.ceil(e.retryAfter / 60)) : null;
      return { message: min ? t("su.locked", { minutes: min }) : t("su.lockedNoTime"), clear: false };
    }
    return { message: e.message || t("err.generic"), clear: false };
  }
  return { message: t("err.generic"), clear: false };
}

/** Kurtarma koduyla doğrulandıysa ve kalan kod eşik veya altındaysa uyarı gösterilir (AC-215/273 telafi kontrolü). */
export const lowRecoveryLeft = (r: Pick<StepUpResponse, "method" | "recoveryCodesLeft">): number | null =>
  r.method === "RECOVERY" && typeof r.recoveryCodesLeft === "number" && r.recoveryCodesLeft <= RECOVERY_CODES_LOW_THRESHOLD
    ? r.recoveryCodesLeft
    : null;
