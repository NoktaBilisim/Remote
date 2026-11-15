/*
 * P19 (AC-260; mimari-e11 §8c.3, §8c.8): oturum bağlantısını SMS/WhatsApp ile gönderme — saf yardımcılar.
 * Telefon ön denetimi sunucuyla aynı (contracts `normalizePhone`, SMS'te `toSmsPhone`); sunucu son sözü söyler.
 */
import { normalizePhone } from "@remote/contracts/api/requests";
import {
  SEND_FAILED_MESSAGES,
  SMS_TR_ONLY_MESSAGE,
  toSmsPhone,
  type SendLinkChannel,
  type SendLinkOptions,
} from "@remote/contracts/api/notify";
import { ApiError } from "@/lib/api";

/** Kullanılabilir kanallar (sıra SMS, WhatsApp). */
export const availableChannels = (o: SendLinkOptions): SendLinkChannel[] =>
  (["SMS", "WHATSAPP"] as const).filter((c) => (c === "SMS" ? o.sms : o.whatsapp));

/** Ham telefon → E.164 önizleme ya da alan hatası. */
export function checkLinkPhone(raw: string, channel: SendLinkChannel): { e164?: string; error?: string } {
  if (!raw.trim()) return { error: "Telefon numarası girin" };
  const e164 = normalizePhone(raw);
  if (!e164) return { error: "Telefon numarası geçersiz" };
  if (channel === "SMS" && !toSmsPhone(e164)) return { error: SMS_TR_ONLY_MESSAGE };
  return { e164 };
}

type SendLinkFailure =
  | { kind: "phone"; message: string }
  | { kind: "rate"; message: string; retryAfterSec: number }
  | { kind: "message"; message: string; tone: "danger" | "warning" };

/** API hatası → ekran: 400 `fields.phone`, 429 (geri sayım), 409 `CHANNEL_UNAVAILABLE`/`CONFLICT`, 502 kanal mesajı. */
export function sendLinkFailure(e: unknown, channel: SendLinkChannel, fallback: string): SendLinkFailure {
  if (!(e instanceof ApiError)) return { kind: "message", message: fallback, tone: "danger" };
  if (e.status === 400 && e.fields?.phone) return { kind: "phone", message: e.fields.phone };
  if (e.status === 429) return { kind: "rate", message: e.message, retryAfterSec: Math.max(1, e.retryAfter ?? 60) };
  if (e.status === 502) return { kind: "message", message: SEND_FAILED_MESSAGES[channel], tone: "danger" };
  if (e.status === 409) return { kind: "message", message: e.message || fallback, tone: "warning" };
  return { kind: "message", message: e.message || fallback, tone: "danger" };
}
