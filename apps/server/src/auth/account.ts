// P10 hesap güvenliği servisleri: 2FA kurulum/etkinleştirme/doğrulama (AC-67), tüm cihazlardan çıkış (AC-68, 115),
// e-posta ile şifre sıfırlama (AC-66), kilit bildirimi (AC-65). Handler'lar yalnız doğrulama + çağrı + yanıt.
import {
  RECOVERY_CODE_COUNT,
  RESET_PASSWORD_PATH,
  RESET_TOKEN_TTL_MIN,
  STEP_UP_MAX_AGE_SEC,
  type MfaEnableResponse,
  type MfaSetupResponse,
  type MfaVerifyInput,
  type PasswordResetInput,
  type StepUpData,
  type StepUpResponse,
} from "@remote/contracts/api/auth";
import { AUTH_AUDIT } from "@remote/contracts/audit";
import QRCode from "qrcode";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { ipKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import type { MailService } from "../mail/service.ts";
import { accountLockedMail, mfaEnabledMail, passwordResetMail, recoveryCodeUsedMail } from "../mail/templates.ts";
import { matchTotp, newRecoveryCode, newTotpSecret, otpauthUrl, recoveryCodeCandidates, recoveryCodeHash } from "./mfa.ts";
import { hashPassword } from "./password.ts";
import * as repo from "./repo.ts";
import { canSignIn, openSession, type AuthContext } from "./session.ts";

const MIN = 60_000;
const RESET_PER_ACCOUNT_HOUR = 3;

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

const who = (auth: AuthContext) => ({ tenantId: auth.user.tenantId, userId: auth.user.id, username: auth.user.email });

function hitLimit(c: FixedWindowCounter, key: string): void {
  const wait = c.blockedFor(key);
  if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
  if (c.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: c.blockedFor(key) || 60 });
}

