// P21 portal kimliği servisleri (ADR-0039, mimari-p21 §5.1–5.2, §4.5): giriş (tek istek, yarım oturum yok), çıkış, şifre
// değişimi, isteğe bağlı TOTP kur/aç/kapat. `auth/password.ts` (argon2id) ve `auth/mfa.ts` (TOTP) yeniden kullanılır.
// Kilit/hız (panel G-23 kalıbı, AYRI kova örnekleri — portal/limits.ts): IP 20/dk; (kısa ad|e-posta)+IP 15 dk'da 5 → 15 dk
// kilit (doğrulamadan ÖNCE sayılır); hesap geneli 1 sa'de 20 hatalı → `locked_until` (DB atomik; yazılamazsa bellek yedeği,
// fail-closed); olmayan hesapta aynı eşik bellekte → yanıt hesap varlığını sızdırmaz. Kilitli dalda da argon2 çalışır.
// Audit aktör kuralı (K-P21-14): `user_id` NULL, `username` = e-posta, `entity = portal_users`, `entity_id` = portal hesabı.
import type { PasswordChangeInput } from "@remote/contracts/api/auth";
import type { PortalTotpDisableInput, PortalTotpSetupResponse } from "@remote/contracts/api/portal";
import { PORTAL_AUDIT, PORTAL_USERS_ENTITY, type PortalLoginFailReason } from "@remote/contracts/audit";
import type { FastifyBaseLogger } from "fastify";
import QRCode from "qrcode";
import { writeAudit, type AuditContext, type AuditEntry } from "../audit/service.ts";
import { matchTotp, newTotpSecret, otpauthUrl } from "../auth/mfa.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { ipKey } from "../lib/ip.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import type { Metrics } from "../ops/metrics.ts";
import { PORTAL_ACCOUNT_FAIL_LIMIT, PORTAL_LOCK_MIN, type PortalLimits } from "./limits.ts";
import * as repo from "./repo.ts";
import { openPortalSession, portalActive, portalContextOf, type OpenedPortalSession, type PortalContext } from "./session.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const LOCK_MS = PORTAL_LOCK_MIN * MIN;
const BAD_CREDENTIALS = "E-posta veya şifre hatalı.";
const BAD_CODE = "Kod hatalı.";
const TEMP_PASSWORD_EXPIRED = "Geçici şifrenin süresi doldu (72 saat). Destek sağlayıcınızdan yeniden sıfırlama isteyin.";

export interface PortalDeps {
  db: Db;
  secrets: SecretBox;
  limits: PortalLimits;
  metrics: Metrics;
  log: FastifyBaseLogger;
  /** Yalnız testler: sahte saat (TOTP adımı, geçici şifre süresi). */
  now?: () => number;
}

export const portalNow = (d: Pick<PortalDeps, "now">): Date => new Date(d.now?.() ?? Date.now());

/** Portal aktörlü audit kimliği (K-P21-14). Hesap yoksa `entity_id` NULL, `username` girilen e-posta (maskelenmez). */
export const portalWho = (
  tenantId: string | null,
  portalUserId: string | null,
  email: string,
): Pick<AuditEntry, "tenantId" | "userId" | "username" | "entity" | "entityId"> => ({
  tenantId,
  userId: null,
  username: email,
  entity: PORTAL_USERS_ENTITY,
  entityId: portalUserId,
});

const ctxWho = (p: PortalContext) => portalWho(p.scope.tenantId, p.user.id, p.user.email);

const locked = (retryAfterSec: number) => new AppError("ACCOUNT_LOCKED", { retryAfterSec: Math.max(1, retryAfterSec) });

const errCode = (err: unknown): unknown => (typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined);

function hitLimit(c: FixedWindowCounter, key: string): void {
  const wait = c.blockedFor(key);
  if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
  if (c.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: c.blockedFor(key) || 60 });
}

function loginMetric(d: PortalDeps, result: "success" | "fail" | "locked" | "mfa_required", reason?: string): void {
  d.metrics.inc("rs_portal_login_total", reason ? { result, reason } : { result });
  // §9: e-posta/şifre/kod yok — yalnız sonuç ve neden sınıfı.
  d.log.info({ event: "portal_login", result, ...(reason ? { reason } : {}) }, "portal girişi");
}

