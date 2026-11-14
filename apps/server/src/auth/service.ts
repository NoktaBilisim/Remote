// Giriş, çıkış, şifre değişimi (AC-64, AC-65, AC-66). Kilit kuralları (G-23, mimari §5.1):
//  - IP başına 20 giriş denemesi/dk (aşım 429),
//  - hesap+IP ikilisi: 15 dk'da en çok 5 deneme; 5. hatada 15 dk kilit (bellek; deneme doğrulamadan ÖNCE sayılır → paralel istekle aşılamaz, S1-6),
//  - hesap geneli: IP'den bağımsız 1 saatte 20 hatalı → 15 dk kilit. Var olan hesapta DB (atomik, S1-2),
//    olmayan hesapta aynı kural bellekte (login anahtarlı) → yanıtlar hesap varlığını sızdırmaz (S1-5).
// Kilitli dalda da argon2 doğrulaması yapılır (sabit maliyet).
// S8b-6: hesap sayacı TX dışında atomik UPDATE; DB o an yazamazsa bellek içi yedek kovaya düşülür (aynı eşik, fail-closed).
import type { LoginInput, PasswordChangeInput } from "@remote/contracts/api/auth";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit, type AuditContext, type AuditEntry } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { ipKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import * as repo from "./repo.ts";
import { superadminTempPasswordExpired } from "./superadmin-reset.ts";
import { canSignIn, mfaStageOf, openSession, toAuthUser, type AuthContext } from "./session.ts";

/** P10 (AC-65): hesap geneli kilit konduğunda hesap sahibine bildirim (asenkron; SMTP yoksa yalnız audit). */
export type LockNotifier = (user: { id: string; tenantId: string | null; email: string }) => void;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ACCOUNT_LIMIT = 20;
const LOCK_MIN = 15;
const LOCK_MS = LOCK_MIN * MIN;
const BAD_CREDENTIALS = "E-posta/kullanıcı adı veya şifre hatalı.";
const TEMP_PASSWORD_EXPIRED = "Geçici şifrenin süresi doldu (24 saat). Sunucu yöneticisinden yeniden sıfırlama isteyin.";

export interface AuthLimits {
  ip: FixedWindowCounter;
  pair: FixedWindowCounter;
  /** Yalnız var olmayan hesaplar için (var olanlar DB'de). */
  ghostAccount: FixedWindowCounter;
  /** Var olan hesap için yedek kova: DB sayacı yazılamadığında (S8b-6); anahtar kullanıcı id'si. */
  accountFallback: FixedWindowCounter;
  /** Oturum başına hatalı mevcut şifre (S1-3). */
  passwordChange: FixedWindowCounter;
}

export const createAuthLimits = (): AuthLimits => ({
  ip: new FixedWindowCounter(21, MIN, MIN), // 21. deneme reddedilir → 20/dk
  pair: new FixedWindowCounter(5, LOCK_MS, LOCK_MS),
  ghostAccount: new FixedWindowCounter(ACCOUNT_LIMIT, HOUR, LOCK_MS),
  accountFallback: new FixedWindowCounter(ACCOUNT_LIMIT, HOUR, LOCK_MS),
  passwordChange: new FixedWindowCounter(5, LOCK_MS, LOCK_MS),
});

export const closeAuthLimits = (l: AuthLimits): void => Object.values(l).forEach((c: FixedWindowCounter) => c.close());

const locked = (retryAfterSec: number) => new AppError("ACCOUNT_LOCKED", { retryAfterSec: Math.max(1, retryAfterSec) });

const who = (user: repo.LoginUser | null, login: string): Pick<AuditEntry, "tenantId" | "userId" | "username"> => ({
  tenantId: user?.tenantId ?? null,
  userId: user?.id ?? null,
  username: user?.email ?? login,
});

/** DB sayacı yazılamadı: bellek kovası + login başında okunan DB sayımı birlikte eşiğe vurursa kilit (fail-closed). */
function fallbackFailure(limits: AuthLimits, user: repo.LoginUser, now: Date): boolean {
  if (limits.accountFallback.hit(user.id)) return true;
  const dbCount = user.failedWindowAt && user.failedWindowAt.getTime() > now.getTime() - HOUR ? user.failedLoginCount : 0;
  if (dbCount + limits.accountFallback.count(user.id) < ACCOUNT_LIMIT) return false;
  limits.accountFallback.block(user.id);
  return true;
}

const errCode = (err: unknown): unknown => (typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined);

async function recordFailure(db: Db, limits: AuthLimits, ctx: AuditContext, log: FastifyBaseLogger, user: repo.LoginUser | null, login: string, pairLocked: boolean, now: Date, onLock?: LockNotifier) {
  let lockedNow: boolean;
  if (!user) lockedNow = limits.ghostAccount.hit(sha256Hex(login));
  else {
    try {
      lockedNow = await repo.bumpAccountFailures(db, user.id, ACCOUNT_LIMIT, LOCK_MIN);
    } catch (err) {
      lockedNow = fallbackFailure(limits, user, now);
      log.warn({ alarm: "auth_fail_counter_fallback", userId: user.id, code: errCode(err), lockedNow }, "hesap sayacı DB'ye yazılamadı; bellek kovası kullanıldı");
    }
  }
  const base = { ...who(user, login), entity: "users", entityId: user?.id ?? null };
  try {
    await db.$transaction(async (tx) => {
      await writeAudit(tx, ctx, { ...base, action: "auth.login", result: "fail", newValue: { reason: "invalid_credentials" } });
      if (pairLocked) await writeAudit(tx, ctx, { ...base, action: "auth.locked", result: "success", newValue: { scope: "account_ip", minutes: LOCK_MIN } });
      if (lockedNow) await writeAudit(tx, ctx, { ...base, action: "auth.locked", result: "success", newValue: { scope: "account", minutes: LOCK_MIN } });
    });
  } catch (err) {
    // Audit yazılamadı: karar (401/423) yine verilir; olay en az log'a düşer (login/IP/şifre yok).
    log.warn({ alarm: "auth_fail_unrecorded", userId: user?.id ?? null, pairLocked, lockedNow, code: errCode(err) }, "başarısız giriş audit'e yazılamadı");
  }
  // Bildirim yalnız kilidi BU isteğin koyduğu durumda (bumpAccountFailures true → bir kez).
  if (lockedNow && user && onLock) onLock({ id: user.id, tenantId: user.tenantId, email: user.email });
  return lockedNow;
}

function accountWait(limits: AuthLimits, user: repo.LoginUser | null, login: string, now: Date): number {
  if (!user) return limits.ghostAccount.blockedFor(sha256Hex(login));
  const db = user.lockedUntil && user.lockedUntil > now ? Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000) : 0;
  return Math.max(db, limits.accountFallback.blockedFor(user.id));
}

