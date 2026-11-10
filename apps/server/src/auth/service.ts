// Giriş, çıkış, şifre değişimi (AC-64, AC-65, AC-66). Kilit kuralları (G-23, mimari §5.1):
//  - IP başına 20 giriş denemesi/dk (aşım 429),
//  - hesap+IP ikilisi: 15 dk'da en çok 5 deneme; 5. hatada 15 dk kilit (bellek; deneme doğrulamadan ÖNCE sayılır → paralel istekle aşılamaz, S1-6),
//  - hesap geneli: IP'den bağımsız 1 saatte 20 hatalı → 15 dk kilit. Var olan hesapta DB (atomik, S1-2),
//    olmayan hesapta aynı kural bellekte (login anahtarlı) → yanıtlar hesap varlığını sızdırmaz (S1-5).
// Kilitli dalda da argon2 doğrulaması yapılır (sabit maliyet).
import type { LoginInput, PasswordChangeInput } from "@remote/contracts/api/auth";
import { writeAudit, type AuditContext, type AuditEntry } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { ipKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import * as repo from "./repo.ts";
import { canSignIn, openSession, toAuthUser, type AuthContext } from "./session.ts";

const MIN = 60 * 1000;
const ACCOUNT_LIMIT = 20;
const LOCK_MIN = 15;
const LOCK_MS = LOCK_MIN * MIN;
const BAD_CREDENTIALS = "E-posta/kullanıcı adı veya şifre hatalı.";

export interface AuthLimits {
  ip: FixedWindowCounter;
  pair: FixedWindowCounter;
  /** Yalnız var olmayan hesaplar için (var olanlar DB'de). */
  ghostAccount: FixedWindowCounter;
  /** Oturum başına hatalı mevcut şifre (S1-3). */
  passwordChange: FixedWindowCounter;
}

export const createAuthLimits = (): AuthLimits => ({
  ip: new FixedWindowCounter(21, MIN, MIN), // 21. deneme reddedilir → 20/dk
  pair: new FixedWindowCounter(5, LOCK_MS, LOCK_MS),
  ghostAccount: new FixedWindowCounter(ACCOUNT_LIMIT, 60 * MIN, LOCK_MS),
  passwordChange: new FixedWindowCounter(5, LOCK_MS, LOCK_MS),
});

export const closeAuthLimits = (l: AuthLimits): void => Object.values(l).forEach((c: FixedWindowCounter) => c.close());

const locked = (retryAfterSec: number) => new AppError("ACCOUNT_LOCKED", { retryAfterSec: Math.max(1, retryAfterSec) });

const who = (user: repo.LoginUser | null, login: string): Pick<AuditEntry, "tenantId" | "userId" | "username"> => ({
  tenantId: user?.tenantId ?? null,
  userId: user?.id ?? null,
  username: user?.email ?? login,
});

async function recordFailure(db: Db, limits: AuthLimits, ctx: AuditContext, user: repo.LoginUser | null, login: string, pairLocked: boolean) {
  const accountLocked = user ? null : limits.ghostAccount.hit(sha256Hex(login));
  return db.$transaction(async (tx) => {
    const lockedNow = accountLocked ?? (await repo.bumpAccountFailures(tx, user?.id ?? "", ACCOUNT_LIMIT, LOCK_MIN));
    const base = { ...who(user, login), entity: "users", entityId: user?.id ?? null };
    await writeAudit(tx, ctx, { ...base, action: "auth.login", result: "fail", newValue: { reason: "invalid_credentials" } });
    if (pairLocked) await writeAudit(tx, ctx, { ...base, action: "auth.locked", result: "success", newValue: { scope: "account_ip", minutes: LOCK_MIN } });
    // Hesap sahibine bildirim e-postası P10'da (SMTP); şimdilik yalnız audit (mimari §5.1).
    if (lockedNow) await writeAudit(tx, ctx, { ...base, action: "auth.locked", result: "success", newValue: { scope: "account", minutes: LOCK_MIN } });
    return lockedNow;
  });
}

function accountWait(limits: AuthLimits, user: repo.LoginUser | null, login: string, now: Date): number {
  if (!user) return limits.ghostAccount.blockedFor(sha256Hex(login));
  return user.lockedUntil && user.lockedUntil > now ? Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000) : 0;
}

/** `previousToken`: aynı tarayıcıdan gelen eski oturum çerezi; başarılı girişte iptal edilir (S1-10). */
export async function login(db: Db, limits: AuthLimits, ctx: AuditContext, input: LoginInput, previousToken?: string) {
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
    await writeAudit(db, ctx, { ...who(user, login), action: "auth.login", entity: "users", entityId: user?.id ?? null, result: "fail", newValue: { reason: "locked" } });
    throw locked(Math.max(pairWait, accWait));
  }
  if (!user || !passwordOk || !canSignIn(user)) {
    const accountLocked = await recordFailure(db, limits, ctx, user, login, pairLocked);
    if (pairLocked || accountLocked) throw locked(LOCK_MS / 1000);
    throw new AppError("UNAUTHENTICATED", { message: BAD_CREDENTIALS });
  }

  limits.pair.reset(pairKey);
  const session = await db.$transaction(async (tx) => {
    if (user.failedLoginCount > 0 || user.lockedUntil) await repo.clearFailures(tx, user.id);
    if (previousToken) await repo.revokeSessionByHash(tx, sha256Hex(previousToken), now);
    const opened = await openSession(tx, user.id, ctx, now);
    await writeAudit(tx, ctx, { ...who(user, login), action: "auth.login", entity: "users", entityId: user.id, result: "success" });
    return opened;
  });
  return { ...session, user: toAuthUser(user) };
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
    const renewed = await openSession(tx, user.id, ctx, now, auth.expiresAt);
    await writeAudit(tx, ctx, { ...base, result: "success", newValue: { revokedSessions: revoked } });
    return renewed;
  });
}
