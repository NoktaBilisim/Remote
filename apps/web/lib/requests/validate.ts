/*
 * Panel form doğrulaması — kurallar contracts'tan (sunucuyla aynı): rejectMessageSchema (G-E9-12),
 * normalizePhone (E.164), checkTrustedCidr (IPv4 ≥ /16, IPv6 ≥ /32, özel aralık reddi). Sunucu son sözü söyler.
 */
import { checkTrustedCidr, normalizePhone, rejectMessageSchema } from "@remote/contracts/api/requests";

export { normalizePhone };

/** Ret mesajı → normalize değer veya sözleşmenin Türkçe hata mesajı. */
export function checkRejectMessage(raw: string): { value?: string; error?: string } {
  const r = rejectMessageSchema.safeParse(raw);
  return r.success ? { value: r.data } : { error: r.error.issues[0]?.message ?? "Mesaj geçersiz" };
}

/** Güvenilen CIDR → kanonik ağ adresi veya Türkçe hata mesajı. */
export function checkCidr(raw: string): { value?: string; error?: string } {
  const r = checkTrustedCidr(raw);
  return r.ok ? { value: r.cidr } : { error: r.message };
}
