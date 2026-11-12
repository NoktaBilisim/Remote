// Opak DB oturumu (ADR-0008, mimari §5.1): 32 bayt token çerezde, DB'de yalnız SHA-256;
// mutlak 8 sa, boşta 30 dk; last_seen_at en çok 60 sn'de bir yazılır; her istekte DB doğrulaması.
import { effectivePermissions, ROLES, type PermissionKey, type Role } from "@remote/contracts/permissions";
import type { AuthUser, MfaStage, TenantRef, Theme } from "@remote/contracts/api/auth";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { createSession, findSessionByHash, touchSession, type LoginUser } from "./repo.ts";

export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface AuthContext {
  sessionId: string;
  /** Mutlak bitiş; şifre değişiminde yenilenen oturum bu süreyi uzatmaz. */
  expiresAt: Date;
  user: AuthUser;
  /** Etkin tenant: Super Admin geçişindeyse acting tenant, değilse kullanıcının tenant'ı. */
  tenantId: string | null;
  tenant: TenantRef | null;
  actingTenant: TenantRef | null;
  permissions: ReadonlySet<PermissionKey>;
  /** P10 (AC-67): 2FA aşaması; `ok` dışındaki oturum yalnız izinli auth uçlarına erişir. */
  mfaStage: MfaStage;
  mfaRequired: boolean;
  totpEnabled: boolean;
}

/** AC-67: SUPER_ADMIN/ADMIN her zaman; USER tenant `require_tech_2fa` ile (ayar satırı yoksa varsayılan true). */
export function mfaRequiredFor(u: LoginUser): boolean {
  if (u.role !== "USER") return true;
  return u.tenant?.settings?.requireTech2fa ?? true;
}

/**
 * 2FA aşaması. `setupEnforced` uygulama örneğine aittir (`app.mfaSetupEnforced`; buildApp `mfaSetupEnforcement`,
 * production'da `false` reddedilir — B-P10-3). `false` yalnız P1–P9 entegrasyon testlerinde: Admin hesapları 2FA kurulum
 * aşamasına düşmesin. Etkin 2FA'nın doğrulama aşaması her zaman uygulanır.
 */
export function mfaStageOf(u: LoginUser, mfaPassed: boolean, setupEnforced: boolean): MfaStage {
  if (u.totpEnabled) return mfaPassed ? "ok" : "verify";
  return setupEnforced && mfaRequiredFor(u) ? "setup" : "ok";
}

/** Oturum çözümleme politikası: `setupEnforced` = `app.mfaSetupEnforced`; `allowPartial` yalnız REST guard'ı. */
export interface SessionPolicy {
  setupEnforced: boolean;
  allowPartial?: boolean;
}

type TenantRow = { id: string; name: string; slug: string; status: string; deletedAt: Date | null };

function asRole(value: string): Role {
  const role = ROLES.find((r) => r === value);
  if (!role) throw new Error(`Bilinmeyen rol: ${value}`);
  return role;
}

const toTenantRef = (t: TenantRow | null): TenantRef | null => (t ? { id: t.id, name: t.name, slug: t.slug } : null);

const tenantActive = (t: TenantRow | null): boolean => t !== null && t.status === "ACTIVE" && t.deletedAt === null;

export function toAuthUser(u: LoginUser): AuthUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    fullName: u.fullName,
    role: asRole(u.role),
    tenantId: u.tenantId,
    theme: u.theme as Theme,
    mustChangePassword: u.mustChangePassword,
  };
}

/** Kullanıcı aktif ve (Super Admin değilse) tenant'ı aktif mi. */
export function canSignIn(u: LoginUser): boolean {
  if (u.status !== "ACTIVE" || u.deletedAt !== null) return false;
  return u.tenantId === null || tenantActive(u.tenant);
}

export async function openSession(
  tx: Prisma.TransactionClient,
  userId: string,
  meta: { ip: string; userAgent: string },
  now: Date,
  expiresAt: Date = new Date(now.getTime() + SESSION_ABSOLUTE_MS),
  mfaPassed = true,
): Promise<{ token: string; csrfToken: string; expiresAt: Date; sessionId: string }> {
  const id = newId();
  const token = newSecretToken();
  await createSession(tx, {
    id,
    userId,
    tokenHash: sha256Hex(token),
    ip: meta.ip.slice(0, 45),
    userAgent: meta.userAgent.slice(0, 300),
    lastSeenAt: now,
    expiresAt,
    mfaPassed, // P10: 2FA etkin kullanıcıda girişte false → /auth/mfa/verify
  });
  return { token, csrfToken: newSecretToken(), expiresAt, sessionId: id };
}

/**
 * Geçersiz/süresi dolmuş/iptal edilmiş oturum veya pasif kullanıcı/tenant → null. `allowPartial` yalnız REST guard'ı
 * (2FA aşaması `ok` olmayan oturumu izinli uçlar için döndürür); WS ve diğer çağıranlarda yarım oturum null (AC-67).
 */
export async function resolveSession(db: Db, token: string, now: Date, policy: SessionPolicy): Promise<AuthContext | null> {
  const s = await findSessionByHash(db, sha256Hex(token));
  if (!s || s.revokedAt !== null || s.expiresAt <= now) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > SESSION_IDLE_MS) return null;
  if (!canSignIn(s.user)) return null;
  const mfaStage = mfaStageOf(s.user, s.mfaPassed, policy.setupEnforced);
  if (mfaStage !== "ok" && !policy.allowPartial) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) await touchSession(db, s.id, now);

  const user = toAuthUser(s.user);
  const acting = s.user.role === "SUPER_ADMIN" && tenantActive(s.actingTenant) ? s.actingTenant : null;
  return {
    sessionId: s.id,
    expiresAt: s.expiresAt,
    user,
    tenantId: acting?.id ?? s.user.tenantId,
    tenant: toTenantRef(s.user.tenant),
    actingTenant: toTenantRef(acting),
    permissions: new Set(effectivePermissions(user.role, s.user.permissions)),
    mfaStage,
    mfaRequired: mfaRequiredFor(s.user),
    totpEnabled: s.user.totpEnabled,
  };
}
