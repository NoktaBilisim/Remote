/*
 * Ayarlar > Destek talepleri formu: durum ↔ PUT gövdesi (mimari-api PUT /settings/support-requests).
 * İstemci doğrulaması sunucuyla aynı kural (sunucu son söz; 400 `fields` aynı anahtarlarla forma yansır):
 * waitMinutes 10..120 tam sayı; WhatsApp alıcıları ≤ 5, E.164, tekil, açıkken ≥ 1; güvenilen CIDR ≤ 10, tekil.
 */
import { MAX_RECIPIENTS, MAX_TRUSTED_CIDRS, WAIT_MAX, WAIT_MIN, type SupportRequestSettings, type SupportRequestSettingsInput } from "./contract";
import { checkCidr, normalizePhone } from "./validate";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SettingsState {
  waitMinutes: string;
  trustedCidrs: string[];
  waEnabled: boolean;
  waRecipients: string[];
  /** P10 (AC-151): e-posta kanalı. */
  mailEnabled: boolean;
  mailRecipients: string[];
}

/** Hata anahtarları sunucu `fields` yolu biçiminde: "waitMinutes", "whatsapp.recipients.1", "trustedCidrs.0" … */
/** Hata değeri: i18n anahtarı (`st.err.*`) ya da sözleşmenin hazır Türkçe mesajı (`msg:` önekli). */
export type SettingsErrorKey = "wait" | "phone" | "phoneDup" | "recipientsRequired" | "recipientsMax" | "cidrDup" | "cidrMax" | "email" | "emailDup" | "smtpRequired" | `msg:${string}`;

export const toState = (s: SupportRequestSettings): SettingsState => ({
  waitMinutes: String(s.waitMinutes),
  trustedCidrs: [...s.trustedCidrs],
  waEnabled: s.whatsapp.enabled,
  waRecipients: [...s.whatsapp.recipients],
  mailEnabled: s.email.enabled,
  mailRecipients: [...s.email.recipients],
});

const norm = (st: SettingsState) =>
  JSON.stringify({
    w: st.waitMinutes.trim(),
    c: st.trustedCidrs.map((x) => x.trim()).filter(Boolean),
    e: st.waEnabled,
    r: st.waRecipients.map((x) => x.trim()).filter(Boolean),
    me: st.mailEnabled,
    mr: st.mailRecipients.map((x) => x.trim().toLowerCase()).filter(Boolean),
  });

export const isDirty = (a: SettingsState, b: SettingsState): boolean => norm(a) !== norm(b);

export function buildInput(
  st: SettingsState,
  email: SupportRequestSettings["email"],
): { input?: SupportRequestSettingsInput; errors: Record<string, SettingsErrorKey> } {
  const errors: Record<string, SettingsErrorKey> = {};
  const w = st.waitMinutes.trim();
  const wait = /^\d{1,3}$/.test(w) ? Number(w) : NaN;
  if (!(wait >= WAIT_MIN && wait <= WAIT_MAX)) errors.waitMinutes = "wait";

  const recipients: string[] = [];
  st.waRecipients.forEach((raw, i) => {
    if (!raw.trim()) return;
    const p = normalizePhone(raw);
    if (!p) errors[`whatsapp.recipients.${i}`] = "phone";
    else if (recipients.includes(p)) errors[`whatsapp.recipients.${i}`] = "phoneDup";
    else recipients.push(p);
  });
  if (st.waRecipients.filter((r) => r.trim()).length > MAX_RECIPIENTS) errors["whatsapp.recipients"] = "recipientsMax";
  if (st.waEnabled && recipients.length === 0 && !Object.keys(errors).some((k) => k.startsWith("whatsapp.recipients.")))
    errors["whatsapp.recipients"] = "recipientsRequired";

  // P10 (AC-151): e-posta alıcıları ≤ 5, tekil (büyük/küçük harf duyarsız), açıkken ≥ 1; SMTP yoksa açılamaz
  const mails: string[] = [];
  st.mailRecipients.forEach((raw, i) => {
    const v = raw.trim().toLowerCase();
    if (!v) return;
    if (v.length > 254 || !EMAIL_RE.test(v)) errors[`email.recipients.${i}`] = "email";
    else if (mails.includes(v)) errors[`email.recipients.${i}`] = "emailDup";
    else mails.push(v);
  });
  if (st.mailRecipients.filter((r) => r.trim()).length > MAX_RECIPIENTS) errors["email.recipients"] = "recipientsMax";
  if (st.mailEnabled && !email.smtpConfigured) errors["email.enabled"] = "smtpRequired";
  else if (st.mailEnabled && mails.length === 0 && !Object.keys(errors).some((k) => k.startsWith("email.recipients.")))
    errors["email.recipients"] = "recipientsRequired";

  const cidrs: string[] = [];
  st.trustedCidrs.forEach((raw, i) => {
    if (!raw.trim()) return;
    const c = checkCidr(raw);
    if (!c.value) errors[`trustedCidrs.${i}`] = `msg:${c.error ?? ""}`;
    else if (cidrs.includes(c.value)) errors[`trustedCidrs.${i}`] = "cidrDup";
    else cidrs.push(c.value);
  });
  if (st.trustedCidrs.filter((r) => r.trim()).length > MAX_TRUSTED_CIDRS) errors.trustedCidrs = "cidrMax";

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      waitMinutes: wait,
      trustedCidrs: cidrs,
      whatsapp: { enabled: st.waEnabled, recipients },
      email: { enabled: st.mailEnabled, recipients: mails },
    },
  };
}
