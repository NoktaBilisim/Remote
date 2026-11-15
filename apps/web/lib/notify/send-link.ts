/*
 * P19 (AC-260; mimari-e11 §8c.3, §8c.8): telefon ön denetimi — LG-3 müşteriye gönder diyaloğu (`lib/customer-send.ts`).
 * Telefon ön denetimi sunucuyla aynı (contracts `normalizePhone`, SMS'te `toSmsPhone`); sunucu son sözü söyler.
 */
import { normalizePhone } from "@remote/contracts/api/requests";
import { SMS_TR_ONLY_MESSAGE, toSmsPhone, type SendLinkChannel } from "@remote/contracts/api/notify";

/** Ham telefon → E.164 önizleme ya da alan hatası. */
export function checkLinkPhone(raw: string, channel: SendLinkChannel): { e164?: string; error?: string } {
  if (!raw.trim()) return { error: "Telefon numarası girin" };
  const e164 = normalizePhone(raw);
  if (!e164) return { error: "Telefon numarası geçersiz" };
  if (channel === "SMS" && !toSmsPhone(e164)) return { error: SMS_TR_ONLY_MESSAGE };
  return { e164 };
}
