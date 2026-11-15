// P27a "Bu cihazı 30 gün hatırla" (mimari-p27a §2, §5; AC-333, AC-335b). K2: çerez değeri üretimi/biçimi/ayrıştırma ve
// gizli değerin özeti. Politika (`rememberAllowed`), `issue` ve `consumeAtLogin` K3'te bu dosyaya eklenir.
// Gizli değer DB'de, logda, audit'te ve yanıt gövdesinde yer almaz; yalnız `Set-Cookie`'de (AC-333).
import { TRUSTED_DEVICE_COOKIE, TRUSTED_DEVICE_COOKIE_VALUE_RE, TRUSTED_DEVICE_DAYS } from "@remote/contracts/api/auth";
import { timingSafeEqual } from "node:crypto";
import { newSecretToken, sha256Hex } from "../lib/ids.ts";

/** Aynı adlı çerezden denenen en çok değer (D-P27a-2: cookie tossing / aynı host'ta başka port gölgelemesi). */
export const TRUSTED_DEVICE_COOKIE_MAX_VALUES = 2;
const TRUSTED_DEVICE_TTL_MS = TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000;

export interface TrustedDeviceCookieValue {
  /** Satır id'si (ULID); gizli değildir. */
  id: string;
  /** 32 bayt base64url (43 karakter); yalnız çerezde. */
  secret: string;
}

/** Yeni gizli değer: `crypto.randomBytes(32)` base64url (43 karakter; AC-333). */
export const newTrustedDeviceSecret = (): string => newSecretToken();

/** DB'ye yazılan tek değer: gizlinin SHA-256 hex'i (küçük harf, 64; DB CHECK ile aynı biçim). */
export const hashTrustedDeviceSecret = (secret: string): string => sha256Hex(secret);

/** Sabit zamanlı karşılaştırma (`timingSafeEqual`): gizlinin özeti satırdaki `token_hash` ile aynı mı. */
export function trustedDeviceSecretMatches(secret: string, tokenHash: string): boolean {
  const a = Buffer.from(hashTrustedDeviceSecret(secret), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

/** Çerez değeri `<id>.<gizli>` (mimari-p27a §5.3). */
export const formatTrustedDeviceCookie = (v: TrustedDeviceCookieValue): string => `${v.id}.${v.secret}`;

/** Biçime uymayan değer `null` ("bilinmeyen": hiçbir satıra dokunulmaz). */
export function parseTrustedDeviceCookie(value: string): TrustedDeviceCookieValue | null {
  const m = TRUSTED_DEVICE_COOKIE_VALUE_RE.exec(value);
  return m?.[1] && m[2] ? { id: m[1], secret: m[2] } : null;
}

/**
 * Ham `Cookie` başlığından aynı addaki değerler, geliş sırasıyla en çok `TRUSTED_DEVICE_COOKIE_MAX_VALUES` tane
 * (`@fastify/cookie` aynı adda yalnız birini verir). Değer ayrıştırılmaz; biçim denetimi `parseTrustedDeviceCookie`.
 */
export function readTrustedDeviceCookies(cookieHeader: string | undefined): string[] {
  if (!cookieHeader) return [];
  const out: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== TRUSTED_DEVICE_COOKIE) continue;
    out.push(part.slice(eq + 1).trim());
    if (out.length === TRUSTED_DEVICE_COOKIE_MAX_VALUES) break;
  }
  return out;
}

/** Sabit bitiş (K-P27a-3): oluşturma + 30 gün; döndürmede değişmez. */
export const trustedDeviceExpiresAt = (createdAt: Date): Date => new Date(createdAt.getTime() + TRUSTED_DEVICE_TTL_MS);

/** Döndürmede `Max-Age`: kalan tam saniye (en az 0). */
export const trustedDeviceRemainingSec = (expiresAt: Date, now: Date): number =>
  Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
