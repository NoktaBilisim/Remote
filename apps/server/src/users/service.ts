// Kullanıcı ve yetki yönetimi (P9; mimari-api "Yönetim", AC-71..74, AC-115, G-04; ortak standart 1.3).
// Kurallar:
//  - Kapsam: etkin tenant (Super Admin firma seçmiş olmalı); SUPER_ADMIN hesapları bu uçlarda yok (404).
//  - AC-73: işlemi yapan kendisinde olmayan yetkiyi veremez/değiştiremez (etkin kümede değişen her anahtar
//    işlemi yapanda olmalı; ADMIN rolüne geçişin varsayılanı da "verme" sayılır) → 403.
//  - Üstünlük: Admin, etkin yetkileri kendi kümesini aşan hesabı yönetemez (PATCH/pasif/aktif) → 403 (`canManage`).
//  - Kendi hesabı: rol/yetki değiştirilemez, pasife alınamaz → 403 (ad/e-posta serbest).
//  - Ezme satırları normalize: yalnız rol varsayılanından farklı anahtarlar saklanır (yeni anahtar ADMIN'de açık,
//    USER'da kapalı başlar — AC-72/73).
//  - AC-74: etkin kümede değişen her anahtar için ayrı audit satırı (kim → kime, permKey, eski → yeni), aynı TX.
//  - AC-115 / G-04: commit SONRASI canlı yansıma — pasif/rol değişimi → `rooms.endByTechnician` + panel 4401;
//    yalnız yetki değişimi → `rooms.applyPermChange` (+ `support_requests.view` kalktıysa panel 4401).
import type { CreateUserData, CreateUserResponse, ListUsersQuery, ManagedRole, UpdateUserData, UserDetail, UserListItem, UserListResponse, UserStatus } from "@remote/contracts/api/users";
import { TEMPORARY_PASSWORD_LENGTH, USER_EMAIL_CONFLICT_MESSAGE } from "@remote/contracts/api/users";
import { USER_AUDIT } from "@remote/contracts/audit";
import { PERMISSION_KEYS, effectivePermissions, roleDefaultGranted, type PermissionKey, type Role } from "@remote/contracts/permissions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { hashPassword } from "../auth/password.ts";
import type { AuthContext } from "../auth/session.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newTemporaryPassword } from "../lib/ids.ts";
import * as repo from "./repo.ts";

const ENTITY = "users";
const EMAIL_UQ = "users_email_key";

/** Commit sonrası canlı yansıma için gereken dar arayüz (app.rooms + app.requestHub). */
export interface UserLiveEffects {
  rooms: {
    endByTechnician(userId: string): Promise<void>;
    applyPermChange(userId: string, permissions: Iterable<PermissionKey>): Promise<void>;
  };
  hub: { closeByUser(userId: string): number };
  log: { error(obj: object, msg: string): void };
}

type ManagedRow = repo.UserRow & { role: ManagedRole };

const asManaged = (r: repo.UserRow): ManagedRow => r as ManagedRow;

const who = (auth: AuthContext, tenantId: string) => ({ tenantId, userId: auth.user.id, username: auth.user.email });

const emailConflict = (): AppError => new AppError("CONFLICT", { message: USER_EMAIL_CONFLICT_MESSAGE, fields: { email: USER_EMAIL_CONFLICT_MESSAGE } });

function effectiveOf(role: Role, rows: readonly { permKey: string; granted: boolean }[]): Set<PermissionKey> {
  return new Set(effectivePermissions(role, rows));
}

/** Admin, etkin yetkileri kendi kümesini aşan hesabı yönetemez; Super Admin her zaman. */
function canManage(auth: AuthContext, target: Set<PermissionKey>): boolean {
  if (auth.user.role === "SUPER_ADMIN") return true;
  for (const k of target) if (!auth.permissions.has(k)) return false;
  return true;
}

function toItem(r: repo.UserRow): UserListItem {
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    fullName: r.fullName,
    role: asManaged(r).role,
    status: r.status as UserStatus,
    mustChangePassword: r.mustChangePassword,
    totpEnabled: r.totpEnabled,
    lastLoginAt: r.authSessions[0]?.createdAt.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function toDetail(r: repo.UserRow, auth: AuthContext): UserDetail {
  const eff = effectiveOf(r.role as Role, r.permissions);
  const permissions = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, eff.has(k)])) as Record<PermissionKey, boolean>;
  return { ...toItem(r), permissions, isSelf: r.id === auth.user.id, canManage: canManage(auth, eff) };
}

