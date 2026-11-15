// Şifre sıfırlama (AC-66) ve kilit bildirimi (AC-65) (account.ts'ten taşındı, PT-K12).
import { RESET_PASSWORD_PATH, RESET_TOKEN_TTL_MIN, type PasswordResetInput } from "@remote/contracts/api/auth";
import { AUTH_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { accountLockedMail, passwordResetMail } from "../mail/templates.ts";
import type { AccountDeps } from "./account.ts";
import { MIN, hitLimit } from "./account-shared.ts";
import { hashPassword } from "./password.ts";
import * as repo from "./repo.ts";
import { canSignIn } from "./session.ts";
import { deleteForUser } from "./trusted-device-repo.ts";

const RESET_PER_ACCOUNT_HOUR = 3;

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
  await d.db.$transaction(async (tx) => issueResetToken(tx, ctx, base, user.id, token, now));
  const link = `${d.publicBaseUrl.replace(/\/+$/, "")}${RESET_PASSWORD_PATH}#token=${token}`;
  await d.mail.sendForTenant(
    ctx,
    { tenantId: user.tenantId, userId: user.id, username: user.email, kind: "password_reset", entity: "users", entityId: user.id },
    user.email,
    passwordResetMail({ link, ttlMin: RESET_TOKEN_TTL_MIN }),
    cfg,
  );
}

/** processForgot TX'i: eski açık token'lar kullanılmış sayılır, yenisi yazılır, başarı audit'i. */
async function issueResetToken(
  tx: Prisma.TransactionClient,
  ctx: AuditContext,
  base: Omit<Parameters<typeof writeAudit>[2], "result">,
  userId: string,
  token: string,
  now: Date,
): Promise<void> {
  await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  await tx.passwordResetToken.create({
    data: {
      id: newId(),
      userId,
      tokenHash: sha256Hex(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MIN * MIN),
    },
  });
  await writeAudit(tx, ctx, { ...base, result: "success" });
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
    const revokedTrustedDevices = await deleteForUser(tx, user.id); // P27a AC-328
    await writeAudit(tx, ctx, {
      tenantId: user.tenantId,
      userId: user.id,
      username: user.email,
      action: AUTH_AUDIT.PASSWORD_RESET,
      entity: "users",
      entityId: user.id,
      result: "success",
      newValue: { revokedSessions: revoked, revokedTrustedDevices },
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
