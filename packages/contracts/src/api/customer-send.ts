/*
 * LG (mimari-link-gonderme §4.1): müşteriye bağlantı gönderme — tek diyalog (web `SendToCustomerDialog`), tek uç çifti
 * `POST /api/v1/customer-send/options` + `POST /api/v1/customer-send`. Mesaj metnini yalnız sunucu üretir (AC-407);
 * istemciden yalnız hedef kimliği, kanal ve alıcı gelir. Hata zarfı ve kodlar mevcut kalıptadır (§4.3).
 */
import { z } from "zod";
import { phoneSchema } from "./requests.ts";

export const CUSTOMER_SEND_CHANNELS = ["EMAIL", "WHATSAPP", "SMS"] as const;
export type CustomerSendChannel = (typeof CUSTOMER_SEND_CHANNELS)[number];

export const SEND_TARGET_KINDS = ["SESSION", "UNATTENDED_CODE", "CUSTOMER"] as const;
export type SendTargetKind = (typeof SEND_TARGET_KINDS)[number];

/** K2/K3'te SMS yok (kapsam dışı 3). Mimari r2 (O-LG-3): kayıt kodu yalnız e-postayla gönderilir. */
export const CHANNELS_BY_KIND = {
  SESSION: ["EMAIL", "WHATSAPP", "SMS"],
  UNATTENDED_CODE: ["EMAIL"],
  CUSTOMER: ["EMAIL", "WHATSAPP"],
} as const satisfies Record<SendTargetKind, readonly CustomerSendChannel[]>;

const id26 = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
/** Biçimli (XXXX-XXXX-XXXX-XXXX) ya da düz 16 karakter; sunucu normalize eder (mevcut registerDevice ayrıştırıcısı). */
const regCodeSchema = z.string().min(16).max(19);

export const sendTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("SESSION"), sessionId: id26, link: z.string().min(1).max(500) }),
  z.strictObject({ kind: z.literal("UNATTENDED_CODE"), codeId: id26, code: regCodeSchema }),
  z.strictObject({ kind: z.literal("CUSTOMER"), customerId: id26 }),
]);
export type SendTarget = z.input<typeof sendTargetSchema>;

const EMAIL_INVALID = "Geçerli bir e-posta adresi girin.";
const PHONE_FORMAT = "Telefonu +90… biçiminde girin.";
/** Mevcut contacts / P10 e-posta kuralı (≤ 254, geçerli biçim). */
export const emailRecipientSchema = z.string().trim().max(254, EMAIL_INVALID).pipe(z.email(EMAIL_INVALID));

export const customerSendOptionsInputSchema = z.strictObject({ target: sendTargetSchema });
export type CustomerSendOptionsInput = z.input<typeof customerSendOptionsInputSchema>;

/** `to`: EMAIL → e-posta, WHATSAPP/SMS → E.164. Kanal–alıcı uyumu superRefine ile; hata alanı `to` / `channel` (AC-409). */
export const customerSendInputSchema = z
  .strictObject({
    target: sendTargetSchema,
    channel: z.enum(CUSTOMER_SEND_CHANNELS),
    to: z.string().trim().min(1).max(254),
  })
  .superRefine((v, ctx) => {
    const ok = v.channel === "EMAIL" ? emailRecipientSchema.safeParse(v.to).success : phoneSchema.safeParse(v.to).success;
    if (!ok) ctx.addIssue({ code: "custom", path: ["to"], message: v.channel === "EMAIL" ? EMAIL_INVALID : PHONE_FORMAT });
    if (!(CHANNELS_BY_KIND[v.target.kind] as readonly string[]).includes(v.channel))
      ctx.addIssue({ code: "custom", path: ["channel"], message: "Bu gönderim için kanal desteklenmiyor." });
  });
export type CustomerSendInput = z.input<typeof customerSendInputSchema>;

export const CHANNEL_BLOCKS = ["unconfigured", "insecure_transport", "no_recipient", "sms_tr_only"] as const;
export type ChannelBlock = (typeof CHANNEL_BLOCKS)[number];

export interface ChannelOption {
  channel: CustomerSendChannel;
  /** Yetkisi olmayan kanal listeye hiç girmez (AC-406, 413). */
  available: boolean;
  block: ChannelBlock | null;
  /** Yalnız `settings.view` (WA için Super Admin) varsa: "/settings/smtp" | "/settings/sms" | "/admin/settings/whatsapp". */
  settingsHref: string | null;
}
export interface RecipientChoice {
  /** K2'de seçim yalnız bu listeden yapılır. K1/K3'te öneridir. E-posta ya da E.164. */
  value: string;
  source: "contact" | "customer" | "request";
}
export interface MessagePreview {
  /** Yalnız EMAIL. */
  subject: string | null;
  /** Gönderilecek düz metnin tamamı (AC-407). */
  text: string;
}
export interface CustomerSendOptions {
  kind: SendTargetKind;
  channels: ChannelOption[];
  recipients: { email: RecipientChoice[]; phone: RecipientChoice[] };
  /** true → alıcı serbest yazılamaz (K2, AC-417). */
  recipientsLocked: boolean;
  /** Yalnız `available` kanallar için. */
  previews: Partial<Record<CustomerSendChannel, MessagePreview>>;
  /** K2: kalan gönderim hakkı (3 − sent_count). Diğerleri null. */
  remainingSends: number | null;
}
export interface CustomerSendResponse {
  sent: true;
}
/** AC-420: kayıt kodu başına en çok 3 gönderim (tüm kanallar toplamı). */
export const UNATTENDED_CODE_SENDS_MAX = 3;
