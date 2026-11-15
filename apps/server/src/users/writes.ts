// Kullanıcı yazma TX gövdeleri (service.ts'ten taşındı, PT-K12): oluşturma, güncelleme, pasif/aktif, 2FA sıfırlama.
// Kurallar ve kilit/karar sırası service.ts başlığında (AC-202..207); her işlev çağıranın TX'inde koşar. Silme: purge.ts.
import type { CreateUserData, ManagedRole, UpdateUserData, UserStatus } from "@remote/contracts/api/users";
import { AUTH_AUDIT, USER_AUDIT } from "@remote/contracts/audit";
import type { PermissionKey } from "@remote/contracts/permissions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { deleteForUser as deleteTrustedDevices } from "../auth/trusted-device-repo.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { unassignWithAudit, type UnassignedRow } from "../requests/assign.ts";
import {
  DeniedError,
  ENTITY,
  asManaged,
  assertGrantable,
  assertManage,
  canTakeRequests,
  diffKeys,
  effectiveOf,
  loadOrThrow,
  lockActor,
  normalizeRows,
  permissionAudits,
  stale,
  who,
  type LockHooks,
  type ManagedRow,
} from "./guard.ts";
import * as repo from "./repo.ts";

type Tx = Prisma.TransactionClient;

/** Yazma TX'inin ortak bağlamı (önceden kapanış değişkenleri). */
export interface WriteCtx {
  tx: Tx;
  ctx: AuditContext;
  auth: AuthContext;
  tenantId: string;
  hooks: LockHooks;
}

interface UpdateOutcome {
  roleChanged: boolean;
  before: Set<PermissionKey>;
  after: Set<PermissionKey>;
  unassigned: UnassignedRow[];
}

interface UpdatePlan {
  cur: ManagedRow;
  role: ManagedRole;
  rows: { permKey: string; granted: boolean }[];
  before: Set<PermissionKey>;
  after: Set<PermissionKey>;
  changed: PermissionKey[];
  roleChanged: boolean;
}

/** Kilit + yetki kararları (AC-73, üstünlük, kendi hesabı) ve sürüm denetimi; yazma yok. */
async function planUpdate(w: WriteCtx, id: string, input: UpdateUserData, expectedVersion: number): Promise<UpdatePlan> {
  const actor = await lockActor(w.tx, w.auth, w.tenantId, [id], "users.edit", w.hooks);
  const cur = asManaged(await loadOrThrow(w.tx, { tenantId: w.tenantId }, id));
  const before = effectiveOf(cur.role, cur.permissions);
  assertManage(actor, before, "Sizden daha geniş yetkili bir hesabı düzenleyemezsiniz.");
  const role = input.role ?? cur.role;
  const rows = normalizeRows(role, cur.permissions, input.permissions);
  const after = effectiveOf(role, rows);
  const changed = diffKeys(before, after);
  const roleChanged = role !== cur.role;
  if (cur.id === w.auth.user.id && (roleChanged || changed.length > 0))
    throw new DeniedError("Kendi rolünüzü veya yetkilerinizi değiştiremezsiniz.", [...(roleChanged ? ["role"] : []), ...changed]);
  assertGrantable(actor, changed);
  // S14-5: sürüm (409) yetki kararlarından SONRA — üstün hesaba eski sürümle gelen istek de 403 + denied audit alır.
  if (cur.version !== expectedVersion) throw stale();
  return { cur, role, rows, before, after, changed, roleChanged };
}

function fieldDiff(input: UpdateUserData, p: UpdatePlan): { fields: Record<string, string>; old: Record<string, string> } {
  const { cur, role } = p;
  const fields: Record<string, string> = {};
  const old: Record<string, string> = {};
  if (input.email !== undefined && input.email !== cur.email) [fields.email, old.email] = [input.email, cur.email];
  if (input.fullName !== undefined && input.fullName !== cur.fullName) [fields.fullName, old.fullName] = [input.fullName, cur.fullName];
  if (p.roleChanged) [fields.role, old.role] = [role, cur.role];
  return { fields, old };
}

