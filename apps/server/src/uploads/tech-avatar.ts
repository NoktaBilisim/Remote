// P15 (AC-236): müşteri ekranında teknisyen avatarı — oturuma bağlı, kısa ömürlü imzalı URL. İmza HMAC-SHA-256,
// anahtar `APP_ENCRYPTION_KEYS`'ten HKDF etiketi `avatar-url` ile türetilir (diğer amaçlardan ayrık). URL'de oturum
// TOKEN'ı değil ULID'i taşınır (token GET yolunda Caddy/pino loguna düşerdi); yetki imzadan + oturum durumundan gelir.
import { TECH_AVATAR_URL_TTL_SEC } from "@remote/contracts/api/sessions";
import type { SecretBox } from "../lib/crypto.ts";
import { safeEqual } from "../lib/ids.ts";

const payload = (sessionId: string, exp: number): string => `${sessionId}\n${exp}`;

export function techAvatarSignedUrl(secrets: SecretBox, sessionId: string, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + TECH_AVATAR_URL_TTL_SEC;
  const sig = secrets.mac("avatar-url", payload(sessionId, exp));
  return `/api/v1/public/sessions/${sessionId}/tech-avatar?exp=${exp}&sig=${sig}`;
}

/** İmza (tüm anahtar sürümleri) + süre: geçmiş ya da TTL'den uzak gelecekteki `exp` reddedilir. */
export function verifyTechAvatarSig(secrets: SecretBox, sessionId: string, expRaw: string, sig: string, nowMs: number): boolean {
  const exp = Number(expRaw);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(exp) || exp < now || exp > now + TECH_AVATAR_URL_TTL_SEC) return false;
  return secrets.macCandidates("avatar-url", payload(sessionId, exp)).some((c) => safeEqual(c, sig));
}
