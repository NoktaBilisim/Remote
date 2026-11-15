// P13b `reset-superadmin` servisi (mimari-p13 §7.7; AC-90). Yalnız sunucudaki CLI çağırır (HTTP ucu yok).
// Tek TX: parola + bayraklar, açık oturumlar ve sıfırlama bağlantıları, isteğe bağlı 2FA, audit. Geçici parola yalnız
// dönüş değerinde taşınır; audit'e, loga ve hata mesajına girmez.
import { AUTH_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { newId, newTemporaryPassword } from "../lib/ids.ts";
import { hashPassword } from "./password.ts";

/** Geçici parola uzunluğu (karışmayan 56 sembol × 20 ≈ 116 bit; politika ≥ 12). */
export const SUPERADMIN_TEMP_PASSWORD_LENGTH = 20;
export const CLI_USERNAME = "cli";
export const CLI_USER_AGENT = "reset-superadmin-cli";
/** G-P13b-10: CLI geçici parolasının ömrü; aşılınca giriş reddedilir, CLI yeniden çalıştırılır. */
export const SUPERADMIN_TEMP_TTL_MS = 24 * 3_600_000;

export interface SuperadminResetInput {
  /** Login ile aynı normalizasyon: trim + küçük harf (S1-8: '@' içeren girdi yalnız e-posta). */
  email: string;
  resetMfa: boolean;
  dryRun: boolean;
}

export type SuperadminResetResult =
  | { kind: "not_found" }
  | { kind: "dry_run"; userId: string }
  | { kind: "reset"; userId: string; tempPassword: string; revokedSessions: number; mfaReset: boolean };

export const normalizeLoginEmail = (email: string): string => email.trim().toLowerCase();

/** Sistem aktörü bağlamı: IP yok (audit ekranında boş), UA sabit; correlation = çalıştırma kimliği. */
export const cliAuditContext = (): AuditContext => ({ ip: "", userAgent: CLI_USER_AGENT, requestId: newId() });

const eligible = { role: "SUPER_ADMIN", deletedAt: null, status: "ACTIVE" } as const;

/**
 * Bulunamazsa (ya da hesap SUPER_ADMIN/aktif/silinmemiş değilse) `not_found`; başka hesap bilgisi dönmez. Gerçek
 * çalıştırmada bu durum `result=fail` audit'i bırakır, dry-run hiçbir şey yazmaz. Uygunluk TX içinde koşullu UPDATE ile
 * yeniden denetlenir (arada rol/durum değişirse değişiklik yapılmaz).
 */
export async function resetSuperadmin(db: Db, ctx: AuditContext, input: SuperadminResetInput): Promise<SuperadminResetResult> {
  const email = normalizeLoginEmail(input.email);
  const user = await db.user.findFirst({ where: { email, ...eligible }, select: { id: true } });
  if (input.dryRun) return user ? { kind: "dry_run", userId: user.id } : { kind: "not_found" };
  if (!user) {
    await auditNotFound(db, ctx);
    return { kind: "not_found" };
  }

  const tempPassword = newTemporaryPassword(SUPERADMIN_TEMP_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(tempPassword); // argon2 TX dışında (kilit süresi kısa kalır)
  const out = await db.$transaction(async (tx) => {
    const now = new Date();
    const mfa = input.resetMfa ? { totpEnabled: false, totpSecretEnc: null, totpLastStep: null } : {};
    const updated = await tx.user.updateMany({
      where: { id: user.id, ...eligible },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, failedWindowAt: null, lockedUntil: null, ...mfa },
    });
    if (updated.count !== 1) return null;
    const sessions = await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    if (input.resetMfa) await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
    const newValue = { mustChangePassword: true, mfaReset: input.resetMfa, revokedSessions: sessions.count };
    await writeAudit(tx, ctx, {
      tenantId: null,
      userId: null,
      username: CLI_USERNAME,
      action: AUTH_AUDIT.SUPERADMIN_RESET,
      entity: "users",
      entityId: user.id,
      result: "success",
      newValue,
    });
    return sessions.count;
  });
  if (out === null) {
    await auditNotFound(db, ctx);
    return { kind: "not_found" };
  }
  return { kind: "reset", userId: user.id, tempPassword, revokedSessions: out, mfaReset: input.resetMfa };
}

/**
 * G-P13b-10: `must_change_password` bekleyen Super Admin'in parolası CLI ile verildiyse (son başarılı
 * `auth.superadmin_reset` kaydı) ve 24 saatten eskiyse true. Ayrı sütun yerine append-only audit kaydı kullanılır:
 * parolayı değiştiren diğer bütün yollar `must_change_password`'ü kapatır, bu yüzden bayrak açıkken son parola CLI'nindir.
 */
export async function superadminTempPasswordExpired(db: Db | Prisma.TransactionClient, userId: string, now: Date): Promise<boolean> {
  const last = await db.auditLog.findFirst({
    where: { tenantId: null, entity: "users", entityId: userId, action: AUTH_AUDIT.SUPERADMIN_RESET, result: "success" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last !== null && now.getTime() - last.createdAt.getTime() > SUPERADMIN_TEMP_TTL_MS;
}

function auditNotFound(db: Db, ctx: AuditContext): Promise<void> {
  return writeAudit(db, ctx, {
    tenantId: null,
    userId: null,
    username: CLI_USERNAME,
    action: AUTH_AUDIT.SUPERADMIN_RESET,
    entity: "users",
    entityId: null,
    result: "fail",
    newValue: { reason: "not_found" },
  });
}
