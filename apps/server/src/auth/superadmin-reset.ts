// P13b `reset-superadmin` servisi (mimari-p13 §7.7; AC-90). CLI ve P15 (AC-232) panel ucu aynı çekirdeği kullanır.
// Tek TX: parola + bayraklar, açık oturumlar ve sıfırlama bağlantıları, isteğe bağlı 2FA, audit. Geçici parola yalnız
// dönüş değerinde taşınır; audit'e, loga ve hata mesajına girmez.
import { AUTH_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { newId, newTemporaryPassword } from "../lib/ids.ts";
import { hashPassword } from "./password.ts";
import { deleteForUser } from "./trusted-device-repo.ts";

/** Geçici parola uzunluğu (karışmayan 56 sembol × 20 ≈ 116 bit; politika ≥ 12). */
const SUPERADMIN_TEMP_PASSWORD_LENGTH = 20;
const CLI_USERNAME = "cli";
const CLI_USER_AGENT = "reset-superadmin-cli";
/** G-P13b-10: CLI geçici parolasının ömrü; aşılınca giriş reddedilir, CLI yeniden çalıştırılır. */
const SUPERADMIN_TEMP_TTL_MS = 24 * 3_600_000;

export interface SuperadminResetInput {
  /** Login ile aynı normalizasyon: trim + küçük harf (S1-8: '@' içeren girdi yalnız e-posta). */
  email: string;
  resetMfa: boolean;
  dryRun: boolean;
}

type SuperadminResetResult =
  | { kind: "not_found" }
  | { kind: "dry_run"; userId: string }
  | { kind: "reset"; userId: string; tempPassword: string; revokedSessions: number; mfaReset: boolean };

const normalizeLoginEmail = (email: string): string => email.trim().toLowerCase();

/** Sistem aktörü bağlamı: IP yok (audit ekranında boş), UA sabit; correlation = çalıştırma kimliği. */
export const cliAuditContext = (): AuditContext => ({ ip: "", userAgent: CLI_USER_AGENT, requestId: newId() });

const eligible = { role: "SUPER_ADMIN", deletedAt: null, status: "ACTIVE" } as const;

/** Audit aktörü: CLI (`username="cli"`, user_id NULL) ya da panel (P15: işlemi yapan Super Admin). */
interface ResetActor {
  userId: string | null;
  username: string;
  via: "cli" | "panel";
}
const CLI_ACTOR: ResetActor = { userId: null, username: CLI_USERNAME, via: "cli" };

type ResetCoreResult = { kind: "not_found" } | { kind: "reset"; tempPassword: string; revokedSessions: number };

/**
 * Ortak çekirdek (CLI + P15 panel ucu; kopya yok): tek TX'te parola + `must_change_password` + kilit sayaçları, açık
 * oturumlar ve sıfırlama bağlantıları, isteğe bağlı 2FA, audit `auth.superadmin_reset`. Uygunluk (etkin, silinmemiş
 * SUPER_ADMIN) TX içinde koşullu UPDATE ile yeniden denetlenir; tutmazsa `not_found` (+ fail audit).
 */
export async function resetSuperadminById(
  db: Db,
  ctx: AuditContext,
  actor: ResetActor,
  userId: string,
  resetMfa: boolean,
): Promise<ResetCoreResult> {
  const tempPassword = newTemporaryPassword(SUPERADMIN_TEMP_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(tempPassword); // argon2 TX dışında (kilit süresi kısa kalır)
  const out = await db.$transaction(async (tx) => {
    const now = new Date();
    const mfa = resetMfa ? { totpEnabled: false, totpSecretEnc: null, totpLastStep: null } : {};
    const updated = await tx.user.updateMany({
      where: { id: userId, ...eligible },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, failedWindowAt: null, lockedUntil: null, ...mfa },
    });
    if (updated.count !== 1) return null;
    const sessions = await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    if (resetMfa) await tx.recoveryCode.deleteMany({ where: { userId } });
    // P27a AC-328: Super Admin satırı yapısal olarak oluşamaz (K-P27a-2); savunma amaçlı, sayı audit'te.
    const revokedTrustedDevices = await deleteForUser(tx, userId);
    const newValue = {
      mustChangePassword: true,
      mfaReset: resetMfa,
      revokedSessions: sessions.count,
      revokedTrustedDevices,
      ...(actor.via === "panel" ? { via: "panel" } : {}),
    };
    await writeAudit(tx, ctx, {
      tenantId: null,
      userId: actor.userId,
      username: actor.username,
      action: AUTH_AUDIT.SUPERADMIN_RESET,
      entity: "users",
      entityId: userId,
      result: "success",
      newValue,
    });
    return sessions.count;
  });
  if (out === null) {
    await auditNotFound(db, ctx, actor);
    return { kind: "not_found" };
  }
  return { kind: "reset", tempPassword, revokedSessions: out };
}

/**
 * Bulunamazsa (ya da hesap SUPER_ADMIN/aktif/silinmemiş değilse) `not_found`; başka hesap bilgisi dönmez. Gerçek
 * çalıştırmada bu durum `result=fail` audit'i bırakır, dry-run hiçbir şey yazmaz.
 */
export async function resetSuperadmin(db: Db, ctx: AuditContext, input: SuperadminResetInput): Promise<SuperadminResetResult> {
  const email = normalizeLoginEmail(input.email);
  const user = await db.user.findFirst({ where: { email, ...eligible }, select: { id: true } });
  if (input.dryRun) return user ? { kind: "dry_run", userId: user.id } : { kind: "not_found" };
  if (!user) {
    await auditNotFound(db, ctx, CLI_ACTOR);
    return { kind: "not_found" };
  }
  const r = await resetSuperadminById(db, ctx, CLI_ACTOR, user.id, input.resetMfa);
  if (r.kind === "not_found") return r;
  return { kind: "reset", userId: user.id, tempPassword: r.tempPassword, revokedSessions: r.revokedSessions, mfaReset: input.resetMfa };
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

function auditNotFound(db: Db, ctx: AuditContext, actor: ResetActor): Promise<void> {
  return writeAudit(db, ctx, {
    tenantId: null,
    userId: actor.userId,
    username: actor.username,
    action: AUTH_AUDIT.SUPERADMIN_RESET,
    entity: "users",
    entityId: null,
    result: "fail",
    newValue: { reason: "not_found" },
  });
}