/** Girişteki deneme kimliği: firma kısa adı + e-posta (r2 S-P21-3 — aynı e-posta iki firmada ayrı kova). */
interface Attempt {
  ctx: AuditContext;
  subject: string;
  email: string;
  tenantId: string | null;
  user: repo.PortalUserRow | null;
  pairLocked: boolean;
  now: Date;
}

function accountWait(d: PortalDeps, a: Attempt): number {
  if (!a.user) return d.limits.ghostAccount.blockedFor(sha256Hex(a.subject));
  const u = a.user;
  const db = u.lockedUntil && u.lockedUntil > a.now ? Math.ceil((u.lockedUntil.getTime() - a.now.getTime()) / 1000) : 0;
  return Math.max(db, d.limits.accountFallback.blockedFor(u.id));
}

/** DB sayacı yazılamadı: bellek kovası + girişte okunan DB sayımı birlikte eşiğe vurursa kilit (fail-closed; S8b-6 kalıbı). */
function fallbackFailure(d: PortalDeps, u: repo.PortalUserRow, now: Date): boolean {
  if (d.limits.accountFallback.hit(u.id)) return true;
  const dbCount = u.failedWindowAt && u.failedWindowAt.getTime() > now.getTime() - HOUR ? u.failedLoginCount : 0;
  if (dbCount + d.limits.accountFallback.count(u.id) < PORTAL_ACCOUNT_FAIL_LIMIT) return false;
  d.limits.accountFallback.block(u.id);
  return true;
}

/** Başarısız deneme: sayaçlar + audit (login fail, gerekirse locked) + metrik → 423 ya da 401. */
async function failLogin(d: PortalDeps, a: Attempt, reason: PortalLoginFailReason, message: string): Promise<never> {
  let lockedNow: boolean;
  if (!a.user) lockedNow = d.limits.ghostAccount.hit(sha256Hex(a.subject));
  else {
    try {
      lockedNow = await repo.bumpPortalFailures(d.db, a.user.id, PORTAL_ACCOUNT_FAIL_LIMIT, PORTAL_LOCK_MIN);
    } catch (err) {
      lockedNow = fallbackFailure(d, a.user, a.now);
      d.log.warn(
        { alarm: "portal_fail_counter_fallback", portalUserId: a.user.id, code: errCode(err), lockedNow },
        "portal hesap sayacı DB'ye yazılamadı; bellek kovası kullanıldı",
      );
    }
  }
  const base = portalWho(a.tenantId, a.user?.id ?? null, a.email);
  try {
    await d.db.$transaction(async (tx) => {
      await writeAudit(tx, a.ctx, { ...base, action: PORTAL_AUDIT.LOGIN, result: "fail", newValue: { reason } });
      if (a.pairLocked)
        await writeAudit(tx, a.ctx, {
          ...base,
          action: PORTAL_AUDIT.LOCKED,
          result: "success",
          newValue: { scope: "account_ip", minutes: PORTAL_LOCK_MIN },
        });
      if (lockedNow)
        await writeAudit(tx, a.ctx, {
          ...base,
          action: PORTAL_AUDIT.LOCKED,
          result: "success",
          newValue: { scope: "account", minutes: PORTAL_LOCK_MIN },
        });
    });
  } catch (err) {
    // Audit yazılamadı: karar (401/423) yine verilir; olay log'a düşer (e-posta/IP/şifre yok).
    d.log.warn({ alarm: "portal_fail_unrecorded", code: errCode(err) }, "başarısız portal girişi audit'e yazılamadı");
  }
  if (a.pairLocked || lockedNow) {
    d.metrics.inc("rs_portal_locked_total");
    loginMetric(d, "locked", reason);
    throw locked(LOCK_MS / 1000);
  }
  loginMetric(d, "fail", reason);
  throw new AppError("UNAUTHENTICATED", { message });
}

