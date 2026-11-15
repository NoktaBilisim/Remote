/*
 * SMTP ayar formu: durum ↔ PUT /settings/tenant `{ smtp }` (AC-79). Doğrulama contracts `smtpSettingsInputSchema` ile
 * (sunucuyla aynı kural; 400 `fields["smtp.<alan>"]` aynı alanlara yansır). Şifre forma geri yazılmaz; boş = kayıtlı
 * şifre korunur. Tüm alanlar boş → `smtp: null` (yapılandırma kaldırılır; çağıran onay ister).
 * B-P10-1: port yalnız `SMTP_ALLOWED_PORTS`. B-P10-5: güvenlik "Yok" iken kullanıcı adı/şifre gönderilmez (alanlar
 * pasif; durumdaki değer korunur, SSL/TLS'e dönülünce geri gelir). "Yok" ile kaydetmek kayıtlı kimliği siler.
 */
import {
  SMTP_ALLOWED_PORTS,
  SMTP_DEFAULT_PORTS,
  SMTP_PORT_MESSAGE,
  smtpSettingsInputSchema,
  type SmtpSecurity,
  type SmtpSettingsInput,
  type SmtpSettingsView,
} from "./contract";

export interface SmtpState {
  host: string;
  port: string;
  security: SmtpSecurity;
  user: string;
  /** Yalnız yeni şifre; kayıtlı şifre asla buraya yazılmaz. */
  password: string;
  fromName: string;
  fromEmail: string;
}

export type SmtpField = "host" | "port" | "security" | "user" | "password" | "fromName" | "fromEmail";
const SMTP_FIELDS: readonly SmtpField[] = ["host", "port", "security", "user", "password", "fromName", "fromEmail"];

export const toSmtpState = (s: SmtpSettingsView | null): SmtpState => ({
  host: s?.host ?? "",
  port: s ? String(s.port) : String(SMTP_DEFAULT_PORTS.STARTTLS),
  security: s?.security ?? "STARTTLS",
  user: s?.user ?? "",
  password: "",
  fromName: s?.fromName ?? "",
  fromEmail: s?.fromEmail ?? "",
});

/** B-P10-5: şifresiz bağlantıda kimlik bilgisi girilemez/gönderilmez. */
export const smtpCredsAllowed = (security: SmtpSecurity): boolean => security !== "NONE";

/** Gönderilecek (etkin) kimlik: "Yok" seçiliyken boş. */
const effectiveCreds = (st: SmtpState): { user: string; password: string } =>
  smtpCredsAllowed(st.security) ? { user: st.user, password: st.password } : { user: "", password: "" };

/**
 * Port seçenekleri: izinli portlar; kayıtlı değer listede yoksa (B-P10-1 öncesi kayıt) "geçersiz" etiketiyle eklenir ki
 * seçim kutusu değeri sessizce değiştirmesin — kaydetmede sözleşme hatası alan altında görünür.
 */
export function smtpPortOptions(current: string, invalidLabel: (port: string) => string): { value: string; label: string }[] {
  const opts = SMTP_ALLOWED_PORTS.map((p) => ({ value: String(p), label: String(p) }));
  const c = current.trim();
  return c && !opts.some((o) => o.value === c) ? [...opts, { value: c, label: invalidLabel(c) }] : opts;
}

const norm = (st: SmtpState) => {
  const c = effectiveCreds(st);
  return JSON.stringify([st.host.trim(), st.port.trim(), st.security, c.user.trim(), c.password, st.fromName.trim(), st.fromEmail.trim()]);
};
export const smtpDirty = (a: SmtpState, b: SmtpState): boolean => norm(a) !== norm(b);

/** Boş form (yapılandırma kaldırılacak): sunucu, kullanıcı, şifre, gönderen alanlarının hepsi boş. */
const smtpEmpty = (st: SmtpState): boolean => {
  const c = effectiveCreds(st);
  return !st.host.trim() && !c.user.trim() && !c.password && !st.fromName.trim() && !st.fromEmail.trim();
};

/**
 * AC-79: güvenlik değişince port önerisi. Port boşsa ya da başka bir güvenliğin önerdiği değerdeyse önerilen porta geçer;
 * kullanıcının seçtiği diğer izinli port (2525) korunur.
 */
export function suggestPort(port: string, next: SmtpSecurity): string {
  const p = port.trim();
  const known = Object.values(SMTP_DEFAULT_PORTS).map(String);
  return p === "" || known.includes(p) ? String(SMTP_DEFAULT_PORTS[next]) : port;
}

/** Durum → `smtp` gövdesi ya da alan hataları (sözleşme mesajları, Türkçe). `null` = kaldır. */
export function buildSmtpInput(st: SmtpState): { input?: SmtpSettingsInput | null; errors: Partial<Record<SmtpField, string>> } {
  if (smtpEmpty(st)) return { input: null, errors: {} };
  const portText = st.port.trim();
  const creds = effectiveCreds(st);
  const body: SmtpSettingsInput = {
    host: st.host,
    port: /^\d{1,5}$/.test(portText) ? Number(portText) : Number.NaN,
    security: st.security,
    user: creds.user,
    fromName: st.fromName,
    fromEmail: st.fromEmail,
    ...(creds.password ? { password: creds.password } : {}),
  };
  const parsed = smtpSettingsInputSchema.safeParse(body);
  if (parsed.success) return { input: body, errors: {} };
  const errors: Partial<Record<SmtpField, string>> = {};
  for (const issue of parsed.error.issues) {
    const k = String(issue.path[0] ?? "") as SmtpField;
    // "Şifre için kullanıcı adı gerekli" sözleşmede `user` yolunda; kullanıcı şifreyi yazmışken alan kullanıcıdır
    if (SMTP_FIELDS.includes(k) && !errors[k]) errors[k] = k === "port" ? SMTP_PORT_MESSAGE : issue.message;
  }
  // superRefine yalnız temel alanlar geçerliyken koşar → aynı kural burada da
  if (creds.password && !creds.user.trim() && !errors.user) errors.user = "Şifre için kullanıcı adı gerekli";
  if (!st.host.trim()) errors.host = "Sunucu adresi gerekli";
  if (!st.fromEmail.trim()) errors.fromEmail = "Gönderen adresi gerekli";
  return { errors };
}

/** Sunucu 400 `fields` → form alanları (`smtp.host` / `host` biçimleri). Eşleşmeyenler `rest`. */
export function smtpServerFields(fields: Record<string, string>): { errors: Partial<Record<SmtpField, string>>; rest: string[] } {
  const errors: Partial<Record<SmtpField, string>> = {};
  const rest: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const key = k.replace(/^smtp\./, "") as SmtpField;
    if (SMTP_FIELDS.includes(key)) errors[key] = v;
    else rest.push(v);
  }
  return { errors, rest };
}