/**
 * İstenen yetki haritasını mevcut ezmelerin üstüne uygular, rol varsayılanına eşit satırları atar (normalize).
 * Tanım dışı eski anahtarlar düşer.
 */
function normalizeRows(role: ManagedRole, current: readonly { permKey: string; granted: boolean }[], requested: Readonly<Record<string, boolean>> | undefined) {
  const known: ReadonlySet<string> = new Set(PERMISSION_KEYS);
  const merged = new Map<string, boolean>();
  for (const r of current) if (known.has(r.permKey)) merged.set(r.permKey, r.granted);
  for (const [k, v] of Object.entries(requested ?? {})) merged.set(k, v);
  const def = roleDefaultGranted(role);
  return [...merged].filter(([, v]) => v !== def).map(([permKey, granted]) => ({ permKey, granted }));
}

/** Etkin kümede değişen anahtarlar (sabit sıra: tanım sırası). */
function diffKeys(before: ReadonlySet<PermissionKey>, after: ReadonlySet<PermissionKey>): PermissionKey[] {
  return PERMISSION_KEYS.filter((k) => before.has(k) !== after.has(k));
}

/** AC-73: değişen her anahtar işlemi yapanda olmalı (Super Admin tümüne sahip). */
function assertGrantable(auth: AuthContext, changed: readonly PermissionKey[]): void {
  const missing = changed.filter((k) => !auth.permissions.has(k));
  if (missing.length === 0) return;
  throw new AppError("FORBIDDEN", {
    message: "Sahip olmadığınız bir yetkiyi veremez veya değiştiremezsiniz.",
    fields: Object.fromEntries(missing.map((k) => [`permissions.${k}`, "Bu yetkiye sahip değilsiniz"])),
  });
}

async function permissionAudits(tx: Parameters<typeof writeAudit>[0], ctx: AuditContext, auth: AuthContext, tenantId: string, targetId: string, before: ReadonlySet<PermissionKey>, after: ReadonlySet<PermissionKey>): Promise<void> {
  for (const permKey of diffKeys(before, after)) {
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: USER_AUDIT.PERMISSION_CHANGED,
      entity: ENTITY,
      entityId: targetId,
      result: "success",
      oldValue: { permKey, granted: before.has(permKey) },
      newValue: { permKey, granted: after.has(permKey) },
    });
  }
}

