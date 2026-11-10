// Destek oturumu gizli değerleri (AC-1, AC-2, AC-3; ADR-0006, G-22).
// Token: 32 bayt CSPRNG base64url (DB'de yalnız SHA-256). Kod: 8 hane, yalnız PENDING iken, global tekil.
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { newSecretToken, safeEqual } from "../lib/ids.ts";

const ACTIVE_CODE_INDEX = "support_sessions_active_code_key";

export const newSessionToken = (): string => newSecretToken();
export const newSessionCode = (): string => String(randomInt(0, 100_000_000)).padStart(8, "0");
export const newTechVerifyCode = (): string => String(randomInt(0, 10_000)).padStart(4, "0");

/** Env'de anahtar yoksa süreç başına rastgele (yeniden başlatmada eski ref'ler geçersiz). */
export const refKeyFrom = (configured: string | undefined): string => configured ?? randomBytes(32).toString("base64url");

const refMac = (key: string, id: string): string => createHmac("sha256", key).update(id).digest("base64url");

/** sessionRef = base64url(HMAC-SHA256(key, id)) + id (mimari-api.md). Tahmin edilemez; tüketim sağlamaz. */
export const sessionRef = (key: string, id: string): string => `${refMac(key, id)}${id}`;

/** Geçerli ref → oturum id; aksi halde null (sabit süreli karşılaştırma). */
export function parseSessionRef(key: string, ref: string): string | null {
  const mac = ref.slice(0, 43);
  const id = ref.slice(43);
  return id.length === 26 && safeEqual(mac, refMac(key, id)) ? id : null;
}

interface PrismaLikeError {
  code?: unknown;
  meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } };
}

/** INSERT'te active_code UQ çakışması mı (Prisma 7 + mariadb: meta.target yok; db-notlari P2). */
export function isActiveCodeConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as PrismaLikeError;
  return e.code === "P2002" && e.meta?.driverAdapterError?.cause?.constraint?.index === ACTIVE_CODE_INDEX;
}