/** `previousToken`: aynı tarayıcıdan gelen eski oturum çerezi; başarılı girişte iptal edilir (S1-10). */
export async function login(db: Db, limits: AuthLimits, ctx: AuditContext, log: FastifyBaseLogger, input: LoginInput, setupEnforced: boolean, previousToken?: string, onLock?: LockNotifier) {
  const ip = ipKey(ctx.ip);
  const ipWait = limits.ip.blockedFor(ip);
  if (ipWait > 0 || limits.ip.hit(ip)) throw new AppError("RATE_LIMITED", { retryAfterSec: ipWait || 60 });

  const login = input.login.toLowerCase();
  const pairKey = `${sha256Hex(login)}|${ip}`; // sabit uzunluklu anahtar (S2-1)
  const pairWait = limits.pair.blockedFor(pairKey);
  const pairLocked = pairWait === 0 && limits.pair.hit(pairKey); // senkron: await'ten önce sayılır
  const user = await repo.findUserByLogin(db, input.login);
  const now = new Date();
  const accWait = accountWait(limits, user, login, now);
  const passwordOk = await verifyPassword(user?.passwordHash ?? null, input.password);

  if (pairWait > 0 || accWait > 0) {
    try {
      await writeAudit(db, ctx, { ...who(user, login), action: "auth.login", entity: "users", entityId: user?.id ?? null, result: "fail", newValue: { reason: "locked" } });
    } catch (err) {
      // S8b-7: audit düşse de yanıt 423 (kilit durumu 5xx ile sızmaz); olay en az log'a düşer (login/IP/şifre yok).
      log.warn({ alarm: "auth_fail_unrecorded", userId: user?.id ?? null, locked: true, code: errCode(err) }, "kilitli hesap girişi audit'e yazılamadı");
    }
    throw locked(Math.max(pairWait, accWait));
  }
  if (!user || !passwordOk || !canSignIn(user)) {
    const accountLocked = await recordFailure(db, limits, ctx, log, user, login, pairLocked, now, onLock);
    if (pairLocked || accountLocked) throw locked(LOCK_MS / 1000);
    throw new AppError("UNAUTHENTICATED", { message: BAD_CREDENTIALS });
  }

  // G-P13b-10: CLI ile verilen geçici Super Admin parolası 24 saat geçerli (parolayı bilen kişiye özel mesaj; oracle değil).
  if (user.mustChangePassword && user.role === "SUPER_ADMIN" && (await superadminTempPasswordExpired(db, user.id, now))) {
    await writeAudit(db, ctx, { ...who(user, login), action: "auth.login", entity: "users", entityId: user.id, result: "fail", newValue: { reason: "temp_password_expired" } });
    throw new AppError("UNAUTHENTICATED", { message: TEMP_PASSWORD_EXPIRED });
  }

  limits.pair.reset(pairKey);
  limits.accountFallback.reset(user.id);
  const session = await db.$transaction(async (tx) => {
    if (user.failedLoginCount > 0 || user.lockedUntil) await repo.clearFailures(tx, user.id);
    if (previousToken) await repo.revokeSessionByHash(tx, sha256Hex(previousToken), now);
    // P10 (AC-67): 2FA etkinse oturum yarım açılır (mfa_passed=false) → yalnız /auth/mfa/verify.
    const opened = await openSession(tx, user.id, ctx, now, undefined, !user.totpEnabled);
    await writeAudit(tx, ctx, { ...who(user, login), action: "auth.login", entity: "users", entityId: user.id, result: "success" });
    return opened;
  });
  return { ...session, user: toAuthUser(user), mfaStage: mfaStageOf(user, !user.totpEnabled, setupEnforced) };
}

