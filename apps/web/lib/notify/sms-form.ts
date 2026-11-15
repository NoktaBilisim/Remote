/*
 * P19 (AC-260; mimari-e11 §8c.4): SMS ayar formu durumu ↔ PUT gövdesi. Kural tek kaynak: contracts `smsSettingsInputSchema`.
 * Anahtar alanı boş → gönderilmez (korunur); "Anahtarı sil" → `apiKey: null`.
 */
import {
  SERVICE_URL_MESSAGE,
  SMS_API_KEY_MESSAGE,
  SMS_HEADER_MESSAGE,
  smsSettingsInputSchema,
  type SmsSettingsInput,
  type SmsSettingsView,
} from "@remote/contracts/api/notify";

/** Birleşik (union) şema hatası genel "Invalid input" döner → alanın sözleşme mesajı. */
const FIELD_MESSAGES: Record<string, string> = { url: SERVICE_URL_MESSAGE, header: SMS_HEADER_MESSAGE, apiKey: SMS_API_KEY_MESSAGE };

export interface SmsFormState {
  url: string;
  header: string;
  apiKey: string;
  removeKey: boolean;
}

export const smsToState = (v: SmsSettingsView): SmsFormState => ({
  url: v.url ?? "",
  header: v.header ?? "",
  apiKey: "",
  removeKey: false,
});

export const smsDirty = (a: SmsFormState, b: SmsFormState): boolean =>
  a.url.trim() !== b.url.trim() || a.header.trim() !== b.header.trim() || a.apiKey !== "" || a.removeKey !== b.removeKey;

export function buildSmsInput(st: SmsFormState): { input?: SmsSettingsInput; errors: Record<string, string> } {
  const body: SmsSettingsInput = {
    url: st.url.trim() === "" ? null : st.url.trim(),
    header: st.header.trim() === "" ? null : st.header.trim(),
    ...(st.removeKey ? { apiKey: null } : st.apiKey !== "" ? { apiKey: st.apiKey } : {}),
  };
  const r = smsSettingsInputSchema.safeParse(body);
  if (r.success) return { input: body, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? "form");
    errors[k] ??= FIELD_MESSAGES[k] ?? i.message;
  }
  return { errors };
}