/** Kilitli dal (423): audit `fail{locked}`; audit düşse de yanıt 423 (S8b-7 kalıbı). */
async function lockedLogin(d: PortalDeps, a: Attempt, wait: number): Promise<never> {
  try {
    await writeAudit(d.db, a.ctx, {
      ...portalWho(a.tenantId, a.user?.id ?? null, a.email),
      action: PORTAL_AUDIT.LOGIN,
      result: "fail",
      newValue: { reason: "locked" },
    });
  } catch (err) {
    d.log.warn({ alarm: "portal_fail_unrecorded", locked: true, code: errCode(err) }, "kilitli portal girişi audit'e yazılamadı");
  }
  loginMetric(d, "locked", "locked");
  throw locked(wait);
}

/**
 * TOTP kodunu doğrular ve TÜKETİR: ±1 adım, `totp_last_step` koşullu UPDATE (aynı/eski adım ikinci kez → "replay").
 * Sır AAD'si `aadFor.portalTotpSecret` (r2 S-P21-9).
 */
async function consumePortalTotp(d: PortalDeps, userId: string, code: string, now: Date): Promise<"ok" | "invalid" | "replay"> {
  const row = await d.db.portalUser.findUnique({ where: { id: userId }, select: { totpSecretEnc: true, totpEnabled: true } });
  if (!row?.totpEnabled || !row.totpSecretEnc) return "invalid";
  const secret = d.secrets.decrypt(row.totpSecretEnc, aadFor.portalTotpSecret(userId));
  const step = matchTotp(secret, code, now.getTime());
  if (step === null) return "invalid";
  const r = await d.db.portalUser.updateMany({
    where: { id: userId, totpEnabled: true, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
    data: { totpLastStep: BigInt(step) },
  });
  return r.count === 0 ? "replay" : "ok";
}

/** r2 S-P21-7: kodlu girişte (kısa ad|e-posta)+IP 5/5 dk ve hesap 15/15 dk — aşım 429. */
function hitLoginMfa(d: PortalDeps, pairKey: string, userId: string): void {
  const { mfaPair, mfaUser } = d.limits;
  const wait = Math.max(mfaPair.blockedFor(pairKey), mfaUser.blockedFor(userId));
  if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
  const pairHit = mfaPair.hit(pairKey);
  const userHit = mfaUser.hit(userId);
  if (pairHit || userHit)
    throw new AppError("RATE_LIMITED", { retryAfterSec: Math.max(mfaPair.blockedFor(pairKey), mfaUser.blockedFor(userId)) || 60 });
}

export interface PortalLoginResult extends OpenedPortalSession {
  context: PortalContext;
}

/**
 * POST /portal/auth/login (§5.2, tek istek): IP kovası → ikili kova (senkron) → firma kısa adı → hesap → argon2 (hesap
 * yoksa sahte hash) → kilit → şifre/etkinlik → geçici şifre süresi → TOTP → TX (kilitli yeniden okuma, sayaçlar sıfır,
 * önceki portal çerezinin oturumu iptal, yeni oturum, `last_login_at`, audit). `previousToken`: aynı tarayıcıdaki eski çerez.
 */
export async function portalLogin(
  d: PortalDeps,
  ctx: AuditContext,
  input: { email: string; tenantSlug: string; password: string; totpCode?: string | undefined },
  previousToken?: string,
): Promise<PortalLoginResult> {
  const ip = ipKey(ctx.ip);
  const ipWait = d.limits.ip.blockedFor(ip);
  if (ipWait > 0 || d.limits.ip.hit(ip)) {
    loginMetric(d, "fail", "rate_limited");
    throw new AppError("RATE_LIMITED", { retryAfterSec: ipWait || 60 });
  }
  const subject = `${input.tenantSlug}|${input.email}`;
  const pairKey = `${sha256Hex(subject)}|${ip}`; // sabit uzunluklu anahtar (S2-1)
  const pairWait = d.limits.pair.blockedFor(pairKey);
  const pairLocked = pairWait === 0 && d.limits.pair.hit(pairKey); // senkron: await'ten önce sayılır
  const tenant = await repo.findTenantBySlug(d.db, input.tenantSlug);
  const tenantOk = tenant !== null && tenant.status === "ACTIVE" && tenant.deletedAt === null;
  // Bilinmeyen/pasif kısa ad → olmayan hesapla aynı dal (ghost kovası `slug|e-posta`).
  const user = tenantOk ? await repo.findPortalUser(d.db, tenant.id, input.email) : null;
  const now = portalNow(d);
  const a: Attempt = { ctx, subject, email: input.email, tenantId: tenantOk ? tenant.id : null, user, pairLocked, now };
  const accWait = accountWait(d, a);
  const passwordOk = await verifyPassword(user?.passwordHash ?? null, input.password);

  if (pairWait > 0 || accWait > 0) return lockedLogin(d, a, Math.max(pairWait, accWait));
  if (!user || !passwordOk || !portalActive(user))
    return failLogin(d, a, user && passwordOk ? "inactive" : "invalid_credentials", BAD_CREDENTIALS);

  // 4b (r2 S-P21-5): parolayı bilen kişiye özel mesaj (panel G-P13b-10 kalıbı; oracle değil).
  if (user.mustChangePassword && user.tempPasswordExpiresAt !== null && user.tempPasswordExpiresAt <= now) {
    await writeAudit(d.db, ctx, {
      ...portalWho(user.tenantId, user.id, user.email),
      action: PORTAL_AUDIT.LOGIN,
      result: "fail",
      newValue: { reason: "temp_password_expired" },
    });
    loginMetric(d, "fail", "temp_password_expired");
    throw new AppError("UNAUTHENTICATED", { message: TEMP_PASSWORD_EXPIRED });
  }

  if (user.totpEnabled) {
    // Kodsuz istek: oturum açılmaz, DB hesap sayacı artmaz (ikili/IP kovası adım 1'de zaten bir hak tüketti).
    if (input.totpCode === undefined) {
      loginMetric(d, "mfa_required");
      throw new AppError("MFA_REQUIRED");
    }
    hitLoginMfa(d, pairKey, user.id);
    const check = await consumePortalTotp(d, user.id, input.totpCode, now);
    if (check !== "ok") return failLogin(d, a, check === "replay" ? "replayed_totp" : "invalid_totp", BAD_CODE);
  }

  d.limits.pair.reset(pairKey);
  d.limits.accountFallback.reset(user.id);
  d.limits.mfaPair.reset(pairKey);
  d.limits.mfaUser.reset(user.id);
  const opened = await d.db.$transaction(async (tx) => {
    // D-P27a-K3: TX dışındaki okuma eskimiş olabilir; karar kilitli güncel satırla.
    const fresh = await repo.lockPortalUser(tx, user.id);
    if (!fresh || fresh.passwordHash !== user.passwordHash || fresh.status !== "ACTIVE" || fresh.totpEnabled !== user.totpEnabled)
      return null;
    await tx.portalUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, failedWindowAt: null, lockedUntil: null, lastLoginAt: now },
      select: { id: true },
    });
    if (previousToken) await repo.revokePortalSessionByHash(tx, sha256Hex(previousToken), now);
    const s = await openPortalSession(tx, user, ctx, now);
    await writeAudit(tx, ctx, {
      ...portalWho(user.tenantId, user.id, user.email),
      action: PORTAL_AUDIT.LOGIN,
      result: "success",
      newValue: { sessionId: s.sessionId },
    });
    return s;
  });
  if (opened === null) {
    // Şifre/durum doğrulamadan sonra eşzamanlı değişti (Admin sıfırlaması, pasife alma): eski bilgiyle oturum yok.
    await writeAudit(d.db, ctx, {
      ...portalWho(user.tenantId, user.id, user.email),
      action: PORTAL_AUDIT.LOGIN,
      result: "fail",
      newValue: { reason: "invalid_credentials" },
    });
    loginMetric(d, "fail", "credentials_changed");
    throw new AppError("UNAUTHENTICATED", { message: BAD_CREDENTIALS });
  }
  loginMetric(d, "success");
  return { ...opened, context: portalContextOf(user, opened.sessionId, opened.expiresAt) };
}