/** 2FA deneme sınırı: hesap+IP ve hesap geneli birlikte (biri kilitliyse 429). */
function hitMfaLimit(d: AccountDeps, userId: string, ip: string): void {
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
function resetMfaLimit(d: AccountDeps, userId: string, ip: string): void {
  d.limits.mfaPair.reset(`${userId}|${ipKey(ip)}`);
  d.limits.mfaUser.reset(userId);
}

/** Şifreli sır (koşullu UPDATE için ham bayt) + çözülmüş hali. `db` TX içinde `tx` verilir. */
async function loadSecret(
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

/** Testlere özel gecikme kancası (ADR-0023): üretimde verilmez, env bayrağı yok. */
export interface RaceHooks {
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
  await d.db.$transaction(async (tx) => {
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
  });
  resetMfaLimit(d, auth.user.id, ctx.ip);
  void d.mail
    .sendForTenant(ctx, { ...who(auth), kind: "mfa_enabled", entity: "users", entityId: auth.user.id }, auth.user.email, mfaEnabledMail())
    .catch((err: unknown) => d.log.error({ err, event: "mfa_enabled_notify_failed" }, "2FA etkinleştirme bildirimi gönderilemedi"));
  return { recoveryCodes: codes };
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

/**
 * İkinci faktörü doğrular ve TÜKETİR (TX içinde) — giriş doğrulaması (`/auth/mfa/verify`) ve step-up (`/auth/step-up`)
 * aynı fonksiyonu kullanır (P14a, ADR-0022: kopya yok). TOTP: ±1 adım, `totp_last_step` koşullu UPDATE (aynı/eski kod
 * ikinci kez kabul edilmez → "replay"). Kurtarma kodu: koşullu `used_at` (ikinci kullanımda "invalid").
 */
async function consumeSecondFactor(
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

/**
 * POST /auth/step-up (P14a, AC-215, ADR-0022; K-E11-1): TOTP veya kurtarma kodu. Deneme sayacı `/auth/mfa/verify` ile
 * ortak. Başarıda aynı TX'te faktör tüketilir + `auth_sessions.step_up_at = now` + audit `auth.step_up {method,
 * remaining}` (kod yazılmaz). Kurtarma koduyla: commit sonrası "Kurtarma kodunuz kullanıldı" e-postası (SMTP yoksa
 * `mail.sent{not_configured}` audit'i kalır) ve yanıtta `recoveryCodesLeft`. Hatalı kod → 400 `fields.code` (401 değil:
 * istemci oturumun düştüğünü sanmasın).
 */
export async function stepUp(d: AccountDeps, ctx: AuditContext, auth: AuthContext, input: StepUpData): Promise<StepUpResponse> {
  if (!auth.totpEnabled) throw new AppError("MFA_SETUP_REQUIRED");
  const userId = auth.user.id;
  hitMfaLimit(d, userId, ctx.ip);
  const now = new Date(d.now?.() ?? Date.now());
  const factor = input.method === "TOTP" ? { totp: input.code } : { recovery: input.code };
  const out = await d.db.$transaction(async (tx) => {
    const check = await consumeSecondFactor(d, tx, userId, factor, now);
    if (check !== "ok") return check;
    const s = await tx.authSession.updateMany({ where: { id: auth.sessionId, revokedAt: null }, data: { stepUpAt: now } });
    if (s.count !== 1) throw new AppError("UNAUTHENTICATED");
    const left = await tx.recoveryCode.count({ where: { userId, usedAt: null } });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.STEP_UP,
      entity: "auth_sessions",
      entityId: auth.sessionId,
      result: "success",
      newValue: { method: input.method, remaining: left },
    });
    return left;
  });
  if (typeof out !== "number") {
    await writeAudit(d.db, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.STEP_UP,
      entity: "auth_sessions",
      entityId: auth.sessionId,
      result: "fail",
      newValue: { method: input.method, reason: out === "replay" ? "replayed_code" : "invalid_code" },
    });
    throw new AppError("VALIDATION", { fields: { code: "Kod hatalı veya süresi geçmiş." } });
  }
  resetMfaLimit(d, userId, ctx.ip);
  const stepUpUntil = new Date(now.getTime() + STEP_UP_MAX_AGE_SEC * 1000).toISOString();
  if (input.method === "TOTP") return { stepUpUntil, method: "TOTP" };
  void d.mail
    .sendForTenant(
      ctx,
      { ...who(auth), kind: "recovery_code_used", entity: "users", entityId: userId },
      auth.user.email,
      recoveryCodeUsedMail({ remaining: out }),
    )
    .catch((err: unknown) => d.log.error({ err, event: "recovery_used_notify_failed" }, "kurtarma kodu bildirimi gönderilemedi"));
  return { stepUpUntil, method: "RECOVERY", recoveryCodesLeft: out };
}

/**
 * POST /auth/mfa/recovery-codes (P15, AC-231): yalnız TOTP (tüketilir — `totp_last_step` tekrar koruması); deneme
 * sayacı verify/step-up ile ortak (5 hatada kilit). Tek TX: faktör + eski kodların hepsi silinir + 10 yeni kod + audit
 * `mfa.recovery_regenerated {count}` (kod yazılmaz). Kodlar yalnız dönüş değerinde taşınır.
 */
export async function regenerateRecoveryCodes(d: AccountDeps, ctx: AuditContext, auth: AuthContext, code: string): Promise<string[]> {
  if (!auth.totpEnabled) throw new AppError("MFA_SETUP_REQUIRED");
  const userId = auth.user.id;
  hitMfaLimit(d, userId, ctx.ip);
  const now = new Date(d.now?.() ?? Date.now());
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const out = await d.db.$transaction(async (tx) => {
    const check = await consumeSecondFactor(d, tx, userId, { totp: code }, now);
    if (check !== "ok") return check;
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({ data: codes.map((c) => ({ id: newId(), userId, codeHash: recoveryCodeHash(d.secrets, c) })) });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.MFA_RECOVERY_REGENERATED,
      entity: "users",
      entityId: userId,
      result: "success",
      newValue: { count: codes.length },
    });
    return "ok" as const;
  });
  if (out !== "ok") {
    await writeAudit(d.db, ctx, {
      ...who(auth),
      action: AUTH_AUDIT.MFA_RECOVERY_REGENERATED,
      entity: "users",
      entityId: userId,
      result: "fail",
      newValue: { reason: out === "replay" ? "replayed_code" : "invalid_code" },
    });
    throw new AppError("VALIDATION", { fields: { code: "Kod hatalı veya süresi geçmiş." } });
  }
  resetMfaLimit(d, userId, ctx.ip);
  return codes;
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

/**
 * POST /auth/password/forgot (AC-66): çağıran HER durumda 202 döner; iş yanıt sonrası arka planda (zamanlama ile hesap
 * varlığı sızmaz). Super Admin / SMTP'siz tenant → gönderim yok, audit `fail{reason:no_smtp}` (kurtarma: runbook).
 */
export function forgotPassword(d: AccountDeps, ctx: AuditContext, email: string): void {
  hitLimit(d.limits.forgotIp, ctx.ip);
  setImmediate(() => {
    void processForgot(d, ctx, email).catch((err: unknown) =>
      d.log.error({ err, event: "password_forgot_failed" }, "şifre sıfırlama isteği işlenemedi"),
    );
  });
}

