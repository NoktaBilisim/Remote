/*
 * LG-3 (mimari-link-gonderme §9): müşteriye gönder diyaloğunun saf mantığı — istemci çağrıları, alıcı ön denetimi,
 * hata eşlemesi ve durum makinesi. Sözleşme tek kaynak `@remote/contracts/api/customer-send`; mesaj metni burada
 * ÜRETİLMEZ (AC-407), yalnız sunucunun `previews` değeri gösterilir.
 */
import {
  emailRecipientSchema,
  type ChannelOption,
  type CustomerSendChannel,
  type CustomerSendOptions,
  type CustomerSendResponse,
  type SendTarget,
} from "@remote/contracts/api/customer-send";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { checkLinkPhone } from "@/lib/notify/send-link";

export const fetchSendOptions = (target: SendTarget) => api<CustomerSendOptions>("POST", "/customer-send/options", { target });

export const postCustomerSend = (target: SendTarget, channel: CustomerSendChannel, to: string) =>
  api<CustomerSendResponse>("POST", "/customer-send", { target, channel, to });

/** Diyalogda seçilebilir kanallar (AC-406): yalnız `available`. Sıra sunucunun sırası. */
export const usableChannels = (o: CustomerSendOptions): CustomerSendChannel[] =>
  o.channels.filter((c) => c.available).map((c) => c.channel);

/** "Kısmi" durum: yetkili ama şu an kullanılamayan kanallar (neden + varsa ayar bağlantısı). */
export const blockedChannels = (o: CustomerSendOptions): ChannelOption[] => o.channels.filter((c) => !c.available);

export const recipientKind = (c: CustomerSendChannel): "email" | "phone" => (c === "EMAIL" ? "email" : "phone");

/** Kanalın ilk önerisi (K1/K3 alanı doldurur, K2'de ilk seçenek). */
export const firstRecipient = (o: CustomerSendOptions, c: CustomerSendChannel): string => o.recipients[recipientKind(c)][0]?.value ?? "";

/** İstemci ön denetimi (AC-409); sunucu son sözü söyler. E-posta → kırpılmış adres, telefon → E.164. */
export function checkRecipient(raw: string, channel: CustomerSendChannel): { to?: string; error?: string } {
  if (channel === "EMAIL") {
    if (!raw.trim()) return { error: t("customerSend.emailRequired") };
    const r = emailRecipientSchema.safeParse(raw);
    return r.success ? { to: r.data } : { error: r.error.issues[0]?.message ?? t("v.email") };
  }
  const chk = checkLinkPhone(raw, channel);
  return chk.e164 ? { to: chk.e164 } : { error: chk.error };
}

/** Satır içi başarı iletisi için maskeli alıcı: `m***@ornek.com`, `+90532***33`. */
export function maskRecipient(to: string): string {
  const at = to.lastIndexOf("@");
  if (at > 0) return `${to.slice(0, 1)}***${to.slice(at)}`;
  return to.length > 7 ? `${to.slice(0, 6)}***${to.slice(-2)}` : "***";
}

export type SendFailure =
  | { kind: "field"; message: string }
  | { kind: "rate"; message: string; retryAfterSec: number }
  | { kind: "message"; message: string; tone: "danger" | "warning" };

/**
 * API hatası → ekran (AC-408, §4.3): 400 `fields.to|phone` alan altında; 429 geri sayım; 409 `CHANNEL_UNAVAILABLE`
 * sabit "kanal kullanılamıyor"; diğer 409 sunucunun sabit durum metni (ör. kod artık geçerli değil); 502 tek genel
 * metin (sağlayıcının ham metni gösterilmez); 403/404 sabit metinler.
 */
