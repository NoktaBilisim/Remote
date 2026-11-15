/*
 * Ayarlar > Destek talepleri formu: durum ↔ PUT gövdesi (mimari-api PUT /settings/support-requests).
 * İstemci doğrulaması sunucuyla aynı kural (sunucu son söz; 400 `fields` aynı anahtarlarla forma yansır):
 * waitMinutes 10..120 tam sayı; WhatsApp alıcıları ≤ 5, E.164, tekil, açıkken ≥ 1; güvenilen CIDR ≤ 10, tekil.
 */
import {
  MAX_RECIPIENTS,
  MAX_TRUSTED_CIDRS,
  WAIT_MAX,
  WAIT_MIN,
  type SupportRequestSettings,
  type SupportRequestSettingsInput,
} from "./contract";
import { checkCidr, normalizePhone } from "./validate";
import { SLA_MINUTES_MAX, SLA_MINUTES_MIN, type RequestPriority } from "@remote/contracts/api/requests";

/** P18 (AC-257): SLA dakikası metni → sayı; boş → null (SLA yok / varsayılan); geçersiz → undefined. */
export function parseSlaMinutes(raw: string): number | null | undefined {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d{1,4}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= SLA_MINUTES_MIN && n <= SLA_MINUTES_MAX ? n : undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SettingsState {
  waitMinutes: string;
  trustedCidrs: string[];
  waEnabled: boolean;
  waRecipients: string[];
  /** P10 (AC-151): e-posta kanalı. */
  mailEnabled: boolean;
  mailRecipients: string[];
  /** P15 (AC-239): "Talep kabulünde kabul kodu iste". */
  acceptCode: boolean;
  /** P18 (AC-257): firma varsayılan önceliği ve SLA hedefi (boş = SLA yok). */
  priority: RequestPriority;
  slaMinutes: string;
  /** P19 (AC-259, 261): web talep formu ve müşteriye durum bildirimi kanalları. */
  webForm: boolean;
  notifySms: boolean;
  notifyWa: boolean;
  notifyEmail: boolean;
}

/** Hata anahtarları sunucu `fields` yolu biçiminde: "waitMinutes", "whatsapp.recipients.1", "trustedCidrs.0" … */
/** Hata değeri: i18n anahtarı (`st.err.*`) ya da sözleşmenin hazır Türkçe mesajı (`msg:` önekli). */
export type SettingsErrorKey =
  | "wait"
  | "phone"
  | "phoneDup"
  | "recipientsRequired"
  | "recipientsMax"
  | "cidrDup"
  | "cidrMax"
  | "email"
  | "emailDup"
  | "smtpRequired"
  | "sla"
  | `msg:${string}`;

export const toState = (s: SupportRequestSettings): SettingsState => ({
  waitMinutes: String(s.waitMinutes),
  trustedCidrs: [...s.trustedCidrs],
  waEnabled: s.whatsapp.enabled,
  waRecipients: [...s.whatsapp.recipients],
  mailEnabled: s.email.enabled,
  mailRecipients: [...s.email.recipients],
  acceptCode: s.requireAcceptCode,
  priority: s.defaultPriority ?? "NORMAL",
  slaMinutes: s.defaultSlaMinutes == null ? "" : String(s.defaultSlaMinutes),
  webForm: s.webFormEnabled ?? false,
  notifySms: s.notifySmsEnabled ?? false,
  notifyWa: s.notifyWhatsappEnabled ?? false,
  notifyEmail: s.notifyEmailEnabled ?? false,
});

const norm = (st: SettingsState) =>
  JSON.stringify({
    w: st.waitMinutes.trim(),
    c: st.trustedCidrs.map((x) => x.trim()).filter(Boolean),
    e: st.waEnabled,
    r: st.waRecipients.map((x) => x.trim()).filter(Boolean),
    me: st.mailEnabled,
    mr: st.mailRecipients.map((x) => x.trim().toLowerCase()).filter(Boolean),
    ac: st.acceptCode,
    p: st.priority,
    sla: st.slaMinutes.trim(),
    wf: st.webForm,
    ns: [st.notifySms, st.notifyWa, st.notifyEmail],
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

  const sla = parseSlaMinutes(st.slaMinutes);
  if (sla === undefined) errors.defaultSlaMinutes = "sla";

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      waitMinutes: wait,
      trustedCidrs: cidrs,
      whatsapp: { enabled: st.waEnabled, recipients },
      email: { enabled: st.mailEnabled, recipients: mails },
      requireAcceptCode: st.acceptCode,
      defaultPriority: st.priority,
      defaultSlaMinutes: sla ?? null,
      webFormEnabled: st.webForm,
      notifySmsEnabled: st.notifySms,
      notifyWhatsappEnabled: st.notifyWa,
      notifyEmailEnabled: st.notifyEmail,
    },
  };
}
