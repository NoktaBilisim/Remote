// Gizli değer üretimi ve karşılaştırmanın tek yeri (mimari §5.1, G-20).
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ulid } from "ulid";

export const newId = (): string => ulid();

/** 256 bit CSPRNG, base64url (43 karakter). Oturum/CSRF token'ı. */
export const newSecretToken = (): string => randomBytes(32).toString("base64url");

export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, küçük harf, dolgusuz. */
export function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

/** tenantRef (AC-129, mimari-e9 §3.1): 10 bayt CSPRNG → 16 karakter `[a-z2-7]` (80 bit). Gizli değil, tahmin edilemez. */
export const newTenantRef = (): string => base32Lower(randomBytes(10));

/** P8c bilgisayar kaydı anahtarı (ADR-0017): `rsb_` + base64url(32 bayt) = 47 karakter, 256 bit. Yalnız SHA-256'sı saklanır. */
export const newBindingKey = (): string => `rsb_${randomBytes(32).toString("base64url")}`;

/** Talep kodu (§13.1): 6 hane, gösterim amaçlı (kapı değil). */
export const newRequestCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Geçici şifre alfabesi: karışan karakterler (0/O, 1/l/I) yok; 56 sembol × 16 ≈ 93 bit. */
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // gitleaks:allow — gizli değil: herkese açık karakter kümesi (generic-api-key yanlış pozitifi, B-P9-1)

/** P9: yeni kullanıcının geçici şifresi (yalnız oluşturma yanıtında döner; ilk girişte değiştirilir). */
export function newTemporaryPassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += TEMP_PASSWORD_ALPHABET[randomInt(0, TEMP_PASSWORD_ALPHABET.length)];
  return out;
}

/** Sabit süreli eşitlik; uzunluk farkı da sızdırılmaz (önce özetlenir). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
