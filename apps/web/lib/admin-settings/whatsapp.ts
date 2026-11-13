/*
 * P12b WhatsApp servis adresi (AC-196; docs/mimari-api.md "Yönetim" whatsapp satırları). Tipler ve adres kuralı
 * `@remote/contracts/api/system-settings`'ten (sunucuyla tek kaynak); burada yalnız alan bazlı ön kontrol mesajları.
 * Sunucu son sözü söyler: istemci kontrolü yalnız gereksiz isteği önler; 400 `fields.url` alana yazılır.
 */
import { WA_INSECURE_WARNING, WA_URL_MAX, waServiceUrlSchema, type WhatsappAdminTestInput, type WhatsappAdminTestResponse, type WhatsappSettingsInput, type WhatsappSettingsView } from "@remote/contracts/api/system-settings";
import { normalizePhone } from "@/lib/requests/validate";

/** GET/PUT/DELETE yanıtı: `url` etkin adres (panel kaydı, yoksa env; ikisi de yoksa null). */
export type WhatsappServiceView = WhatsappSettingsView;
export type WhatsappServiceInput = WhatsappSettingsInput;
export type WhatsappServiceTestInput = WhatsappAdminTestInput;
export type WhatsappServiceTestResponse = WhatsappAdminTestResponse;

export const WA_SERVICE_URL_MAX = WA_URL_MAX;
/** AC-196 ekran metni (sözleşme sabiti); arayüz bunu ilk cümle olarak gösterir. */
export { WA_INSECURE_WARNING };
export const WA_URL_MESSAGES = {
  required: "Servis adresi gerekli",
  max: `Adres en çok ${WA_SERVICE_URL_MAX} karakter olabilir`,
  scheme: "Adres http:// veya https:// ile başlamalı",
  chars: "Adreste boşluk, @, ? veya # olamaz",
  invalid: "Geçerli bir adres girin (ör. https://wa.ornek.com:3000)",
} as const;
export const WA_PHONE_MESSAGES = { required: "Telefon numarası gerekli", invalid: "Telefon numarası geçersiz" } as const;

/** Sondaki `/` kırpılır (sunucu da kırpar) → kirli karşılaştırması ve gönderim aynı biçimde. */
export const normalizeWaUrl = (raw: string): string => raw.trim().replace(/\/+$/, "");

/** İstemci ön kontrolü: http/https, kullanıcı:şifre / sorgu / parça / boşluk yok, ≤ 200. */
export function checkWaUrl(raw: string): { url?: string; error?: string } {
  const v = normalizeWaUrl(raw);
  if (v === "") return { error: WA_URL_MESSAGES.required };
  if (v.length > WA_SERVICE_URL_MAX) return { error: WA_URL_MESSAGES.max };
  if (!/^https?:\/\//i.test(v)) return { error: WA_URL_MESSAGES.scheme };
  if (/[\s@?#]/.test(v)) return { error: WA_URL_MESSAGES.chars };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { error: WA_URL_MESSAGES.invalid };
  }
  if (!u.hostname || u.username || u.password) return { error: WA_URL_MESSAGES.invalid };
  // Son kapı: sunucu/DB kuralı (contracts) — harf duyarlı şema, kontrol karakterleri vb.
  const parsed = waServiceUrlSchema.safeParse(v);
  return parsed.success ? { url: parsed.data } : { error: WA_URL_MESSAGES.invalid };
}

/** Formda gösterilecek değer: yalnız panel kaydı (env adresi alana yazılmaz; ayrıca "Etkin adres" olarak görünür). */
export const waFieldValue = (v: WhatsappServiceView): string => (v.source === "panel" && v.url ? v.url : "");

export const waDirty = (field: string, saved: WhatsappServiceView): boolean => normalizeWaUrl(field) !== waFieldValue(saved);

/** Sunucu `fields` → `url` alan hatası + alana bağlanamayanlar (form üstü). */
export function waServerFields(fields: Record<string, string>, key: "url" | "phoneNumber"): { error?: string; rest: string[] } {
  let error: string | undefined;
  const rest: string[] = [];
  for (const [k, msg] of Object.entries(fields)) {
    if (k === key && !error) error = msg;
    else rest.push(msg);
  }
  return { error, rest };
}

/** Test numarası: TR (0/+90 önekli 5xx) veya E.164 → `+…`; sunucu servise `90…` biçiminde iletir. */
export function checkTestPhone(raw: string): { phoneNumber?: string; error?: string } {
  if (raw.trim() === "") return { error: WA_PHONE_MESSAGES.required };
  const n = normalizePhone(raw);
  return n ? { phoneNumber: n } : { error: WA_PHONE_MESSAGES.invalid };
}
