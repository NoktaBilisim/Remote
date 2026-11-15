// P10 hesap güvenliği servisleri: 2FA kurulum/etkinleştirme/doğrulama (AC-67), tüm cihazlardan çıkış (AC-68, 115).
// Step-up / kurtarma kodu yenileme: step-up.ts; şifre sıfırlama (AC-66) ve kilit bildirimi (AC-65): password-reset.ts.
// Handler'lar yalnız doğrulama + çağrı + yanıt.
import { RECOVERY_CODE_COUNT, type MfaEnableResponse, type MfaSetupResponse, type MfaVerifyInput } from "@remote/contracts/api/auth";
import { AUTH_AUDIT } from "@remote/contracts/audit";
import QRCode from "qrcode";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import type { MailService } from "../mail/service.ts";
import { mfaEnabledMail } from "../mail/templates.ts";
import { MIN, consumeSecondFactor, hitMfaLimit, loadSecret, resetMfaLimit, who } from "./account-shared.ts";
import { newRecoveryCode, newTotpSecret, otpauthUrl, recoveryCodeHash, matchTotp } from "./mfa.ts";
import { openSession, type AuthContext } from "./session.ts";

export interface AccountLimits {
  /**
   * 2FA verify/enable (B-P10-9, G-23 kalıbı): hesap+IP 5 deneme / 5 dk (6. → 429, 5 dk); hesap geneli IP'den bağımsız
   * 15 deneme / 15 dk (16. → 429, 15 dk). Tek IP'den gerçek kullanıcının doğrulaması kilitlenemez; hesap başına deneme
   * hızı önceki 5/5 dk tavanıyla aynı (60/sa) kalır → kaba kuvvet direnci düşmez.
   */
  mfaPair: FixedWindowCounter;
  mfaUser: FixedWindowCounter;
  /** AC-65 kilit e-postası soğuması (B-P10-9): kullanıcı başına saatte 1. */
  lockMail: FixedWindowCounter;
  /** forgot: 10/sa/IP; reset: 10/15 dk/IP. */
  forgotIp: FixedWindowCounter;
  resetIp: FixedWindowCounter;
}
export const createAccountLimits = (): AccountLimits => ({
  mfaPair: new FixedWindowCounter(6, 5 * MIN, 5 * MIN),
  mfaUser: new FixedWindowCounter(16, 15 * MIN, 15 * MIN),
  lockMail: new FixedWindowCounter(2, 60 * MIN, 60 * MIN),
  forgotIp: new FixedWindowCounter(11, 60 * MIN, 60 * MIN),
  resetIp: new FixedWindowCounter(11, 15 * MIN, 15 * MIN),
});
export const closeAccountLimits = (l: AccountLimits): void => Object.values(l).forEach((c: FixedWindowCounter) => c.close());

export interface AccountDeps {
  db: Db;
  secrets: SecretBox;
  mail: MailService;
  limits: AccountLimits;
  publicBaseUrl: string;
  /** Commit sonrası canlı yansıma (G-04): odalar + panel soketleri. */
  endLive(userId: string): Promise<void>;
  log: { error(o: object, m: string): void };
  now?: () => number;
}

/** Testlere özel gecikme kancası (ADR-0023): üretimde verilmez, env bayrağı yok. */
interface RaceHooks {
  afterLock?: () => Promise<void>;
}

/**
 * POST /auth/mfa/setup: yeni sır (şifreli) yazılır; etkinse 409 (önce Admin sıfırlaması). P14a (AC-214): sürüm okunur,
 * yazım koşullu `UPDATE … WHERE id AND totp_enabled=0 AND version=?` + `version+1` — paralel iki kurulumdan yalnız biri
 * sır yazar, diğeri deterministik 409 alır (sürüm okuma ile UPDATE arasına giren yazım kaybolmaz).
 */