async function processForgot(d: AccountDeps, ctx: AuditContext, email: string): Promise<void> {
  const user = await repo.findUserByLogin(d.db, email);
  const base = {
    tenantId: user?.tenantId ?? null,
    userId: user?.id ?? null,
    username: user?.email ?? email,
    action: AUTH_AUDIT.PASSWORD_RESET_REQUESTED,
    entity: "users",
    entityId: user?.id ?? null,
  };
  const reject = (reason: string) => writeAudit(d.db, ctx, { ...base, result: "fail", newValue: { reason } });
  if (!user || !canSignIn(user)) return reject("unknown_or_inactive");
  const cfg = await d.mail.configFor(user.tenantId);
  if (!cfg) return reject("no_smtp");
  const now = new Date();
  const recent = await d.db.passwordResetToken.count({
    where: { userId: user.id, createdAt: { gte: new Date(now.getTime() - 60 * MIN) } },
  });
  if (recent >= RESET_PER_ACCOUNT_HOUR) return reject("rate_limited");
  const token = newSecretToken();
  await d.db.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await tx.passwordResetToken.create({
      data: {
        id: newId(),
        userId: user.id,
        tokenHash: sha256Hex(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MIN * MIN),
      },
    });
    await writeAudit(tx, ctx, { ...base, result: "success" });
  });
  const link = `${d.publicBaseUrl.replace(/\/+$/, "")}${RESET_PASSWORD_PATH}#token=${token}`;
  await d.mail.sendForTenant(
    ctx,
    { tenantId: user.tenantId, userId: user.id, username: user.email, kind: "password_reset", entity: "users", entityId: user.id },
    user.email,
    passwordResetMail({ link, ttlMin: RESET_TOKEN_TTL_MIN }),
    cfg,
  );
}

/** POST /auth/password/reset (AC-66): tek kullanım koşullu UPDATE; şifre + kilit sayaçları + tüm oturumlar aynı TX'te. */
export async function resetPassword(d: AccountDeps, ctx: AuditContext, input: PasswordResetInput): Promise<void> {
  hitLimit(d.limits.resetIp, ctx.ip);
  const now = new Date();
  const hash = sha256Hex(input.token);
  const row = await d.db.passwordResetToken.findUnique({ where: { tokenHash: hash }, select: { userId: true } });
  const user = row ? await repo.findUserById(d.db, row.userId) : null;
  if (!row || !user || !canSignIn(user)) throw new AppError("RESET_TOKEN_INVALID");
  const passwordHash = await hashPassword(input.next);
  await d.db.$transaction(async (tx) => {
    const r = await tx.passwordResetToken.updateMany({
      where: { tokenHash: hash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (r.count !== 1) throw new AppError("RESET_TOKEN_INVALID");
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, failedWindowAt: null, lockedUntil: null },
    });
    const revoked = await repo.revokeUserSessions(tx, user.id, now);
    await writeAudit(tx, ctx, {
      tenantId: user.tenantId,
      userId: user.id,
      username: user.email,
      action: AUTH_AUDIT.PASSWORD_RESET,
      entity: "users",
      entityId: user.id,
      result: "success",
      newValue: { revokedSessions: revoked },
    });
  });
  try {
    await d.endLive(user.id);
  } catch (err) {
    d.log.error({ err, alarm: "user_live_effect" }, "şifre sıfırlama canlı oturuma yansıtılamadı");
  }
}

/**
 * AC-65: kilit bildirimi (login yolunu bekletmez). SMTP yoksa sendForTenant `not_configured` audit'i yazar.
 * B-P10-9: kullanıcı başına saatte 1 e-posta (tekrarlanan kilitler gelen kutusunu doldurmaz; kilidin kendisi audit'te).
 */
export function lockNotifier(d: AccountDeps, ctx: AuditContext) {
  return (u: { id: string; tenantId: string | null; email: string }): void => {
    if (d.limits.lockMail.blockedFor(u.id) > 0 || d.limits.lockMail.hit(u.id)) return;
    void d.mail
      .sendForTenant(
        ctx,
        { tenantId: u.tenantId, userId: u.id, username: u.email, kind: "account_locked", entity: "users", entityId: u.id },
        u.email,
        accountLockedMail({ minutes: 15 }),
      )
      .catch((err: unknown) => d.log.error({ err, event: "lock_notify_failed" }, "kilit bildirimi gönderilemedi"));
  };
}