export function sendFailure(e: unknown): SendFailure {
  if (!(e instanceof ApiError)) return { kind: "message", message: t("err.network"), tone: "danger" };
  const field = e.fields?.to ?? e.fields?.phone;
  if (e.status === 400 && field) return { kind: "field", message: field };
  if (e.status === 429) return { kind: "rate", message: t("customerSend.rate"), retryAfterSec: Math.max(1, e.retryAfter ?? 60) };
  if (e.status === 409 && e.code === "CHANNEL_UNAVAILABLE")
    return { kind: "message", message: t("customerSend.channelUnavailable"), tone: "warning" };
  if (e.status === 409) return { kind: "message", message: e.message || t("customerSend.gone"), tone: "warning" };
  if (e.status === 502) return { kind: "message", message: t("customerSend.failed"), tone: "danger" };
  if (e.status === 403) return { kind: "message", message: t("customerSend.forbidden"), tone: "danger" };
  if (e.status === 404 || e.status === 410) return { kind: "message", message: t("customerSend.gone"), tone: "warning" };
  return { kind: "message", message: e.message || t("err.generic"), tone: "danger" };
}

/* ---- Durum makinesi (beş durum: loading, empty, error, partial, success) ---- */

export type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** `usableChannels` boşsa ekran "boş" durumunu çizer; `blockedChannels` doluysa "kısmi" not eklenir. */
  | { kind: "ready"; options: CustomerSendOptions };

export type Result = { tone: "success" | "danger" | "warning"; message: string } | null;

export interface SendState {
  load: LoadState;
  channel: CustomerSendChannel | null;
  /** Alıcı değerleri kanal türüne göre ayrı tutulur (WhatsApp ↔ SMS aynı telefonu paylaşır). */
  to: { email: string; phone: string };
  fieldError?: string;
  busy: boolean;
  result: Result;
  /** 429 sonrası gönder düğmesinin açılacağı an (epoch ms). */
  rateUntil: number | null;
}

export type SendAction =
  | { type: "load" }
  | { type: "loaded"; options: CustomerSendOptions }
  | { type: "loadFailed"; message: string }
  | { type: "channel"; channel: CustomerSendChannel }
  | { type: "to"; value: string }
  | { type: "invalid"; message: string }
  | { type: "sending" }
  | { type: "sent"; message: string }
  | { type: "failed"; failure: SendFailure; now: number }
  | { type: "rateOver" };

export const initialSendState: SendState = {
  load: { kind: "loading" },
  channel: null,
  to: { email: "", phone: "" },
  busy: false,
  result: null,
  rateUntil: null,
};

export function sendReducer(s: SendState, a: SendAction): SendState {
  switch (a.type) {
    case "load":
      return { ...initialSendState };
    case "loaded": {
      const channel = usableChannels(a.options)[0] ?? null;
      const to = { email: firstRecipient(a.options, "EMAIL"), phone: firstRecipient(a.options, "WHATSAPP") };
      return { ...s, load: { kind: "ready", options: a.options }, channel, to };
    }
    case "loadFailed":
      return { ...s, load: { kind: "error", message: a.message } };
    case "channel":
      return { ...s, channel: a.channel, fieldError: undefined, result: null };
    case "to":
      if (!s.channel) return s;
      return { ...s, to: { ...s.to, [recipientKind(s.channel)]: a.value }, fieldError: undefined };
    case "invalid":
      return { ...s, fieldError: a.message };
    case "sending":
      return { ...s, busy: true, result: null, fieldError: undefined };
    case "sent": {
      const load =
        s.load.kind === "ready" && s.load.options.remainingSends !== null
          ? { ...s.load, options: { ...s.load.options, remainingSends: Math.max(0, s.load.options.remainingSends - 1) } }
          : s.load;
      return { ...s, busy: false, load, result: { tone: "success", message: a.message } };
    }
    case "failed": {
      const f = a.failure;
      if (f.kind === "field") return { ...s, busy: false, fieldError: f.message };
      if (f.kind === "rate")
        return { ...s, busy: false, rateUntil: a.now + f.retryAfterSec * 1000, result: { tone: "warning", message: f.message } };
      return { ...s, busy: false, result: { tone: f.tone, message: f.message } };
    }
    case "rateOver":
      return { ...s, rateUntil: null };
  }
}

/** Gönder düğmesi açık mı: kanal var, istek sürmüyor, geri sayım yok, K2 hakkı kalmış. */
export function canSend(s: SendState): boolean {
  if (s.load.kind !== "ready" || !s.channel || s.busy || s.rateUntil !== null) return false;
  return s.load.options.remainingSends === null || s.load.options.remainingSends > 0;
}
