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
//  - P14a (AC-202, ADR-0023): her yazma TX'i aktör+hedef satırlarını id sırasıyla `FOR UPDATE` kilitler ve aktörün
//    rol/durum/yetkisini TX İÇİNDE yeniden okur; tüm yetki kararları (gerekli uç yetkisi, AC-73, üstünlük) bu okumayla.
//  - P14a (AC-204): yetki/üstünlük/kendi hesabı kaynaklı her 403 TX geri alındıktan sonra audit'e `user.updated`
//    `result:"fail"`, `newValue:{op, denied:[anahtarlar]}` ile yazılır (e-posta/ad yok). E-posta çakışması da fail audit.
//  - P14a (AC-206): `users.version` PATCH'te `If-Match` ile karşılaştırılır (uyuşmazsa 409 `STALE_WRITE`); gerçek
//    değişiklik, pasif/aktif ve 2FA sıfırlama sürümü +1 artırır. Değişiklik yoksa sürüm ve audit değişmez (AC-207).
import type {
  CreateUserData,
  CreateUserResponse,
  ListUsersQuery,
  UpdateUserData,
  UserDetail,
  UserListResponse,
  UserOptionsResponse,
  UserStatus,
} from "@remote/contracts/api/users";
import { TEMPORARY_PASSWORD_LENGTH, USER_OPTIONS_MAX } from "@remote/contracts/api/users";
import { deletedUserLabel } from "@remote/contracts/audit";
import type { PermissionKey, Role } from "@remote/contracts/permissions";
import type { AuditContext } from "../audit/service.ts";
import { hashPassword } from "../auth/password.ts";
import { countForUser } from "../auth/trusted-device-repo.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newTemporaryPassword } from "../lib/ids.ts";
import { findTenant } from "../tenants/repo.ts";
import { publishUnassigned, type UnassignedRow } from "../requests/assign.ts";
import type { PanelOutbound } from "@remote/contracts/ws-request";
import {
  auditFailures,
  canTakeRequests,
  diffKeys,
  effectiveOf,
  exceeding,
  loadOrThrow,
  normalizeRows,
  sessionActor,
  type LockHooks,
} from "./guard.ts";
import * as repo from "./repo.ts";
import { appendUserLedger, purgeTx, type UserPurgeEffects } from "./purge.ts";
import { toDetail, toItem } from "./view.ts";
import { createTx, forgetDevicesTx, resetMfaTx, setStatusTx, updateTx } from "./writes.ts";

/** Commit sonrası canlı yansıma için gereken dar arayüz (app.rooms + app.requestHub). */
export interface UserLiveEffects {
  rooms: {
    endByTechnician(userId: string): Promise<void>;
    applyPermChange(userId: string, permissions: Iterable<PermissionKey>): Promise<void>;
  };
  /** P18 (S-P18-T5): `publish` atama kalkınca `request.updated` yayını için (yoksa yayın atlanır; 60 sn yoklama düzeltir). */
  hub: { closeByUser(userId: string): number; publish?(tenantId: string, msg: PanelOutbound): void };
  log: { error(obj: object, msg: string): void };
}

// ---------------------------------------------------------------------------------------------------------------

export async function listUsers(db: Db, tenantId: string, q: ListUsersQuery): Promise<UserListResponse> {
  const { rows, total } = await repo.listUsers(db, { tenantId }, q);
  return { items: rows.map(toItem), page: q.page, pageSize: q.pageSize, total };
}

/**
 * GET /users/options kapsamı (QA Tur 1, AC-225): etkin tenant her zaman önce gelir — firma seçili olan veya SUPER_ADMIN
 * olmayan rollerde `requested` yok sayılır (başka firmayı göremez). Firma seçmemiş SUPER_ADMIN `requested` ile firma
 * seçer (silinmiş/olmayan → 404); vermezse mevcut 403 kalır.
 */
export async function userOptionsTenant(db: Db, auth: AuthContext, requested: string | undefined): Promise<string> {
  if (auth.tenantId) return auth.tenantId;
  if (auth.user.role !== "SUPER_ADMIN" || !requested) throw new AppError("FORBIDDEN", { message: "Önce bir firma seçin." });
  if (!(await findTenant(db, requested))) throw new AppError("NOT_FOUND");
  return requested;
}

/**
 * GET /users/options (P14b, AC-225): verilen tenant'ın teknisyenleri (tam liste, ≤ 1000). USER rolü yalnız kendisi
 * (oturum geçmişinde yalnız kendi kayıtlarını görür — `historyScope`).
 */