/** POST /portal/auth/logout: bu oturum iptal + audit (`entity_id` = hesap, oturum `new_value.sessionId` — r2 S-P21-2). */
export async function portalLogout(d: PortalDeps, ctx: AuditContext, p: PortalContext): Promise<void> {
  await d.db.$transaction(async (tx) => {
    await repo.revokePortalSession(tx, p.sessionId, portalNow(d));
    await writeAudit(tx, ctx, { ...ctxWho(p), action: PORTAL_AUDIT.LOGOUT, result: "success", newValue: { sessionId: p.sessionId } });
  });
}

/**
 * POST /portal/account/password (§5.1): oturum başına 5 hatalı mevcut şifre → oturum iptal + 401 (deneme doğrulamadan önce
 * sayılır). Başarıda `must_change_password=0` + `temp_password_expires_at=NULL` (aynı UPDATE — CHECK), hesabın TÜM portal
 * oturumları iptal, mevcut oturum yeni token ile yenilenir (mutlak bitiş korunur).
 */
export async function portalChangePassword(
  d: PortalDeps,
  ctx: AuditContext,
  p: PortalContext,
  input: PasswordChangeInput,
): Promise<OpenedPortalSession> {
  const user = await repo.findPortalUserById(d.db, p.user.id);
  if (!user) throw new AppError("UNAUTHENTICATED");
  const { passwordChange } = d.limits;
  const exhausted = passwordChange.blockedFor(p.sessionId) > 0 || passwordChange.hit(p.sessionId);
  const base = { ...ctxWho(p), action: PORTAL_AUDIT.PASSWORD_CHANGE };
  if (!(await verifyPassword(user.passwordHash, input.current))) {
    await d.db.$transaction(async (tx) => {
      await writeAudit(tx, ctx, { ...base, result: "fail", newValue: { reason: exhausted ? "too_many_attempts" : "invalid_current" } });
      if (exhausted) await repo.revokePortalSession(tx, p.sessionId, portalNow(d));
    });
    if (exhausted) throw new AppError("UNAUTHENTICATED", { message: "Çok fazla hatalı deneme. Lütfen yeniden giriş yapın." });
    throw new AppError("VALIDATION", { fields: { current: "Mevcut şifre hatalı." } });
  }
  passwordChange.reset(p.sessionId);
  const passwordHash = await hashPassword(input.next);
  const now = portalNow(d);
  return d.db.$transaction(async (tx) => {
    await tx.portalUser.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null },
      select: { id: true },
    });
    const revoked = await repo.revokePortalUserSessions(tx, user.tenantId, user.id, now);
    const renewed = await openPortalSession(tx, user, ctx, now, p.expiresAt);
    await writeAudit(tx, ctx, { ...base, result: "success", newValue: { revokedSessions: revoked } });
    return renewed;
  });
}

