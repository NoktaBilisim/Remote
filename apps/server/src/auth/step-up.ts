// Step-up ve kurtarma kodu yenileme (account.ts'ten taşındı, PT-K12; P14a AC-215, P15 AC-231).
import { RECOVERY_CODE_COUNT, STEP_UP_MAX_AGE_SEC, type StepUpData, type StepUpResponse } from "@remote/contracts/api/auth";
import { AUTH_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { recoveryCodeUsedMail } from "../mail/templates.ts";
import type { AccountDeps } from "./account.ts";
import { consumeSecondFactor, hitMfaLimit, resetMfaLimit, who } from "./account-shared.ts";
import { newRecoveryCode, recoveryCodeHash } from "./mfa.ts";
import type { AuthContext } from "./session.ts";

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
  const out = await d.db.$transaction(async (tx) => stepUpTx(d, tx, ctx, auth, input, factor, now));
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

/** stepUp TX'i: faktör tüketimi + `step_up_at` + başarı audit'i; başarısızsa tüketim sonucunu döner. */
async function stepUpTx(
  d: AccountDeps,
  tx: Prisma.TransactionClient,
  ctx: AuditContext,
  auth: AuthContext,
  input: StepUpData,
  factor: { totp: string } | { recovery: string },
  now: Date,
): Promise<number | "invalid" | "replay"> {
  const userId = auth.user.id;
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
