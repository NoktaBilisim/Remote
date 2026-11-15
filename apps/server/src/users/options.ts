// GET /users/options (P14b AC-225, P16 AC-241, P18 AC-256, P27 yetki ekranı): seçici listeleri. Yalnız id/ad/durum döner.
// Kapsam her zaman etkin tenant (firma seçmemiş Super Admin `?tenantId=`); SUPER_ADMIN hesapları listelenmez.
import { USER_OPTIONS_MAX, type UserOptionsQuery, type UserOptionsResponse, type UserStatus } from "@remote/contracts/api/users";
import { deletedUserLabel } from "@remote/contracts/audit";
import type { PermissionKey, Role } from "@remote/contracts/permissions";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { findTenant } from "../tenants/repo.ts";
import { canTakeRequests, effectiveOf } from "./guard.ts";
import * as repo from "./repo.ts";

/** Genel seçici (`unattendedGrantable` olmadan) için yeterli yetkilerden biri. */
export const USER_OPTIONS_PERMS: readonly PermissionKey[] = ["session_history.view", "support_requests.view", "users.view"];

/**
 * Kapsam (QA Tur 1, AC-225): etkin tenant her zaman önce gelir — firma seçili olan veya SUPER_ADMIN olmayan rollerde
 * `requested` yok sayılır (başka firmayı göremez). Firma seçmemiş SUPER_ADMIN `requested` ile firma seçer (silinmiş/olmayan
 * → 404); vermezse 403.
 */
export async function userOptionsTenant(db: Db, auth: AuthContext, requested: string | undefined): Promise<string> {
  if (auth.tenantId) return auth.tenantId;
  if (auth.user.role !== "SUPER_ADMIN" || !requested) throw new AppError("FORBIDDEN", { message: "Önce bir firma seçin." });
  if (!(await findTenant(db, requested))) throw new AppError("NOT_FOUND");
  return requested;
}

type Item = UserOptionsResponse["items"][number];
const item = (r: { id: string; fullName: string; status: string }): Item => ({
  id: r.id,
  fullName: r.fullName,
  status: r.status as UserStatus,
});

/** P18 (AC-256): atama seçicisi. `support_requests.assign` olan USER başkalarını da görür (atama yapabilmek için). */
async function assignableOptions(db: Db, auth: AuthContext, tenantId: string): Promise<UserOptionsResponse> {
  const own = auth.user.role === "USER" && !auth.permissions.has("support_requests.assign") ? auth.user.id : undefined;
  const rows = await repo.listAssignableCandidates(db, { tenantId }, USER_OPTIONS_MAX, own);
  return { items: rows.filter((r) => canTakeRequests(effectiveOf(r.role as Role, r.permissions))).map(item) };
}

/**
 * P27 (yetki ekranı): cihaz yetkisi verilebilecekler — ACTIVE, ADMIN|USER, etkin `unattended.connect` (sunucunun
 * `assertGrantable` kuralıyla aynı). Yalnız `unattended.manage` sahibi çağırır; USER'ın "yalnız kendisi" kuralı uygulanmaz.
 */
async function unattendedGrantableOptions(db: Db, tenantId: string): Promise<UserOptionsResponse> {
  const rows = await repo.listAssignableCandidates(db, { tenantId }, USER_OPTIONS_MAX);
  return { items: rows.filter((r) => effectiveOf(r.role as Role, r.permissions).has("unattended.connect")).map(item) };
}

/** Genel seçici (AC-225): USER rolü yalnız kendisi; P16 (AC-241) mezar taşları yalnız istenirse ve USER'da değil. */
async function filterOptions(db: Db, auth: AuthContext, tenantId: string, includeDeleted: boolean): Promise<UserOptionsResponse> {
  const self = auth.user.role === "USER" ? auth.user.id : undefined;
  const items = (await repo.listUserOptions(db, { tenantId }, USER_OPTIONS_MAX, self)).map(item);
  if (includeDeleted && !self) {
    const gone = await repo.listDeletedOptions(db, { tenantId }, Math.max(0, USER_OPTIONS_MAX - items.length));
    items.push(...gone.map((r) => ({ id: r.id, fullName: deletedUserLabel(r.id), status: "DELETED" as const })));
  }
  return { items };
}

/**
 * Uç girişi (uç `USER_OPTIONS_PERMS` ∨ `unattended.manage` ister). En az yetki: `unattendedGrantable=1` yalnız
 * `unattended.manage` ile; diğer listeler yalnız `USER_OPTIONS_PERMS`'ten biriyle (yalnız `manage` sahibi → 403).
 */
export async function userOptions(db: Db, auth: AuthContext, q: UserOptionsQuery): Promise<UserOptionsResponse> {
  const perms = auth.permissions;
  if (q.unattendedGrantable) {
    if (!perms.has("unattended.manage")) throw new AppError("FORBIDDEN");
    return unattendedGrantableOptions(db, await userOptionsTenant(db, auth, q.tenantId));
  }
  if (!USER_OPTIONS_PERMS.some((k) => perms.has(k))) throw new AppError("FORBIDDEN");
  const tenantId = await userOptionsTenant(db, auth, q.tenantId);
  return q.assignable ? assignableOptions(db, auth, tenantId) : filterOptions(db, auth, tenantId, q.includeDeleted);
}