export async function mfaSetup(d: AccountDeps, ctx: AuditContext, auth: AuthContext, hooks: RaceHooks = {}): Promise<MfaSetupResponse> {
  const secret = newTotpSecret();
  const busy = (): AppError =>
    new AppError("CONFLICT", { message: "İki adımlı doğrulama zaten etkin veya kurulum değişti; sayfayı yenileyin." });
  const cur = await d.db.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { version: true, totpEnabled: true } });
  if (cur.totpEnabled) throw busy();
  await hooks.afterLock?.();
  await d.db.$transaction(async (tx) => {
    const r = await tx.user.updateMany({
      where: { id: auth.user.id, totpEnabled: false, version: cur.version },
      data: {
        totpSecretEnc: d.secrets.encrypt(secret, aadFor.totpSecret(auth.user.id)),
        totpLastStep: null,
        version: { increment: 1 },
      },
    });
    if (r.count === 0) throw busy();
    await writeAudit(tx, ctx, { ...who(auth), action: AUTH_AUDIT.MFA_SETUP, entity: "users", entityId: auth.user.id, result: "success" });
  });
  const url = otpauthUrl(secret, auth.user.email);
  return { otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 }), secret };
}

/**
 * POST /auth/mfa/enable: kod doğrulanınca tek TX'te etkinleştir + 10 kurtarma kodu + bu oturum `mfa_passed` + diğer
 * oturumlar iptal (yalnız şifreyle açılmış oturum 2FA'yı atlamasın). UPDATE doğrulanan şifreli sıra bağlı (B-P10-6:
 * paralel `setup` başka bir sır yazdıysa 409 — doğrulanmamış sır etkinleşmez). Commit sonrası hesap sahibine bildirim
 * e-postası (tenant SMTP'si yoksa `mail.sent{not_configured}` audit'i kalır).
 */
export async function mfaEnable(d: AccountDeps, ctx: AuditContext, auth: AuthContext, code: string): Promise<MfaEnableResponse> {
  hitMfaLimit(d, auth.user.id, ctx.ip);
  const { enc, secret, enabled } = await loadSecret(d, d.db, auth.user.id);
  if (enabled) throw new AppError("CONFLICT", { message: "İki adımlı doğrulama zaten etkin." });
  if (!secret || !enc) throw new AppError("CONFLICT", { message: "Önce kurulumu başlatın." });
  const step = matchTotp(secret, code, d.now?.() ?? Date.now());
  if (step === null) {
    await writeAudit(d.db, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.MFA_ENABLED,
      entity: "users",
      entityId: auth.user.id,
      result: "fail",
      newValue: { reason: "invalid_code" },
    });
    throw new AppError("VALIDATION", { fields: { code: "Kod hatalı veya süresi geçmiş." } });
  }
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const now = new Date();
  await d.db.$transaction(async (tx) => enableTx(d, tx, ctx, auth, { enc, step, codes, now }));
  resetMfaLimit(d, auth.user.id, ctx.ip);
  void d.mail
    .sendForTenant(ctx, { ...who(auth), kind: "mfa_enabled", entity: "users", entityId: auth.user.id }, auth.user.email, mfaEnabledMail())
    .catch((err: unknown) => d.log.error({ err, event: "mfa_enabled_notify_failed" }, "2FA etkinleştirme bildirimi gönderilemedi"));
  return { recoveryCodes: codes };
}

/** mfaEnable TX'i: doğrulanan sıra bağlı koşullu etkinleştirme + kurtarma kodları + oturum `mfa_passed` + diğerleri iptal. */
async function enableTx(
  d: AccountDeps,
  tx: Prisma.TransactionClient,
  ctx: AuditContext,
  auth: AuthContext,
  { enc, step, codes, now }: { enc: Uint8Array<ArrayBuffer>; step: number; codes: string[]; now: Date },
): Promise<void> {
  const r = await tx.user.updateMany({
    where: { id: auth.user.id, totpEnabled: false, totpSecretEnc: { equals: enc } },
    data: { totpEnabled: true, totpLastStep: BigInt(step) },
  });
  if (r.count === 0)
    throw new AppError("CONFLICT", { message: "Kurulum değişti veya iki adımlı doğrulama zaten etkin; sayfayı yenileyin." });
  await tx.recoveryCode.deleteMany({ where: { userId: auth.user.id } });
  await tx.recoveryCode.createMany({
    data: codes.map((c) => ({ id: newId(), userId: auth.user.id, codeHash: recoveryCodeHash(d.secrets, c) })),
  });
  await tx.authSession.update({ where: { id: auth.sessionId }, data: { mfaPassed: true } });
  const revoked = await tx.authSession.updateMany({
    where: { userId: auth.user.id, revokedAt: null, id: { not: auth.sessionId } },
    data: { revokedAt: now },
  });
  await writeAudit(tx, ctx, {
    ...who(auth),
    action: AUTH_AUDIT.MFA_ENABLED,
    entity: "users",
    entityId: auth.user.id,
    result: "success",
    newValue: { revokedSessions: revoked.count },
  });
}

