// Gizli değer üretimi ve karşılaştırmanın tek yeri (mimari §5.1, G-20).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ulid } from "ulid";

export const newId = (): string => ulid();

/** 256 bit CSPRNG, base64url (43 karakter). Oturum/CSRF token'ı. */
export const newSecretToken = (): string => randomBytes(32).toString("base64url");

export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** Sabit süreli eşitlik; uzunluk farkı da sızdırılmaz (önce özetlenir). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
