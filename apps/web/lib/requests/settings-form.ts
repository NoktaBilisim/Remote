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

type Errors = Record<string, SettingsErrorKey>;
type Parsed = { value: string } | { error: SettingsErrorKey };

/**
 * Liste alanı: boş satırlar atlanır; her satır `parse` ile denetlenir, geçersiz → `${key}.${i}` hatası, tekrar → `dup`.
 * Dolu satır sayısı `max`'ı aşarsa `key` → `maxErr`. Hatalar `errors`'a sırayla eklenir (odak sırası korunur).
 */
function uniqueList(
  raws: string[],
  key: string,
  errors: Errors,
  { parse, dup, max, maxErr }: { parse: (raw: string) => Parsed; dup: SettingsErrorKey; max: number; maxErr: SettingsErrorKey },
): string[] {
  const out: string[] = [];
  raws.forEach((raw, i) => {
    if (!raw.trim()) return;
    const p = parse(raw);
    if ("error" in p) errors[`${key}.${i}`] = p.error;
    else if (out.includes(p.value)) errors[`${key}.${i}`] = dup;
    else out.push(p.value);
  });
  if (raws.filter((r) => r.trim()).length > max) errors[key] = maxErr;
  return out;
}

const hasRowError = (errors: Errors, key: string) => Object.keys(errors).some((k) => k.startsWith(`${key}.`));

const parsePhone = (raw: string): Parsed => {
  const p = normalizePhone(raw);
  return p ? { value: p } : { error: "phone" };
};

const parseEmail = (raw: string): Parsed => {
  const v = raw.trim().toLowerCase();
  return v.length > 254 || !EMAIL_RE.test(v) ? { error: "email" } : { value: v };
};

const parseCidr = (raw: string): Parsed => {
  const c = checkCidr(raw);
  return c.value ? { value: c.value } : { error: `msg:${c.error ?? ""}` };
};

function checkWait(st: SettingsState, errors: Errors): number {
  const w = st.waitMinutes.trim();
  const wait = /^\d{1,3}$/.test(w) ? Number(w) : NaN;
  if (!(wait >= WAIT_MIN && wait <= WAIT_MAX)) errors.waitMinutes = "wait";
  return wait;
}

function checkWhatsapp(st: SettingsState, errors: Errors): string[] {
  const key = "whatsapp.recipients";
  const recipients = uniqueList(st.waRecipients, key, errors, {
    parse: parsePhone,
    dup: "phoneDup",
    max: MAX_RECIPIENTS,
    maxErr: "recipientsMax",
  });
  if (st.waEnabled && recipients.length === 0 && !hasRowError(errors, key)) errors[key] = "recipientsRequired";
  return recipients;
}

/** P10 (AC-151): e-posta alıcıları ≤ 5, tekil (büyük/küçük harf duyarsız), açıkken ≥ 1; SMTP yoksa açılamaz */
function checkEmail(st: SettingsState, email: SupportRequestSettings["email"], errors: Errors): string[] {
  const key = "email.recipients";
  const mails = uniqueList(st.mailRecipients, key, errors, {
    parse: parseEmail,
    dup: "emailDup",
    max: MAX_RECIPIENTS,
    maxErr: "recipientsMax",
  });
  if (st.mailEnabled && !email.smtpConfigured) errors["email.enabled"] = "smtpRequired";
  else if (st.mailEnabled && mails.length === 0 && !hasRowError(errors, key)) errors[key] = "recipientsRequired";
  return mails;
}

export function buildInput(
  st: SettingsState,
  email: SupportRequestSettings["email"],
): { input?: SupportRequestSettingsInput; errors: Record<string, SettingsErrorKey> } {
  const errors: Errors = {};
  const wait = checkWait(st, errors);
  const recipients = checkWhatsapp(st, errors);
  const mails = checkEmail(st, email, errors);
  const cidrs = uniqueList(st.trustedCidrs, "trustedCidrs", errors, {
    parse: parseCidr,
    dup: "cidrDup",
    max: MAX_TRUSTED_CIDRS,
    maxErr: "cidrMax",
  });

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