/** PATCH /portal/me: tema tercihi kullanıcının kaydında (Projeler/CLAUDE.md §1.6); §4.5 olay listesinde yok → audit'e yazılmaz. */
export async function portalSetTheme(d: PortalDeps, p: PortalContext, theme: string): Promise<void> {
  await d.db.portalUser.update({ where: { id: p.user.id }, data: { theme }, select: { id: true } });
}

// ------------------------------------------------------------------ TOTP (isteğe bağlı, K-P21-5)

const conflict = (message: string): AppError => new AppError("CONFLICT", { message });

/** POST /portal/account/totp/setup: yeni sır şifreli yazılır (`totp_enabled=0`); etkinse 409. QR sunucuda (r2 S-P21-9). */
export async function portalTotpSetup(d: PortalDeps, p: PortalContext): Promise<PortalTotpSetupResponse> {
  hitLimit(d.limits.totpAccount, p.user.id);
  const secret = newTotpSecret();
  const r = await d.db.portalUser.updateMany({
    where: { id: p.user.id, totpEnabled: false },
    data: { totpSecretEnc: d.secrets.encrypt(secret, aadFor.portalTotpSecret(p.user.id)), totpLastStep: null },
  });
  if (r.count === 0) throw conflict("İki adımlı doğrulama zaten etkin.");
  const url = otpauthUrl(secret, p.user.email);
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 }) };
}