async function loadOrThrow(db: Db, scope: repo.TenantScope, id: string): Promise<repo.UserRow> {
  const row = await repo.findUser(db, scope, id);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

// ---------------------------------------------------------------------------------------------------------------

export async function listUsers(db: Db, tenantId: string, q: ListUsersQuery): Promise<UserListResponse> {
  const { rows, total } = await repo.listUsers(db, { tenantId }, q);
  return { items: rows.map(toItem), page: q.page, pageSize: q.pageSize, total };
}

export async function getUser(db: Db, auth: AuthContext, tenantId: string, id: string): Promise<UserDetail> {
  return toDetail(await loadOrThrow(db, { tenantId }, id), auth);
}

export async function createUser(db: Db, ctx: AuditContext, auth: AuthContext, tenantId: string, input: CreateUserData): Promise<CreateUserResponse> {
  const rows = normalizeRows(input.role, [], input.permissions);
  const after = effectiveOf(input.role, rows);
  assertGrantable(auth, [...after]);
  const temporaryPassword = newTemporaryPassword(TEMPORARY_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(temporaryPassword);
  const id = newId();
  try {
    await db.$transaction(async (tx) => {
      await repo.insertUser(tx, { id, tenantId, email: input.email, fullName: input.fullName, role: input.role, passwordHash, mustChangePassword: true });
      await repo.replacePermissions(tx, id, rows);
      await writeAudit(tx, ctx, { ...who(auth, tenantId), action: USER_AUDIT.CREATED, entity: ENTITY, entityId: id, result: "success", newValue: { email: input.email, fullName: input.fullName, role: input.role, status: "ACTIVE" } });
      await permissionAudits(tx, ctx, auth, tenantId, id, effectiveOf(input.role, []), after);
    });
  } catch (err) {
    if (conflictIndex(err) === EMAIL_UQ) throw emailConflict();
    throw err;
  }
  return { user: await getUser(db, auth, tenantId, id), temporaryPassword };
}

export async function updateUser(db: Db, fx: UserLiveEffects, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string, input: UpdateUserData): Promise<UserDetail> {
  const scope = { tenantId };
  let outcome: { roleChanged: boolean; before: Set<PermissionKey>; after: Set<PermissionKey> };
  try {
    outcome = await db.$transaction(async (tx) => {
      if (!(await repo.lockUser(tx, scope, id))) throw new AppError("NOT_FOUND");
      const cur = asManaged((await repo.findUser(tx, scope, id)) as repo.UserRow);
      const before = effectiveOf(cur.role, cur.permissions);
      if (!canManage(auth, before)) throw new AppError("FORBIDDEN", { message: "Sizden daha geniş yetkili bir hesabı düzenleyemezsiniz." });
      const role = input.role ?? cur.role;
      const rows = normalizeRows(role, cur.permissions, input.permissions);
      const after = effectiveOf(role, rows);
      const changed = diffKeys(before, after);
      const roleChanged = role !== cur.role;
      if (cur.id === auth.user.id && (roleChanged || changed.length > 0)) throw new AppError("FORBIDDEN", { message: "Kendi rolünüzü veya yetkilerinizi değiştiremezsiniz." });
      assertGrantable(auth, changed);

      const fields: Record<string, string> = {};
      const old: Record<string, string> = {};
      if (input.email !== undefined && input.email !== cur.email) [fields.email, old.email] = [input.email, cur.email];
      if (input.fullName !== undefined && input.fullName !== cur.fullName) [fields.fullName, old.fullName] = [input.fullName, cur.fullName];
      if (roleChanged) [fields.role, old.role] = [role, cur.role];
      if (Object.keys(fields).length > 0) {
        await repo.updateUser(tx, id, fields);
        await writeAudit(tx, ctx, { ...who(auth, tenantId), action: USER_AUDIT.UPDATED, entity: ENTITY, entityId: id, result: "success", oldValue: old, newValue: fields });
      }
      if (input.permissions !== undefined || roleChanged) await repo.replacePermissions(tx, id, rows);
      await permissionAudits(tx, ctx, auth, tenantId, id, before, after);
      return { roleChanged, before, after };
    });
  } catch (err) {
    if (conflictIndex(err) === EMAIL_UQ) throw emailConflict();
    throw err;
  }
  await liveAfterUpdate(fx, id, outcome);
  return getUser(db, auth, tenantId, id);
}

/** AC-115 / G-04 / G-E9-14: commit sonrası; hata loglanır (60 sn yeniden doğrulama yedek yoldur), yanıt bozulmaz. */
async function liveAfterUpdate(fx: UserLiveEffects, id: string, o: { roleChanged: boolean; before: Set<PermissionKey>; after: Set<PermissionKey> }): Promise<void> {
  try {
    if (o.roleChanged) {
      await fx.rooms.endByTechnician(id);
      fx.hub.closeByUser(id);
      return;
    }
    if (diffKeys(o.before, o.after).length === 0) return;
    await fx.rooms.applyPermChange(id, o.after);
    if (o.before.has("support_requests.view") && !o.after.has("support_requests.view")) fx.hub.closeByUser(id);
  } catch (err) {
    fx.log.error({ err, alarm: "user_live_effect" }, "yetki değişikliği canlı oturuma yansıtılamadı (yedek: 60 sn doğrulama)");
  }
}

async function setStatus(db: Db, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string, next: UserStatus): Promise<void> {
  const scope = { tenantId };
  await db.$transaction(async (tx) => {
    if (!(await repo.lockUser(tx, scope, id))) throw new AppError("NOT_FOUND");
    const cur = asManaged((await repo.findUser(tx, scope, id)) as repo.UserRow);
    if (cur.id === auth.user.id) throw new AppError("FORBIDDEN", { message: "Kendi hesabınızın durumunu değiştiremezsiniz." });
    if (!canManage(auth, effectiveOf(cur.role, cur.permissions))) throw new AppError("FORBIDDEN", { message: "Sizden daha geniş yetkili bir hesabı yönetemezsiniz." });
    if (cur.status === next) throw new AppError("CONFLICT", { message: next === "PASSIVE" ? "Kullanıcı zaten pasif." : "Kullanıcı zaten aktif." });
    const now = new Date();
    await repo.updateUser(tx, id, next === "ACTIVE" ? { status: next, failedLoginCount: 0, failedWindowAt: null, lockedUntil: null } : { status: next });
    const extra: Record<string, number> = {};
    if (next === "PASSIVE") {
      extra.revokedSessions = await repo.revokeUserSessions(tx, id, now);
      extra.cancelledSessions = await repo.cancelPendingOfTechnician(tx, scope, id, now);
    }
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: next === "PASSIVE" ? USER_AUDIT.DEACTIVATED : USER_AUDIT.REACTIVATED,
      entity: ENTITY,
      entityId: id,
      result: "success",
      oldValue: { status: cur.status },
      newValue: { status: next, ...extra },
    });
  });
}