const authWho = (auth: AuthContext) => ({ tenantId: auth.user.tenantId, userId: auth.user.id, username: auth.user.email });

export async function logout(db: Db, ctx: AuditContext, auth: AuthContext): Promise<void> {
  await db.$transaction(async (tx) => {
    await repo.revokeSession(tx, auth.sessionId, new Date());
    await writeAudit(tx, ctx, { ...authWho(auth), action: "auth.logout", entity: "auth_sessions", entityId: auth.sessionId, result: "success" });
  });
}

/**
 * Şifre değişimi (AC-66, S1-3, S2-2): başarıda kullanıcının TÜM oturumları (mevcut dahil) aynı TX'te iptal
 * edilir ve mevcut oturumun yerine yeni token + CSRF verilir (mutlak bitiş korunur).
 * Oturum başına 5 hatalı mevcut şifre → oturum iptal + 401 (deneme doğrulamadan önce sayılır).
 */
export async function changePassword(db: Db, limits: AuthLimits, ctx: AuditContext, auth: AuthContext, input: PasswordChangeInput) {
  const user = await repo.findUserById(db, auth.user.id);
  if (!user) throw new AppError("UNAUTHENTICATED");
  const exhausted = limits.passwordChange.blockedFor(auth.sessionId) > 0 || limits.passwordChange.hit(auth.sessionId);
  const base = { ...authWho(auth), action: "auth.password_change", entity: "users", entityId: user.id };
  if (!(await verifyPassword(user.passwordHash, input.current))) {
    await db.$transaction(async (tx) => {
      await writeAudit(tx, ctx, { ...base, result: "fail", newValue: { reason: exhausted ? "too_many_attempts" : "invalid_current" } });
      if (exhausted) await repo.revokeSession(tx, auth.sessionId, new Date());
    });
    if (exhausted) throw new AppError("UNAUTHENTICATED", { message: "Çok fazla hatalı deneme. Lütfen yeniden giriş yapın." });
    throw new AppError("VALIDATION", { fields: { current: "Mevcut şifre hatalı." } });
  }
  limits.passwordChange.reset(auth.sessionId);
  const passwordHash = await hashPassword(input.next);
  const now = new Date();
  return db.$transaction(async (tx) => {
    await repo.updatePassword(tx, user.id, passwordHash);
    const revoked = await repo.revokeUserSessions(tx, user.id, now);
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }); // P10: açık sıfırlama bağlantıları geçersiz
    const renewed = await openSession(tx, user.id, ctx, now, auth.expiresAt);
    await writeAudit(tx, ctx, { ...base, result: "success", newValue: { revokedSessions: revoked } });
    return renewed;
  });
}
