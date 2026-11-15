// Hesap güvenliği ortak yardımcıları (account.ts'ten taşındı, PT-K12): audit kimliği, deneme sınırları, TOTP sırrı,
// ikinci faktör tüketimi. Kullananlar: account.ts, step-up.ts, password-reset.ts.
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { ipKey } from "../lib/ip.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import type { AccountDeps } from "./account.ts";
import { matchTotp, recoveryCodeCandidates } from "./mfa.ts";
import type { AuthContext } from "./session.ts";

export const MIN = 60_000;

export const who = (auth: AuthContext) => ({ tenantId: auth.user.tenantId, userId: auth.user.id, username: auth.user.email });

export function hitLimit(c: FixedWindowCounter, key: string): void {
  const wait = c.blockedFor(key);
  if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
  if (c.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: c.blockedFor(key) || 60 });
}

/** 2FA deneme sınırı: hesap+IP ve hesap geneli birlikte (biri kilitliyse 429). */
export function hitMfaLimit(d: AccountDeps, userId: string, ip: string): void {
  const pair = `${userId}|${ipKey(ip)}`;
  const wait = Math.max(d.limits.mfaPair.blockedFor(pair), d.limits.mfaUser.blockedFor(userId));
  if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
  const pairHit = d.limits.mfaPair.hit(pair);
  const userHit = d.limits.mfaUser.hit(userId);
  if (pairHit || userHit)
    throw new AppError("RATE_LIMITED", {
      retryAfterSec: Math.max(d.limits.mfaPair.blockedFor(pair), d.limits.mfaUser.blockedFor(userId)) || 60,
    });
}
export function resetMfaLimit(d: AccountDeps, userId: string, ip: string): void {
  d.limits.mfaPair.reset(`${userId}|${ipKey(ip)}`);
  d.limits.mfaUser.reset(userId);
}

/** Şifreli sır (koşullu UPDATE için ham bayt) + çözülmüş hali. `db` TX içinde `tx` verilir. */
export async function loadSecret(
  d: AccountDeps,
  db: Pick<Db, "user">,
  userId: string,
): Promise<{ enc: Uint8Array<ArrayBuffer> | null; secret: string | null; enabled: boolean }> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecretEnc: true, totpEnabled: true } });
  return {
    enc: u.totpSecretEnc,
    secret: u.totpSecretEnc ? d.secrets.decrypt(u.totpSecretEnc, aadFor.totpSecret(userId)) : null,
    enabled: u.totpEnabled,
  };
}

/**
 * İkinci faktörü doğrular ve TÜKETİR (TX içinde) — giriş doğrulaması (`/auth/mfa/verify`) ve step-up (`/auth/step-up`)
 * aynı fonksiyonu kullanır (P14a, ADR-0022: kopya yok). TOTP: ±1 adım, `totp_last_step` koşullu UPDATE (aynı/eski kod
 * ikinci kez kabul edilmez → "replay"). Kurtarma kodu: koşullu `used_at` (ikinci kullanımda "invalid").
 */
export async function consumeSecondFactor(
  d: AccountDeps,
  tx: Prisma.TransactionClient,
  userId: string,
  factor: { totp: string } | { recovery: string },
  now: Date,
): Promise<"ok" | "invalid" | "replay"> {
  if ("totp" in factor) {
    const { secret } = await loadSecret(d, tx, userId);
    const step = secret ? matchTotp(secret, factor.totp, now.getTime()) : null;
    if (step === null) return "invalid";
    const r = await tx.user.updateMany({
      where: { id: userId, totpEnabled: true, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
      data: { totpLastStep: BigInt(step) },
    });
    return r.count === 0 ? "replay" : "ok";
  }
  const r = await tx.recoveryCode.updateMany({
    where: { userId, codeHash: { in: recoveryCodeCandidates(d.secrets, factor.recovery) }, usedAt: null },
    data: { usedAt: now },
  });
  return r.count === 1 ? "ok" : "invalid";
}