/** POST /users/:id/deactivate (AC-115, G-04): oturumlar iptal, bekleyen kod oturumları iptal, canlı odalar biter. */
export async function deactivateUser(db: Db, fx: UserLiveEffects, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<void> {
  await setStatus(db, ctx, auth, tenantId, id, "PASSIVE");
  try {
    await fx.rooms.endByTechnician(id);
    fx.hub.closeByUser(id);
  } catch (err) {
    fx.log.error({ err, alarm: "user_live_effect" }, "pasife alma canlı oturuma yansıtılamadı (yedek: 60 sn doğrulama)");
  }
}

/** POST /users/:id/reactivate: hesap kilit sayaçları sıfırlanır; şifre değişmez. */
export async function reactivateUser(db: Db, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<void> {
  await setStatus(db, ctx, auth, tenantId, id, "ACTIVE");
}

/**
 * POST /users/:id/reset-mfa (P10; AC-67, AC-115, G-04): tek TX'te sır/etkinlik/son adım NULL (üçü birlikte — CHECK),
 * kurtarma kodları silinir, oturumlar iptal; commit sonrası canlı odalar biter. Kendi hesabı / daha geniş yetkili hesap
 * 403; 2FA hiç kurulmamışsa 409. Kullanıcı bir sonraki girişte (zorunluysa) yeniden kurar.
 */
export async function resetUserMfa(db: Db, fx: UserLiveEffects, ctx: AuditContext, auth: AuthContext, tenantId: string, id: string): Promise<void> {
  const scope = { tenantId };
  await db.$transaction(async (tx) => {
    if (!(await repo.lockUser(tx, scope, id))) throw new AppError("NOT_FOUND");
    const cur = asManaged((await repo.findUser(tx, scope, id)) as repo.UserRow);
    if (cur.id === auth.user.id) throw new AppError("FORBIDDEN", { message: "Kendi iki adımlı doğrulamanızı sıfırlayamazsınız." });
    if (!canManage(auth, effectiveOf(cur.role, cur.permissions))) throw new AppError("FORBIDDEN", { message: "Sizden daha geniş yetkili bir hesabı yönetemezsiniz." });
    const row = await tx.user.findUniqueOrThrow({ where: { id }, select: { totpEnabled: true, totpSecretEnc: true } });
    if (!row.totpEnabled && row.totpSecretEnc === null) throw new AppError("CONFLICT", { message: "Bu kullanıcıda iki adımlı doğrulama kurulu değil." });
    const now = new Date();
    await tx.user.update({ where: { id }, data: { totpSecretEnc: null, totpEnabled: false, totpLastStep: null } });
    const codes = await tx.recoveryCode.deleteMany({ where: { userId: id } });
    const revokedSessions = await repo.revokeUserSessions(tx, id, now);
    await writeAudit(tx, ctx, { ...who(auth, tenantId), action: USER_AUDIT.MFA_RESET, entity: ENTITY, entityId: id, result: "success", oldValue: { mfaEnabled: row.totpEnabled }, newValue: { mfaEnabled: false, deletedCodes: codes.count, revokedSessions } });
  });
  try {
    await fx.rooms.endByTechnician(id);
    fx.hub.closeByUser(id);
  } catch (err) {
    fx.log.error({ err, alarm: "user_live_effect" }, "2FA sıfırlama canlı oturuma yansıtılamadı (yedek: 60 sn doğrulama)");
  }
}