/**
 * POST /auth/mfa/verify: TOTP (±1 adım, `totp_last_step` koşullu UPDATE → aynı/eski kod ikinci kez kabul edilmez) ya da
 * kurtarma kodu (koşullu `used_at`). Başarıda oturum token'ı yenilenir (yarım oturum → tam oturum; sabitleme yok).
 */
export async function mfaVerify(d: AccountDeps, ctx: AuditContext, auth: AuthContext, input: MfaVerifyInput) {
  hitMfaLimit(d, auth.user.id, ctx.ip);
  if (auth.mfaStage !== "verify") throw new AppError("CONFLICT", { message: "Bu oturum için doğrulama gerekmiyor." });
  const userId = auth.user.id;
  const method = "code" in input ? "totp" : "recovery";
  const fail = async (reason: string): Promise<never> => {
    await writeAudit(d.db, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.MFA_VERIFY,
      entity: "users",
      entityId: userId,
      result: "fail",
      newValue: { method, reason },
    });
    throw new AppError("UNAUTHENTICATED", { message: "Doğrulama kodu hatalı." });
  };
  const now = new Date(d.now?.() ?? Date.now());
  const opened = await d.db.$transaction(async (tx) => {
    const factor = "code" in input ? { totp: input.code } : { recovery: input.recoveryCode };
    const check = await consumeSecondFactor(d, tx, userId, factor, now);
    if (check === "invalid") return null;
    if (check === "replay") return "replay" as const;
    await tx.authSession.updateMany({ where: { id: auth.sessionId, revokedAt: null }, data: { revokedAt: now } });
    const s = await openSession(tx, userId, ctx, now, auth.expiresAt, true);
    const left = await tx.recoveryCode.count({ where: { userId, usedAt: null } });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.MFA_VERIFY,
      entity: "users",
      entityId: userId,
      result: "success",
      newValue: { method, remaining: left },
    });
    return { ...s, left };
  });
  if (opened === null) return fail("invalid_code");
  if (opened === "replay") return fail("replayed_code");
  resetMfaLimit(d, userId, ctx.ip);
  return { session: opened, user: auth.user, recoveryCodesLeft: opened.left };
}

export async function recoveryCodesLeft(db: Db, userId: string): Promise<number> {
  return db.recoveryCode.count({ where: { userId, usedAt: null } });
}

/** POST /auth/logout-all (AC-68, 115): diğer oturumlar iptal; commit sonrası canlı odalar + panel soketleri biter. */
export async function logoutAll(d: AccountDeps, ctx: AuditContext, auth: AuthContext): Promise<number> {
  const now = new Date();
  const count = await d.db.$transaction(async (tx) => {
    const r = await tx.authSession.updateMany({
      where: { userId: auth.user.id, revokedAt: null, id: { not: auth.sessionId } },
      data: { revokedAt: now },
    });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.LOGOUT_ALL,
      entity: "auth_sessions",
      entityId: auth.sessionId,
      result: "success",
      newValue: { revokedSessions: r.count },
    });
    return r.count;
  });
  try {
    await d.endLive(auth.user.id);
  } catch (err) {
    d.log.error({ err, alarm: "user_live_effect" }, "tüm cihazlardan çıkış canlı oturuma yansıtılamadı (yedek: 60 sn doğrulama)");
  }
  return count;
}