/** PATCH /users/:id TX gövdesi. Değişiklik yoksa yazma/audit/sürüm artışı yok (AC-207). */
export async function updateTx(w: WriteCtx, id: string, input: UpdateUserData, expectedVersion: number): Promise<UpdateOutcome> {
  const { tx, ctx, auth, tenantId } = w;
  const p = await planUpdate(w, id, input, expectedVersion);
  const { roleChanged, before, after } = p;
  const { fields, old } = fieldDiff(input, p);
  if (Object.keys(fields).length === 0 && p.changed.length === 0) return { roleChanged, before, after, unassigned: [] as UnassignedRow[] };
  if ((await repo.bumpVersion(tx, id, expectedVersion)) === 0) throw stale();
  if (Object.keys(fields).length > 0) {
    await repo.updateUser(tx, id, fields);
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: USER_AUDIT.UPDATED,
      entity: ENTITY,
      entityId: id,
      result: "success",
      oldValue: old,
      newValue: fields,
    });
  }
  if (input.permissions !== undefined || roleChanged) await repo.replacePermissions(tx, id, p.rows);
  await permissionAudits(tx, ctx, auth, tenantId, id, before, after);
  // S-P18-T5: talep görüntüleme/kabul yetkisi kalktıysa bekleyen atamalar aynı TX'te kalkar.
  const unassigned = canTakeRequests(after)
    ? []
    : await unassignWithAudit(tx, ctx, { userId: auth.user.id, username: auth.user.email }, { userId: id });
  return { roleChanged, before, after, unassigned };
}

/** Durum UPDATE'i + pasife almanın yan yazmaları (oturum iptali, bekleyen kod oturumları, atamalar). */
async function writeStatus(
  w: WriteCtx,
  id: string,
  next: UserStatus,
): Promise<{ extra: Record<string, number>; unassigned: UnassignedRow[] }> {
  const { tx, ctx, auth } = w;
  const now = new Date();
  await repo.updateUser(
    tx,
    id,
    next === "ACTIVE"
      ? { status: next, failedLoginCount: 0, failedWindowAt: null, lockedUntil: null, version: { increment: 1 } }
      : { status: next, version: { increment: 1 } },
  );
  const extra: Record<string, number> = {};
  let unassigned: UnassignedRow[] = [];
  if (next === "PASSIVE") {
    extra.revokedSessions = await repo.revokeUserSessions(tx, id, now);
    // P27a (AC-328): pasif (silme de pasiften geçer) → hatırlanan cihazların tümü aynı TX'te.
    extra.revokedTrustedDevices = await deleteTrustedDevices(tx, id);
    extra.cancelledSessions = await repo.cancelPendingOfTechnician(tx, { tenantId: w.tenantId }, id, now);
    // S-P18-T5: pasif kullanıcıya atanmış bekleyen talepler aynı TX'te atanmamışa döner.
    unassigned = await unassignWithAudit(tx, ctx, { userId: auth.user.id, username: auth.user.email }, { userId: id });
  }
  return { extra, unassigned };
}

/** POST /users/:id/deactivate|reactivate TX gövdesi. */
export async function setStatusTx(w: WriteCtx, id: string, next: UserStatus): Promise<UnassignedRow[]> {
  const { tx, ctx, auth, tenantId } = w;
  const actor = await lockActor(tx, auth, tenantId, [id], "users.edit", w.hooks);
  const cur = asManaged(await loadOrThrow(tx, { tenantId }, id));
  if (cur.id === auth.user.id) throw new DeniedError("Kendi hesabınızın durumunu değiştiremezsiniz.", ["status"]);
  assertManage(actor, effectiveOf(cur.role, cur.permissions), "Sizden daha geniş yetkili bir hesabı yönetemezsiniz.");
  if (cur.status === next)
    throw new AppError("CONFLICT", { message: next === "PASSIVE" ? "Kullanıcı zaten pasif." : "Kullanıcı zaten aktif." });
  const { extra, unassigned } = await writeStatus(w, id, next);
  await writeAudit(tx, ctx, {
    ...who(auth, tenantId),
    action: next === "PASSIVE" ? USER_AUDIT.DEACTIVATED : USER_AUDIT.REACTIVATED,
    entity: ENTITY,
    entityId: id,
    result: "success",
    oldValue: { status: cur.status },
    newValue: { status: next, ...extra },
  });
  return unassigned;
}

