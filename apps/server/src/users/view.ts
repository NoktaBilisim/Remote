// Kullanıcı satırı → API görünümü (service.ts'ten taşındı, PT-K12).
import type { UserDetail, UserListItem, UserStatus } from "@remote/contracts/api/users";
import { PERMISSION_KEYS, type PermissionKey, type Role } from "@remote/contracts/permissions";
import type { AuthContext } from "../auth/session.ts";
import { avatarUrlFor } from "../uploads/urls.ts";
import { asManaged, effectiveOf, exceeding, sessionActor } from "./guard.ts";
import type * as repo from "./repo.ts";

export function toItem(r: repo.UserRow): UserListItem {
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    fullName: r.fullName,
    role: asManaged(r).role,
    status: r.status as UserStatus,
    mustChangePassword: r.mustChangePassword,
    totpEnabled: r.totpEnabled,
    avatarUrl: avatarUrlFor(r.avatarPath),
    lastLoginAt: r.authSessions[0]?.createdAt.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** `trustedDeviceCount`: P27a (AC-330) süresi dolmamış hatırlanan cihaz sayısı (`trusted-device-repo.countForUser`). */
export function toDetail(r: repo.UserRow, auth: AuthContext, trustedDeviceCount: number): UserDetail {
  const eff = effectiveOf(r.role as Role, r.permissions);
  const permissions = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, eff.has(k)])) as Record<PermissionKey, boolean>;
  return {
    ...toItem(r),
    version: r.version,
    permissions,
    isSelf: r.id === auth.user.id,
    canManage: exceeding(sessionActor(auth), eff).length === 0,
    trustedDeviceCount,
  };
}