/** POST /portal/account/totp/enable: kod kurulumdaki sırla doğrulanır; UPDATE doğrulanan şifreli sıra bağlı (B-P10-6 kalıbı). */
export async function portalTotpEnable(d: PortalDeps, ctx: AuditContext, p: PortalContext, code: string): Promise<void> {
  hitLimit(d.limits.totpAccount, p.user.id);
  const row = await d.db.portalUser.findUniqueOrThrow({ where: { id: p.user.id }, select: { totpSecretEnc: true, totpEnabled: true } });
  if (row.totpEnabled) throw conflict("İki adımlı doğrulama zaten etkin.");
  if (!row.totpSecretEnc) throw conflict("Önce kurulumu başlatın.");
  const secret = d.secrets.decrypt(row.totpSecretEnc, aadFor.portalTotpSecret(p.user.id));
  const step = matchTotp(secret, code, portalNow(d).getTime());
  const base = { ...ctxWho(p), action: PORTAL_AUDIT.MFA_ENABLED };
  if (step === null) {
    await writeAudit(d.db, ctx, { ...base, result: "fail", newValue: { reason: "invalid_code" } });
    throw new AppError("VALIDATION", { fields: { code: "Kod hatalı veya süresi geçmiş." } });
  }
  await d.db.$transaction(async (tx) => {
    const r = await tx.portalUser.updateMany({
      where: { id: p.user.id, totpEnabled: false, totpSecretEnc: { equals: row.totpSecretEnc } },
      data: { totpEnabled: true, totpLastStep: BigInt(step) },
    });
    if (r.count === 0) throw conflict("Kurulum değişti veya iki adımlı doğrulama zaten etkin; sayfayı yenileyin.");
    // S-P21-K-1 (panel MFA etkinleştirme kalıbı): parolası ele geçmiş hesapta açık kalan diğer oturumlar düşer; mevcut oturum kalır.
    const revoked = await repo.revokeOtherPortalSessions(tx, p.scope.tenantId, p.user.id, p.sessionId, portalNow(d));
    await writeAudit(tx, ctx, { ...base, result: "success", newValue: { revokedSessions: revoked } });
  });
  d.limits.totpAccount.reset(p.user.id);
}

/** POST /portal/account/totp/disable: şifre + geçerli (tüketilmemiş) kod birlikte; sır ve son adım silinir. */
export async function portalTotpDisable(d: PortalDeps, ctx: AuditContext, p: PortalContext, input: PortalTotpDisableInput): Promise<void> {
  hitLimit(d.limits.totpAccount, p.user.id);
  const user = await repo.findPortalUserById(d.db, p.user.id);
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (!user.totpEnabled) throw conflict("İki adımlı doğrulama zaten kapalı.");
  const base = { ...ctxWho(p), action: PORTAL_AUDIT.MFA_DISABLED };
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await writeAudit(d.db, ctx, { ...base, result: "fail", newValue: { reason: "invalid_password" } });
    throw new AppError("VALIDATION", { fields: { password: "Şifre hatalı." } });
  }
  const row = await d.db.portalUser.findUniqueOrThrow({ where: { id: p.user.id }, select: { totpSecretEnc: true } });
  const secret = row.totpSecretEnc ? d.secrets.decrypt(row.totpSecretEnc, aadFor.portalTotpSecret(p.user.id)) : null;
  const step = secret ? matchTotp(secret, input.code, portalNow(d).getTime()) : null;
  const done = await d.db.$transaction(async (tx) => {
    if (step === null) return false;
    const r = await tx.portalUser.updateMany({
      where: { id: p.user.id, totpEnabled: true, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
      data: { totpEnabled: false, totpSecretEnc: null, totpLastStep: null },
    });
    if (r.count === 0) return false;
    await writeAudit(tx, ctx, { ...base, result: "success" });
    return true;
  });
  if (!done) {
    await writeAudit(d.db, ctx, { ...base, result: "fail", newValue: { reason: "invalid_code" } });
    throw new AppError("VALIDATION", { fields: { code: "Kod hatalı veya süresi geçmiş." } });
  }
  d.limits.totpAccount.reset(p.user.id);
}
