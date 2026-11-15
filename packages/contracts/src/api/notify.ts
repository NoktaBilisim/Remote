// P19 J3 (mimari-e11 §8c.3, §8c.4, §8c.6; AC-260, 261): müşteriye dış gönderim — bağlantı gönderimi (SMS/WA), durum
// bildirimi kuyruğu (outbox), firma SMS ayarı. Tek kaynak: sunucu, web ve izleme betiği tavanları buradan okur.
import { z } from "zod";
import { phoneSchema } from "./requests.ts";

export const NOTIFY_CHANNELS = ["SMS", "WHATSAPP", "EMAIL"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];
export const NOTIFY_KINDS = ["REQ_ACCEPTED", "REQ_REJECTED", "REQ_EXPIRED"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
/**
 * P27 (mimari-p27 §3.5, §7.1; AC-296, 337): gözetimsiz bildirim türleri. `UNATTENDED_STARTED` oturuma (`session_id`),
 * `UN_*` müşteriye giden güvenlik olayına (`event_id`) bağlıdır; S-P19-12 tavanlarından muaftır (K-P27-8, 14). Ayrı küme:
 * `NotifyKind` talep türleri olarak kalır (talep şablonları/işçi K4'te genişler); outbox `kind` CHECK'i `OUTBOX_KINDS`'tır.
 */
export const UNATTENDED_NOTIFY_KINDS = ["UNATTENDED_STARTED", "UN_CONTACTS_CHANGED", "UN_DEVICE_REGISTERED"] as const;
export type UnattendedNotifyKind = (typeof UNATTENDED_NOTIFY_KINDS)[number];
/** `notification_outbox.kind` (VARCHAR(20) — her ad ≤ 20 karakter) kümesinin tamamı. */
export const OUTBOX_KINDS = [...NOTIFY_KINDS, ...UNATTENDED_NOTIFY_KINDS] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/**
 * S-P19-12 / K-P19-7: kuyruğa almada DB sayımlı tavanlar (aynı TX; yeniden başlatmaya dayanıklı). Alıcı tavanları kanal
 * başına; `rate_limited` satırları sayılmaz. `deploy/ops/remote-watch.sh` `WATCH_NOTIFY_CAPS` varsayılanı tenantPerHour ile aynı.
 */
export const NOTIFY_LIMITS = {
  recipientTenantPerDay: 3,
  recipientGlobalPerDay: 5,
  tenantPerHour: { SMS: 100, WHATSAPP: 60, EMAIL: 100 },
} as const satisfies { recipientTenantPerDay: number; recipientGlobalPerDay: number; tenantPerHour: Record<NotifyChannel, number> };

/** WA müşteri kovası (bellek; personel `WA_LIMITS`'ten ayrı) — S-P19-T1 m.3. */
export const WA_CUSTOMER_LIMITS = { globalPerHour: 600, tenantPerHour: 60, recipientPerHour: 3 } as const;

export const NOTIFY_RATE_SCOPES = ["recipient_tenant", "recipient_global", "tenant_channel", "wa_bucket"] as const;
export type NotifyRateScope = (typeof NOTIFY_RATE_SCOPES)[number];

/** Bağlantı gönderimi: kullanıcı başına SMS + WA toplam (e-postanın 20/sa'sı ayrı), alıcı ve firma kovaları. */
export const SEND_LINK_PER_HOUR = 20;
export const SEND_LINK_RECIPIENT_PER_HOUR = 5;
export const SEND_LINK_TENANT_PER_HOUR = 200;
/** SMS testi: alıcı başına saatte 3 (S-P19-T7). */
export const SMS_TEST_RECIPIENT_PER_HOUR = 3;

// ------------------------------------------------------------------------------------------- servis adresi (S-P19-T5)

export const SERVICE_URL_MAX = 255;
export const SERVICE_URL_MESSAGE = "Adres kullanıcı adı, şifre veya sorgu içeremez; API anahtarını ayrı alana yazın.";
/** `tenant_settings_sms_url_chk` ile aynı küme: köken + yol; `@`, `?`, `#`, boşluk/kontrol karakteri yok. */
const SERVICE_URL_RE = /^https?:\/\/[^@?#\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}/]{1,253}(\/[^@?#\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*)?$/iu;
const UrlCtor = (
  globalThis as unknown as {
    URL: new (u: string) => { hostname: string; href: string; username: string; password: string; protocol: string };
  }
).URL;

/** Kural: ayrışır, http/https, userinfo yok, ham metinde `@ ? #` yok, ≤ 255. Kanonik biçim (sondaki `/` kırpılır) ya da null. */
export function canonicalServiceUrl(v: string): string | null {
  if ([...v].length > SERVICE_URL_MAX || !SERVICE_URL_RE.test(v)) return null;
  try {
    const u = new UrlCtor(v);
    if (u.hostname === "" || u.username !== "" || u.password !== "") return null;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const out = u.href.replace(/\/+$/, "");
    return SERVICE_URL_RE.test(out) && [...out].length <= SERVICE_URL_MAX ? out : null;
  } catch {
    return null;
  }
}

/** S-P19-T5: SMS (tenant + env `SMSPORTAL_URL`) servis adresi; WA sistem adresi aynı kuralı `waServiceUrlSchema` ile uygular. */
export const serviceUrlSchema = z
  .string({ error: SERVICE_URL_MESSAGE })
  .refine((v) => canonicalServiceUrl(v) !== null, SERVICE_URL_MESSAGE)
  .transform((v) => canonicalServiceUrl(v) ?? v);

// ------------------------------------------------------------------------------------------- telefon

export const SMS_TR_ONLY_MESSAGE = "SMS yalnız Türkiye cep numaralarına gönderilir";
/** E.164 `+905xxxxxxxxx` → servis biçimi `5xxxxxxxxx`; yurt içi cep değilse null. */
export function toSmsPhone(e164: string): string | null {
  const m = /^\+90(5\d{9})$/.exec(e164);
  return m?.[1] ?? null;
}

// ------------------------------------------------------------------------------------------- dış nedenler

/** Dışa dönük nedenler — `timeout` yok (S-P19-T7: `unreachable` ile birleşir; ayrım yalnız metrikte). */
export const PUBLIC_SEND_REASONS = ["unreachable", "unauthorized", "http_error", "redirect", "host_not_allowed"] as const;
export type PublicSendReason = (typeof PUBLIC_SEND_REASONS)[number];

export const SEND_FAILED_MESSAGES: Readonly<Record<"SMS" | "WHATSAPP", string>> = {
  SMS: "SMS gönderilemedi. Ayarları kontrol edin ya da daha sonra deneyin.",
  WHATSAPP: "WhatsApp mesajı gönderilemedi. Ayarları kontrol edin ya da daha sonra deneyin.",
};

export const SMS_TEST_REASONS = [...PUBLIC_SEND_REASONS, "unconfigured"] as const;
export type SmsTestReason = (typeof SMS_TEST_REASONS)[number];
export const SMS_TEST_TEXT = "Nokta Destek test SMS'i";
export const SMS_TEST_MESSAGES: Readonly<Record<SmsTestReason | "ok", string>> = {
  ok: "Test SMS'i gönderildi.",
  unconfigured: "SMS servisi yapılandırılmamış ya da kullanılamıyor.",
  unreachable: "SMS servisine ulaşılamadı.",
  unauthorized: "SMS servisi API anahtarını reddetti.",
  http_error: "SMS servisi hata döndürdü.",
  redirect: "SMS servisi hata döndürdü.",
  host_not_allowed: "Bu sunucu adresi kullanılamaz.",
};

// ------------------------------------------------------------------------------------------- bağlantı gönderimi

export const SEND_LINK_CHANNELS = ["SMS", "WHATSAPP"] as const;
export type SendLinkChannel = (typeof SEND_LINK_CHANNELS)[number];

/** POST /sessions/:id/send-link — `link` oturumun kendi bağlantısı olmalı (sunucu token_hash ile doğrular). */
export const sendLinkInputSchema = z.strictObject({
  channel: z.enum(SEND_LINK_CHANNELS),
  phone: phoneSchema,
  link: z.string().min(1).max(500),
});
export type SendLinkInput = z.input<typeof sendLinkInputSchema>;
export interface SendLinkResponse {
  sent: true;
}
/** GET /sessions/:id/send-link/options — `suggestedPhone` yalnız talepten doğan oturumda, kendi teknisyenine. */
export interface SendLinkOptions {
  sms: boolean;
  whatsapp: boolean;
  suggestedPhone: string | null;
}

// ------------------------------------------------------------------------------------------- SMS ayarı

export const SMS_HEADER_MESSAGE = "Başlık en çok 11 karakter: harf, rakam, boşluk, nokta, tire.";
const SMS_HEADER_RE = /^[A-Za-z0-9 .-]{1,11}$/;
export const SMS_API_KEY_MIN = 8;
export const SMS_API_KEY_MAX = 256;
export const SMS_API_KEY_MESSAGE = `API anahtarı ${SMS_API_KEY_MIN}–${SMS_API_KEY_MAX} karakter, boşluksuz yazdırılabilir ASCII olmalı.`;
const SMS_API_KEY_RE = /^[\x21-\x7E]{8,256}$/;
export const SMS_API_KEY_REENTER = "Adres değişti; API anahtarını yeniden girin.";
export const SMS_PORT_MESSAGE = "Canlı ortamda adres https olmalı ve yalnız 443 portunu kullanmalı.";

/**
 * PUT /settings/sms. `url: null` = sistem varsayılanı (`SMSPORTAL_URL`). `apiKey`: yok/`""` → korunur (köken değişmediyse),
 * `null` → silinir, dolu → şifrelenir. Köken değişip anahtar verilmezse 400 `fields.apiKey` = `SMS_API_KEY_REENTER`.
 */
export const smsSettingsInputSchema = z.strictObject({
  url: z.union([z.null(), serviceUrlSchema]),
  header: z.union([z.null(), z.string().trim().regex(SMS_HEADER_RE, SMS_HEADER_MESSAGE)]).transform((v) => (v === "" ? null : v)),
  apiKey: z.union([z.literal(""), z.null(), z.string().regex(SMS_API_KEY_RE, SMS_API_KEY_MESSAGE)]).optional(),
});
export type SmsSettingsInput = z.input<typeof smsSettingsInputSchema>;
export type SmsSettingsData = z.output<typeof smsSettingsInputSchema>;

/** GET/PUT /settings/sms yanıtı. API anahtarı ve sistem varsayılan adresi asla dönmez. */
export interface SmsSettingsView {
  url: string | null;
  /** Sistem varsayılanı (`SMSPORTAL_URL`) tanımlı mı. */
  defaultUrl: boolean;
  header: string | null;
  apiKeySet: boolean;
  /** S-P19-T6: kayıtlı anahtar etkin adresle çözülemiyor (adres değişmiş olabilir) → `usable:false`. */
  keyUnreadable: boolean;
  /** Production + http + genel host (anahtar düz metin gider) → kanal kapalı. */
  insecure: boolean;
  usable: boolean;
  updatedAt: string | null;
}
export const SMS_KEY_UNREADABLE_WARNING = "Kayıtlı API anahtarı okunamıyor (servis adresi değişmiş olabilir). Anahtarı yeniden girin.";

export const smsTestInputSchema = z.strictObject({ phone: phoneSchema });
export interface SmsTestResponse {
  ok: boolean;
  message: string;
  reason: SmsTestReason | null;
}
