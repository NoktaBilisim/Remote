// TOTP 2FA (RFC 6238; SHA-1, 6 hane, 30 sn, ±1 adım) + kurtarma kodları (AC-67, mimari §5.1).
// Sır users.totp_secret_enc'te AES-256-GCM (lib/crypto.ts); tekrar kullanım engeli users.totp_last_step koşullu UPDATE.
// TOTP node:crypto ile (otplib yerine; sapma notu implementation.md P10 — Backend): RFC 6238 Ek B vektörleriyle test edilir.
import { createHmac, randomBytes } from "node:crypto";
import type { SecretBox } from "../lib/crypto.ts";
import { base32Lower, safeEqual } from "../lib/ids.ts";

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = "Nokta Destek";

export function base32Decode(s: string): Buffer {
  const A = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toLowerCase().replace(/=+$/, "")) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error("base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Lower(randomBytes(20)).toUpperCase();

export const stepOf = (unixMs: number): number => Math.floor(unixMs / 1000 / TOTP_STEP_SEC);

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, secret).update(msg).digest();
  const off = (h[h.length - 1] ?? 0) & 0x0f;
  const bin = (((h[off] ?? 0) & 0x7f) << 24) | ((h[off + 1] ?? 0) << 16) | ((h[off + 2] ?? 0) << 8) | (h[off + 3] ?? 0);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Eşleşen adım (t-1, t, t+1) ya da null. Karşılaştırma sabit süreli. */
export function matchTotp(secretB32: string, code: string, nowMs: number): number | null {
  const key = base32Decode(secretB32);
  const t = stepOf(nowMs);
  let found: number | null = null;
  for (const s of [t - 1, t, t + 1]) if (safeEqual(hotp(key, s), code) && found === null) found = s;
  return found;
}

export function otpauthUrl(secretB32: string, account: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Kurtarma kodu `xxxxx-xxxxx` (50 bit). DB'de normalize edilmiş halin HMAC-SHA-256'sı (B-P10-7; anahtar
 * APP_ENCRYPTION_KEYS'ten HKDF ile "recovery-code" amacıyla türetilir) — DB dökümü tek başına çevrimdışı kırmaya yetmez.
 */
export function newRecoveryCode(): string {
  const raw = base32Lower(randomBytes(7)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
export const normalizeRecoveryCode = (c: string): string => c.toLowerCase().replace(/[\s-]/g, "");
export const recoveryCodeHash = (box: SecretBox, c: string): string => box.mac("recovery-code", normalizeRecoveryCode(c));
/** Doğrulama: tüm anahtar sürümleriyle (rotasyon öncesi yazılmış kodlar da eşleşir). */
export const recoveryCodeCandidates = (box: SecretBox, c: string): string[] => box.macCandidates("recovery-code", normalizeRecoveryCode(c));