/** POST /users/:id/reset-mfa TX gövdesi (sır/etkinlik/son adım NULL, kurtarma kodları silinir, oturumlar iptal). */
export async function resetMfaTx(w: WriteCtx, id: string): Promise<void> {
  const { tx, ctx, auth, tenantId } = w;
  const actor = await lockActor(tx, auth, tenantId, [id], "users.edit", w.hooks);
  const cur = asManaged(await loadOrThrow(tx, { tenantId }, id));
  if (cur.id === auth.user.id) throw new DeniedError("Kendi iki adımlı doğrulamanızı sıfırlayamazsınız.", ["mfa"]);
  assertManage(actor, effectiveOf(cur.role, cur.permissions), "Sizden daha geniş yetkili bir hesabı yönetemezsiniz.");
  const row = await tx.user.findUniqueOrThrow({ where: { id }, select: { totpEnabled: true, totpSecretEnc: true } });
  if (!row.totpEnabled && row.totpSecretEnc === null)
    throw new AppError("CONFLICT", { message: "Bu kullanıcıda iki adımlı doğrulama kurulu değil." });
  const now = new Date();
  await tx.user.update({
    where: { id },
    data: { totpSecretEnc: null, totpEnabled: false, totpLastStep: null, version: { increment: 1 } },
  });
  const codes = await tx.recoveryCode.deleteMany({ where: { userId: id } });
  const revokedSessions = await repo.revokeUserSessions(tx, id, now);
  const revokedTrustedDevices = await deleteTrustedDevices(tx, id); // P27a (AC-328)
  await writeAudit(tx, ctx, {
    ...who(auth, tenantId),
    action: USER_AUDIT.MFA_RESET,
    entity: ENTITY,
    entityId: id,
    result: "success",
    oldValue: { mfaEnabled: row.totpEnabled },
    newValue: { mfaEnabled: false, deletedCodes: codes.count, revokedSessions, revokedTrustedDevices },
  });
}

/**
 * POST /users/:id/forget-devices TX gövdesi (P27a AC-330, mimari-p27a §3.4/§4.2, K-P27a-9): aktör kilidi + `users.edit`
 * TX içinde yeniden okunur → hedef kapsamda (başka firma 404) → kendi hesabı 403 (profil yolu) → daha geniş yetkili 403 →
 * tüm hatırlanan cihazlar silinir + audit `auth.trusted_device_revoked {reason:"admin", count}` (aktör Admin, hedef
 * kullanıcı). Kullanıcı satırı değişmediği için sürüm artmaz; 0 cihazda da başarılı (audit `count: 0`, idempotent).
 */
export async function forgetDevicesTx(w: WriteCtx, id: string): Promise<number> {
  const { tx, ctx, auth, tenantId } = w;
  const actor = await lockActor(tx, auth, tenantId, [id], "users.edit", w.hooks);
  const cur = asManaged(await loadOrThrow(tx, { tenantId }, id));
  if (cur.id === auth.user.id) throw new DeniedError("Kendi cihazlarınızı Hesabım sayfasından kaldırın.", ["self"]);
  assertManage(actor, effectiveOf(cur.role, cur.permissions), "Sizden daha geniş yetkili bir hesabı yönetemezsiniz.");
  const count = await deleteTrustedDevices(tx, id);
  await writeAudit(tx, ctx, {
    ...who(auth, tenantId),
    action: AUTH_AUDIT.TRUSTED_DEVICE_REVOKED,
    entity: ENTITY,
    entityId: id,
    result: "success",
    newValue: { reason: "admin", count },
  });
  return count;
}

/** POST /users TX gövdesi: aktör kilidi + AC-73, satır + ezmeler + audit (oluşturma ve yetki satırları). */
export async function createTx(
  w: WriteCtx,
  id: string,
  input: CreateUserData,
  rows: { permKey: string; granted: boolean }[],
  after: Set<PermissionKey>,
  passwordHash: string,
): Promise<void> {
  const { tx, ctx, auth, tenantId } = w;
  const actor = await lockActor(tx, auth, tenantId, [], "users.create", w.hooks);
  assertGrantable(actor, [...after]);
  await repo.insertUser(tx, {
    id,
    tenantId,
    email: input.email,
    fullName: input.fullName,
    role: input.role,
    passwordHash,
    mustChangePassword: true,
  });
  await repo.replacePermissions(tx, id, rows);
  await writeAudit(tx, ctx, {
    ...who(auth, tenantId),
    action: USER_AUDIT.CREATED,
    entity: ENTITY,
    entityId: id,
    result: "success",
    newValue: { email: input.email, fullName: input.fullName, role: input.role, status: "ACTIVE" },
  });
  await permissionAudits(tx, ctx, auth, tenantId, id, effectiveOf(input.role, []), after);
}