export async function userOptions(
  db: Db,
  auth: AuthContext,
  tenantId: string,
  includeDeleted = false,
  assignableOnly = false,
): Promise<UserOptionsResponse> {
  if (assignableOnly) {
    // P18 (AC-256): atama seçicisi. `support_requests.assign` olan USER başkalarını da görür (atama yapabilmek için).
    const own = auth.user.role === "USER" && !auth.permissions.has("support_requests.assign") ? auth.user.id : undefined;
    const rows = await repo.listAssignableCandidates(db, { tenantId }, USER_OPTIONS_MAX, own);
    return {
      items: rows
        .filter((r) => canTakeRequests(effectiveOf(r.role as Role, r.permissions)))
        .map((r) => ({ id: r.id, fullName: r.fullName, status: r.status as UserStatus })),
    };
  }
  const self = auth.user.role === "USER" ? auth.user.id : undefined;
  const rows = await repo.listUserOptions(db, { tenantId }, USER_OPTIONS_MAX, self);
  const items: UserOptionsResponse["items"] = rows.map((r) => ({ id: r.id, fullName: r.fullName, status: r.status as UserStatus }));
  // P16 (AC-241): mezar taşları ("Silinmiş kullanıcı #X") yalnız istenirse ve USER rolünde değil (USER yalnız kendisini görür).
  if (includeDeleted && !self) {
    const gone = await repo.listDeletedOptions(db, { tenantId }, Math.max(0, USER_OPTIONS_MAX - items.length));
    items.push(...gone.map((r) => ({ id: r.id, fullName: deletedUserLabel(r.id), status: "DELETED" as const })));
  }
  return { items };
}

/**
 * P12 (AC-83): başka kullanıcının avatarını değiştirme hedefi — kapsam içinde (yoksa 404) ve yönetilebilir (aksi 403).
 * `users.edit` kontrolü uçta.
 */
export async function manageableUser(db: Db, auth: AuthContext, tenantId: string, id: string): Promise<{ id: string; tenantId: string }> {
  const row = await loadOrThrow(db, { tenantId }, id);
  if (exceeding(sessionActor(auth), effectiveOf(row.role as Role, row.permissions)).length > 0)
    throw new AppError("FORBIDDEN", { message: "Sizden daha geniş yetkili bir hesabı yönetemezsiniz." });
  return { id: row.id, tenantId };
}

export async function getUser(db: Db, auth: AuthContext, tenantId: string, id: string): Promise<UserDetail> {
  const row = await loadOrThrow(db, { tenantId }, id);
  return toDetail(row, auth, await countForUser(db, row.id, new Date()));
}

