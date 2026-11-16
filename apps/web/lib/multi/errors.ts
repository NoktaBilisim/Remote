/*
 * P28c (mimari-p28c §4, §4.1; AC-364, 365, 372): hata kodları → Türkçe metin. Metinler contracts `MULTI_ERROR_MESSAGES` (AC-352
 * metni dahil); 403 `MFA_SETUP_REQUIRED` → "Önce 2FA kurun" (D-PC-2). Gerekçe hatası 400 `VALIDATION` + `fields.reason` (K0 sapma 6).
 */
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import { ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

const MESSAGES: Readonly<Record<string, string>> = MULTI_ERROR_MESSAGES;

/** Bilinen kod → sözleşme metni; 2FA kurulmamış → yönlendirici metin; diğerleri genel eşleme. */
export function multiUiError(e: unknown): UiError {
  if (e instanceof ApiError) {
    if (Object.hasOwn(MESSAGES, e.code)) return { message: MESSAGES[e.code]!, tone: "danger", requestId: e.requestId };
    if (e.code === "MFA_SETUP_REQUIRED") return { message: t("mt.mfaSetup"), tone: "danger" };
  }
  return toUiError(e);
}

/** WS `error{code}` → metin (kontrol/oturum devri, ayrılma). */
export function multiWsMessage(code: string, message: string): string {
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : message;
}

/** Davet/İzle kalıcı olarak açılamaz mı (misafir `multi1` yok / `asked` gözetimsiz oda): düğme pasif + bu metin. */
export function joinBlockedMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  return e.code === "CLIENT_UNSUPPORTED" || e.code === "JOIN_NOT_ALLOWED" ? MESSAGES[e.code]! : null;
}

/** Gerekçe alanı hatası (`fields.reason`). */
export const reasonFieldError = (e: unknown): string | undefined => (e instanceof ApiError ? e.fields?.reason : undefined);

/**
 * "Davet et" baştan pasif mi (V-PC-5, O-PC-5, AC-372): izinli (`asked`) gözetimsiz oda → `JOIN_NOT_ALLOWED`; misafir `multi1`
 * bildirmedi (`guestMulti === false`) → AC-352 metni. `guestMulti` yok (null) = kabul edilmiş misafir yok → engel değil.
 */
export function inviteBlockOf(consentMode: string | null | undefined, guestMulti: boolean | null): string | null {
  if (consentMode === "asked") return MESSAGES.JOIN_NOT_ALLOWED!;
  return guestMulti === false ? MESSAGES.CLIENT_UNSUPPORTED! : null;
}
