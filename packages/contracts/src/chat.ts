// Ortak sohbet ilkelleri (mimari-p22 r2 §3.4, §4.2, §4.5, §15.6 S-P22-6). Yaprak modül (yalnız zod): P18 talep sohbeti
// (`api/requests.ts`, `ws-request.ts`) ve P22 oturum sohbeti (`ws-chat.ts`, `api/sessions.ts`) aynı gövde kuralını ve
// gönderen sözlüğünü buradan alır — `api/requests.ts` eski adları yeniden dışa verir (yüzey değişmez). Sunucu ve web
// aydınlatma paragrafı ile eski istemci bildirimini de buradan alır (tek kaynak; metin başka yerde yazılmaz).
import { z } from "zod";

// --- P18'den taşındı (mimari-p22 §4.2: "`requestMessageBodySchema` aynen yeniden kullanılır") ---

export const MESSAGE_SENDERS = ["TECH", "CUSTOMER"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];
/** Gövde: 1..1000 kod noktası, en çok 20 satır (DB `body_chars` CHECK ile aynı). */
export const MESSAGE_BODY_MAX = 1000;
export const MESSAGE_LINES_MAX = 20;

const codePoints = (v: string): number => [...v].length;

/** `String.prototype.isWellFormed()` eşdeğeri (lib ES2023'te yok): eşleşmemiş vekil (surrogate) yok. */
export const isWellFormedText = (v: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v);
/**
 * S-P18-T8: Cc (yalnız `\n` serbest), U+2028/U+2029, Cf (yalnız ZWJ U+200D ve VS16 U+FE0F serbest — emoji); bidi
 * (U+202A–202E, U+2066–2069) Cf olduğu için reddedilir. CGJ/Moğol ayırıcı da yasak (ad kuralıyla aynı).
 */
const UNSAFE_MESSAGE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034F\u180E]/u;
/** İzinli istisnalar (`\n`, ZWJ, VS16) çıkarıldıktan sonra yasak karakter var mı. */
export const hasUnsafeMessageChars = (v: string): boolean => UNSAFE_MESSAGE_CHARS.test(v.replace(/\n|‍|️/gu, ""));
const messageLines = (v: string): number => v.split(/\r\n|\n/).length;

/**
 * Sohbet mesajı gövdesi — talep (WS `request.message`, REST POST) ve oturum (WS `chat.send`) aynı şema: iyi biçimli UTF-16 →
 * `\r\n` → `\n` → NFC → trim → yasak karakter yok → 1..1000 kod noktası → ≤ 20 satır. Ham uzunluk ön sınırı 4.000 UTF-16
 * birimi. Alan adı her yerde `body` kalır (logger `*.body` redaksiyonu, S-P18-T9).
 */
export const chatBodySchema = z
  .string()
  .max(4000, `Mesaj en çok ${MESSAGE_BODY_MAX} karakter olabilir`)
  .refine(isWellFormedText, "Mesaj geçersiz karakter içeriyor")
  .overwrite((v) => v.replace(/\r\n/g, "\n").normalize("NFC").trim())
  .refine((v) => !hasUnsafeMessageChars(v), "Mesaj görünmez veya kontrol karakteri içeremez")
  .refine((v) => codePoints(v) >= 1, "Mesaj boş olamaz")
  .refine((v) => codePoints(v) <= MESSAGE_BODY_MAX, `Mesaj en çok ${MESSAGE_BODY_MAX} karakter olabilir`)
  .refine((v) => messageLines(v) <= MESSAGE_LINES_MAX, `Mesaj en çok ${MESSAGE_LINES_MAX} satır olabilir`);

// --- P22 metinleri (bağlayıcı; değiştirmek yeni aydınlatma sürümü demektir) ---

/**
 * AC-291 (§3.4, r2 S-P22-6): `defaultConsentBody()` içinde "Ekranınız yalnız…" paragrafından sonra gelen sohbet paragrafı.
 * Gün sayısı GÖMÜLMEZ (sha sabit kalsın; `retention_days` değişince yeni sürüm gerekmesin). `GET /settings/consent-text`
 * `chatParagraph` bu sabittir ("Standart sohbet paragrafını ekle").
 */
export const CHAT_CONSENT_PARAGRAPH =
  "Oturum ve destek talebi sırasında yazdığınız sohbet mesajları sunucularımız üzerinden iletilir ve sunucuda şifrelenerek saklanır. " +
  "Sohbet uçtan uca şifreli değildir: hizmeti veren sunucu mesaj içeriğini okuyabilir. " +
  "Canlı ekran görüntüsü ve uzaktan kontrol uçtan uca şifreli iletilir; doğrudan (eşler arası) dosya aktarımı da uçtan uca şifrelidir. " +
  "Firma sunucu üzerinden dosya aktarımı ya da oturum kaydı kullanıyorsa bu dosya ve kayıtlar sunucuda şifrelenerek saklanır " +
  "(oturum kaydı yalnız ayrıca onay verirseniz yapılır). " +
  "Sohbet mesajları firmanın oturum saklama süresi boyunca (süre gün olarak onay ekranında yazılır) saklanır ve oturum kaydı " +
  "anonimleştirilirken silinir; bu ayar kapatılamaz. Sohbete şifre veya kart bilgisi yazmayınız.";

/**
 * K-P22-5: Admin metninde (created_by dolu) paragrafın varlığı bu anahtar cümleyle aranır — güncel gövde (NFC + boşluk
 * tekleştirilmiş) bunu içermiyorsa `chatParagraphMissing = true`.
 */
export const CHAT_CONSENT_KEY_SENTENCE = "Sohbet uçtan uca şifreli değildir";

/** AC-292: onay düğmesinin hemen üstündeki satır (tarayıcı karşılama, web talep formu; Go `ChatRetentionLine` aynı metin). */
export const CHAT_RETENTION_LINE = (days: number): string => `Sohbet mesajları kayıt altına alınır ve ${days} gün saklanır`;

/**
 * K-P22-3 (r2 S-P22-6): belirteçsiz (≤ 0.20.x) misafire konsolun DC `chat` çerçevesiyle gönderdiği TEK sabit bildirim.
 * Kişisel veri / kullanıcı içeriği yok; gönderim fonksiyonu metin parametresi almaz (yalnız bu sabit). DC `CHAT_MAX_CHARS`'a sığar.
 */
export const LEGACY_CHAT_NOTICE =
  "Bu sürümde sohbet kapalıdır. Yazdıklarınız teknisyene gösterilmez ve kaydedilmez; lütfen sohbet için programı güncelleyin.";