export async function createUser(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: CreateUserData,
  hooks: LockHooks = {},
): Promise<CreateUserResponse> {
  const rows = normalizeRows(input.role, [], input.permissions);
  const after = effectiveOf(input.role, rows);
  const temporaryPassword = newTemporaryPassword(TEMPORARY_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(temporaryPassword); // argon2 kilit dışında
  const id = newId();
  await auditFailures(db, ctx, auth, tenantId, null, "create", () =>
    db.$transaction(async (tx) => createTx({ tx, ctx, auth, tenantId, hooks }, id, input, rows, after, passwordHash)),
  );
  return { user: await getUser(db, auth, tenantId, id), temporaryPassword };
}

/**
 * PATCH /users/:id. `expectedVersion` = `If-Match` (uçta zorunlu, AC-206). Değişiklik yoksa yazma/audit/sürüm artışı
 * yok (AC-207).
 */
export async function updateUser(
  db: Db,
  fx: UserLiveEffects,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  input: UpdateUserData,
  expectedVersion: number,
  hooks: LockHooks = {},
): Promise<UserDetail> {
  const outcome = await auditFailures(db, ctx, auth, tenantId, id, "update", () =>
    db.$transaction(async (tx) => updateTx({ tx, ctx, auth, tenantId, hooks }, id, input, expectedVersion)),
  );
  publishUnassigned(fx.hub.publish ? { publish: fx.hub.publish.bind(fx.hub) } : undefined, outcome.unassigned);
  await liveAfterUpdate(fx, id, outcome);
  return getUser(db, auth, tenantId, id);
}

/** AC-115 / G-04 / G-E9-14: commit sonrası; hata loglanır (60 sn yeniden doğrulama yedek yoldur), yanıt bozulmaz. */
async function liveAfterUpdate(
  fx: UserLiveEffects,
  id: string,
  o: { roleChanged: boolean; before: Set<PermissionKey>; after: Set<PermissionKey> },
): Promise<void> {
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

async function setStatus(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  next: UserStatus,
  hooks: LockHooks,
): Promise<UnassignedRow[]> {
  return auditFailures(db, ctx, auth, tenantId, id, next === "PASSIVE" ? "deactivate" : "reactivate", () =>
    db.$transaction(async (tx) => setStatusTx({ tx, ctx, auth, tenantId, hooks }, id, next)),
  );
}

/** POST /users/:id/deactivate (AC-115, G-04): oturumlar iptal, bekleyen kod oturumları iptal, canlı odalar biter. */
export async function deactivateUser(
  db: Db,
  fx: UserLiveEffects,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  hooks: LockHooks = {},
): Promise<void> {
  const unassigned = await setStatus(db, ctx, auth, tenantId, id, "PASSIVE", hooks);
  publishUnassigned(fx.hub.publish ? { publish: fx.hub.publish.bind(fx.hub) } : undefined, unassigned);
  try {
    await fx.rooms.endByTechnician(id);
    fx.hub.closeByUser(id);
  } catch (err) {
    fx.log.error({ err, alarm: "user_live_effect" }, "pasife alma canlı oturuma yansıtılamadı (yedek: 60 sn doğrulama)");
  }
}

/** POST /users/:id/reactivate: hesap kilit sayaçları sıfırlanır; şifre değişmez. */
export async function reactivateUser(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  hooks: LockHooks = {},
): Promise<void> {
  await setStatus(db, ctx, auth, tenantId, id, "ACTIVE", hooks);
}

/**
 * POST /users/:id/reset-mfa (P10; AC-67, AC-115, G-04): tek TX'te sır/etkinlik/son adım NULL (üçü birlikte — CHECK),
 * kurtarma kodları silinir, oturumlar iptal; commit sonrası canlı odalar biter. Kendi hesabı / daha geniş yetkili hesap
 * 403; 2FA hiç kurulmamışsa 409. Kullanıcı bir sonraki girişte (zorunluysa) yeniden kurar.
 */
export async function resetUserMfa(
  db: Db,
  fx: UserLiveEffects,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  hooks: LockHooks = {},
): Promise<void> {
  await auditFailures(db, ctx, auth, tenantId, id, "reset_mfa", () =>
    db.$transaction(async (tx) => resetMfaTx({ tx, ctx, auth, tenantId, hooks }, id)),
  );
  try {
    await fx.rooms.endByTechnician(id);
    fx.hub.closeByUser(id);
  } catch (err) {
    fx.log.error({ err, alarm: "user_live_effect" }, "2FA sıfırlama canlı oturuma yansıtılamadı (yedek: 60 sn doğrulama)");
  }
}

/**
 * POST /users/:id/forget-devices (P27a AC-330): kullanıcının tüm hatırlanan cihazları tek TX'te silinir. Kendi hesabı /
 * daha geniş yetkili hesap 403 (+ fail audit), başka firma 404. Oturumlara dokunulmaz (yalnız TOTP atlaması kalkar).
 */
export async function forgetUserDevices(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  hooks: LockHooks = {},
): Promise<number> {
  return auditFailures(db, ctx, auth, tenantId, id, "forget_devices", () =>
    db.$transaction(async (tx) => forgetDevicesTx({ tx, ctx, auth, tenantId, hooks }, id)),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// P16 — kalıcı kullanıcı silme (AC-237, AC-241; ADR-0030 m.4, mimari-e11 §7.4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * DELETE /users/:id. Tek TX: aktör + hedef `FOR UPDATE` → aktör yeniden okunur (`users.delete`) → hedef kapsamda (404;
 * SUPER_ADMIN kapsamda hiç görünmez, S16-17) → kendi hesabı / daha geniş yetkili hedef 403 (+ fail audit) → ACTIVE 409 →
 * açık oturum 409 → sürüm 409 `STALE_WRITE` → ad onayı 400 → defter `phase:"intent"` → mezar taşı TEK UPDATE
 * (`WHERE id, version, status = PASSIVE`) + alt tablolar + audit `user.deleted` (PII yok). Commit sonrası avatar silinir ve
 * deftere `{type: "user", id, phase: "done", at}` yazılır (S16-18).
 */
export async function purgeUser(
  db: Db,
  fx: UserPurgeEffects,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  confirmName: string,
  expectedVersion: number,
  hooks: LockHooks = {},
): Promise<void> {
  const at = new Date();
  const avatarPath = await auditFailures(db, ctx, auth, tenantId, id, "delete", () =>
    db.$transaction(async (tx) => purgeTx({ tx, ctx, auth, tenantId, hooks }, fx, id, confirmName, expectedVersion, at)),
  );
  try {
    await fx.removeFile(avatarPath);
  } catch (err) {
    fx.log.error({ err, alarm: "upload_cleanup", userId: id }, "silinen kullanıcının avatar dosyası silinemedi (yetim taraması toplar)");
  }
  await appendUserLedger(fx, id, "done", at);
}
