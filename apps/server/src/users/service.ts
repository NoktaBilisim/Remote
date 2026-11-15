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
  ManagedRole,
  UpdateUserData,
  UserDetail,
  UserListItem,
  UserListResponse,
  UserOptionsResponse,
  UserStatus,
} from "@remote/contracts/api/users";
import {
  TEMPORARY_PASSWORD_LENGTH,
  USER_DELETE_ACTIVE_MESSAGE,
  USER_DELETE_CONFIRM_MISMATCH_MESSAGE,
  USER_DELETE_OPEN_SESSION_MESSAGE,
  USER_EMAIL_CONFLICT_MESSAGE,
  USER_OPTIONS_MAX,
  confirmNameMatches,
} from "@remote/contracts/api/users";
import { AUDIT_ENTITY, USER_AUDIT, deletedUserLabel } from "@remote/contracts/audit";
import { PERMISSION_KEYS, effectivePermissions, roleDefaultGranted, type PermissionKey, type Role } from "@remote/contracts/permissions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { hashPassword } from "../auth/password.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newTemporaryPassword } from "../lib/ids.ts";
import type { UserPhase } from "../ops/erasure-ledger.ts";
import { findTenant } from "../tenants/repo.ts";
import { avatarUrlFor } from "../uploads/urls.ts";
import { publishUnassigned, unassignWithAudit, type UnassignedRow } from "../requests/assign.ts";
import type { PanelOutbound } from "@remote/contracts/ws-request";
import * as repo from "./repo.ts";

const ENTITY = AUDIT_ENTITY.USERS;
const EMAIL_UQ = "users_email_key";

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

/** P18 (AC-256): atanabilirlik — talep görüntüleme + kabul yetkisi (sunucu `assignRequest` ile aynı kural). */
const canTakeRequests = (p: ReadonlySet<PermissionKey>): boolean => p.has("support_requests.view") && p.has("support_requests.accept");

/** Testlere özel gecikme kancası (ADR-0023): kilit alındıktan hemen sonra, okumalardan önce. Üretimde verilmez. */
export interface LockHooks {
  afterLock?: () => Promise<void>;
}

type Op = "create" | "update" | "deactivate" | "reactivate" | "reset_mfa" | "delete";

/** Audit'e `denied` anahtarlarıyla yazılan 403 (AC-204). */
class DeniedError extends AppError {
  readonly denied: string[];
  constructor(message: string, denied: readonly string[], fields?: Record<string, string>) {
    super("FORBIDDEN", { message, ...(fields ? { fields } : {}) });
    this.denied = [...denied];
  }
}

/** TX içinde yeniden okunan aktör (AC-202). */
interface Actor {
  role: Role;
  permissions: ReadonlySet<PermissionKey>;
}

type ManagedRow = repo.UserRow & { role: ManagedRole };

const asManaged = (r: repo.UserRow): ManagedRow => r as ManagedRow;

const who = (auth: AuthContext, tenantId: string) => ({ tenantId, userId: auth.user.id, username: auth.user.email });

const emailConflict = (): AppError =>
  new AppError("CONFLICT", { message: USER_EMAIL_CONFLICT_MESSAGE, fields: { email: USER_EMAIL_CONFLICT_MESSAGE } });
const stale = (): AppError => new AppError("STALE_WRITE");

function effectiveOf(role: Role, rows: readonly { permKey: string; granted: boolean }[]): Set<PermissionKey> {
  return new Set(effectivePermissions(role, rows));
}

/** Hedefin etkin yetkilerinden işlemi yapanda olmayanlar (boş → yönetebilir). Super Admin her zaman yönetir. */
function exceeding(actor: Actor, target: ReadonlySet<PermissionKey>): PermissionKey[] {
  if (actor.role === "SUPER_ADMIN") return [];
  return PERMISSION_KEYS.filter((k) => target.has(k) && !actor.permissions.has(k));
}

const sessionActor = (auth: AuthContext): Actor => ({ role: auth.user.role, permissions: auth.permissions });

function assertManage(actor: Actor, target: ReadonlySet<PermissionKey>, message: string): void {
  const over = exceeding(actor, target);
  if (over.length > 0) throw new DeniedError(message, over);
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
    avatarUrl: avatarUrlFor(r.avatarPath),
    lastLoginAt: r.authSessions[0]?.createdAt.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function toDetail(r: repo.UserRow, auth: AuthContext): UserDetail {
  const eff = effectiveOf(r.role as Role, r.permissions);
  const permissions = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, eff.has(k)])) as Record<PermissionKey, boolean>;
  return {
    ...toItem(r),
    version: r.version,
    permissions,
    isSelf: r.id === auth.user.id,
    canManage: exceeding(sessionActor(auth), eff).length === 0,
  };
}

/**
 * İstenen yetki haritasını mevcut ezmelerin üstüne uygular, rol varsayılanına eşit satırları atar (normalize).
 * Tanım dışı eski anahtarlar düşer.
 */
function normalizeRows(
  role: ManagedRole,
  current: readonly { permKey: string; granted: boolean }[],
  requested: Readonly<Record<string, boolean>> | undefined,
) {
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
function assertGrantable(actor: Actor, changed: readonly PermissionKey[]): void {
  const missing = changed.filter((k) => !actor.permissions.has(k));
  if (missing.length === 0) return;
  throw new DeniedError(
    "Sahip olmadığınız bir yetkiyi veremez veya değiştiremezsiniz.",
    missing,
    Object.fromEntries(missing.map((k) => [`permissions.${k}`, "Bu yetkiye sahip değilsiniz"])),
  );
}

/**
 * AC-202: aktör (+hedef) satırlarını id sırasıyla kilitler, kancayı çağırır, aktörü yeniden okur. Aktör pasif/silinmiş,
 * başka firmaya geçmiş ya da uç yetkisini (`need`) yitirmişse 403.
 */
async function lockActor(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  tenantId: string,
  targetIds: readonly string[],
  need: PermissionKey,
  hooks: LockHooks,
): Promise<Actor> {
  await repo.lockUsers(tx, [auth.user.id, ...targetIds]);
  await hooks.afterLock?.();
  const row = await repo.readActor(tx, auth.user.id);
  const role = row?.role as Role | undefined;
  if (!row || !role || row.status !== "ACTIVE" || row.deletedAt !== null || (role !== "SUPER_ADMIN" && row.tenantId !== tenantId))
    throw new DeniedError("Bu işlem için yetkiniz yok.", ["actor"]);
  const permissions = effectiveOf(role, row.permissions);
  if (!permissions.has(need)) throw new DeniedError("Bu işlem için yetkiniz yok.", [need]);
  return { role, permissions };
}

/** AC-204: TX geri alındıktan sonra 403 kararını audit'e yazar (PII yok); AC-203: e-posta çakışması da fail. */
async function auditFailures<T>(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  targetId: string | null,
  op: Op,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const emailTaken = conflictIndex(err) === EMAIL_UQ;
    if (err instanceof DeniedError || emailTaken) {
      await writeAudit(db, ctx, {
        ...who(auth, tenantId),
        action: op === "create" ? USER_AUDIT.CREATED : op === "delete" ? USER_AUDIT.DELETED : USER_AUDIT.UPDATED,
        entity: ENTITY,
        entityId: targetId,
        result: "fail",
        newValue: err instanceof DeniedError ? { op, denied: err.denied } : { op, reason: "email_taken" },
      });
    }
    if (emailTaken) throw emailConflict();
    throw err;
  }
}

async function permissionAudits(
  tx: Parameters<typeof writeAudit>[0],
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  targetId: string,
  before: ReadonlySet<PermissionKey>,
  after: ReadonlySet<PermissionKey>,
): Promise<void> {
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

async function loadOrThrow(db: Db | Prisma.TransactionClient, scope: repo.TenantScope, id: string): Promise<repo.UserRow> {
  const row = await repo.findUser(db, scope, id);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
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
  return toDetail(await loadOrThrow(db, { tenantId }, id), auth);
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
    db.$transaction(async (tx) => {
      const actor = await lockActor(tx, auth, tenantId, [], "users.create", hooks);
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
    }),
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
  const scope = { tenantId };
  const outcome = await auditFailures(db, ctx, auth, tenantId, id, "update", () =>
    db.$transaction(async (tx) => {
      const actor = await lockActor(tx, auth, tenantId, [id], "users.edit", hooks);
      const cur = asManaged(await loadOrThrow(tx, scope, id));
      const before = effectiveOf(cur.role, cur.permissions);
      assertManage(actor, before, "Sizden daha geniş yetkili bir hesabı düzenleyemezsiniz.");
      const role = input.role ?? cur.role;
      const rows = normalizeRows(role, cur.permissions, input.permissions);
      const after = effectiveOf(role, rows);
      const changed = diffKeys(before, after);
      const roleChanged = role !== cur.role;
      if (cur.id === auth.user.id && (roleChanged || changed.length > 0))
        throw new DeniedError("Kendi rolünüzü veya yetkilerinizi değiştiremezsiniz.", [...(roleChanged ? ["role"] : []), ...changed]);
      assertGrantable(actor, changed);
      // S14-5: sürüm (409) yetki kararlarından SONRA — üstün hesaba eski sürümle gelen istek de 403 + denied audit alır.
      if (cur.version !== expectedVersion) throw stale();

      const fields: Record<string, string> = {};
      const old: Record<string, string> = {};
      if (input.email !== undefined && input.email !== cur.email) [fields.email, old.email] = [input.email, cur.email];
      if (input.fullName !== undefined && input.fullName !== cur.fullName) [fields.fullName, old.fullName] = [input.fullName, cur.fullName];
      if (roleChanged) [fields.role, old.role] = [role, cur.role];
      if (Object.keys(fields).length === 0 && changed.length === 0)
        return { roleChanged, before, after, unassigned: [] as UnassignedRow[] };
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
      if (input.permissions !== undefined || roleChanged) await repo.replacePermissions(tx, id, rows);
      await permissionAudits(tx, ctx, auth, tenantId, id, before, after);
      // S-P18-T5: talep görüntüleme/kabul yetkisi kalktıysa bekleyen atamalar aynı TX'te kalkar.
      const unassigned = canTakeRequests(after)
        ? []
        : await unassignWithAudit(tx, ctx, { userId: auth.user.id, username: auth.user.email }, { userId: id });
      return { roleChanged, before, after, unassigned };
    }),
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
  const scope = { tenantId };
  return auditFailures(db, ctx, auth, tenantId, id, next === "PASSIVE" ? "deactivate" : "reactivate", () =>
    db.$transaction(async (tx) => {
      const actor = await lockActor(tx, auth, tenantId, [id], "users.edit", hooks);
      const cur = asManaged(await loadOrThrow(tx, scope, id));
      if (cur.id === auth.user.id) throw new DeniedError("Kendi hesabınızın durumunu değiştiremezsiniz.", ["status"]);
      assertManage(actor, effectiveOf(cur.role, cur.permissions), "Sizden daha geniş yetkili bir hesabı yönetemezsiniz.");
      if (cur.status === next)
        throw new AppError("CONFLICT", { message: next === "PASSIVE" ? "Kullanıcı zaten pasif." : "Kullanıcı zaten aktif." });
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
        extra.cancelledSessions = await repo.cancelPendingOfTechnician(tx, scope, id, now);
        // S-P18-T5: pasif kullanıcıya atanmış bekleyen talepler aynı TX'te atanmamışa döner.
        unassigned = await unassignWithAudit(tx, ctx, { userId: auth.user.id, username: auth.user.email }, { userId: id });
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
      return unassigned;
    }),
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
  const scope = { tenantId };
  await auditFailures(db, ctx, auth, tenantId, id, "reset_mfa", () =>
    db.$transaction(async (tx) => {
      const actor = await lockActor(tx, auth, tenantId, [id], "users.edit", hooks);
      const cur = asManaged(await loadOrThrow(tx, scope, id));
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
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: USER_AUDIT.MFA_RESET,
        entity: ENTITY,
        entityId: id,
        result: "success",
        oldValue: { mfaEnabled: row.totpEnabled },
        newValue: { mfaEnabled: false, deletedCodes: codes.count, revokedSessions },
      });
    }),
  );
  try {
    await fx.rooms.endByTechnician(id);
    fx.hub.closeByUser(id);
  } catch (err) {
    fx.log.error({ err, alarm: "user_live_effect" }, "2FA sıfırlama canlı oturuma yansıtılamadı (yedek: 60 sn doğrulama)");
  }
}

// ---------------------------------------------------------------------------------------------------------------
// P16 — kalıcı kullanıcı silme (AC-237, AC-241; ADR-0030 m.4, mimari-e11 §7.4)
// ---------------------------------------------------------------------------------------------------------------

/** Yan etkiler: avatar dosyası (commit sonrası) ve imha defteri (niyet TX içinde, done commit sonrası); hata yanıtı bozmaz. */
export interface UserPurgeEffects {
  removeFile(rel: string | null): Promise<void>;
  ledger: { append(e: { type: "user"; id: string; phase: UserPhase; at: string }): Promise<void> };
  log: { error(obj: object, msg: string): void };
}

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
  const scope = { tenantId };
  const at = new Date();
  const avatarPath = await auditFailures(db, ctx, auth, tenantId, id, "delete", () =>
    db.$transaction(async (tx) => {
      const actor = await lockActor(tx, auth, tenantId, [id], "users.delete", hooks);
      // S16-17: önce kapsam/varlık — kapsamlı sorgu Super Admin'i (tenant_id NULL) ve başka firmayı hiç görmez → 404
      // (rol 403 ile ayırt edilemez, firma audit'ine Super Admin kimliği yazılmaz).
      const cur = asManaged(await loadOrThrow(tx, scope, id));
      if (cur.id === auth.user.id) throw new DeniedError("Kendi hesabınızı silemezsiniz.", ["self"]);
      assertManage(actor, effectiveOf(cur.role, cur.permissions), "Sizden daha geniş yetkili bir hesabı silemezsiniz.");
      if (cur.status !== "PASSIVE") throw new AppError("CONFLICT", { message: USER_DELETE_ACTIVE_MESSAGE });
      if ((await repo.countOpenSessions(tx, scope, id)) > 0) throw new AppError("CONFLICT", { message: USER_DELETE_OPEN_SESSION_MESSAGE });
      if (cur.version !== expectedVersion) throw stale();
      if (!confirmNameMatches(confirmName, cur.fullName))
        throw new AppError("VALIDATION", { fields: { confirmName: USER_DELETE_CONFIRM_MISMATCH_MESSAGE } });
      // S16-18: niyet satırı denetimler geçtikten sonra, mezar taşından önce (commit ile defter arasında çökme penceresi yok).
      // TX'ten önce yazılmaz: reddedilecek istek (409/400/403) deftere girip geri yüklemede silinmesin.
      await appendUserLedger(fx, id, "intent", at);
      if ((await repo.tombstone(tx, id, expectedVersion, deletedUserLabel(id), at)) !== 1) throw stale();
      const counts = await repo.deleteUserChildren(tx, id);
      // S-P18-T5: kullanıcı zaten PASSIVE (pasife almada atamalar kalktı); savunma amaçlı aynı TX'te tekrar (yayın yok —
      // pasife almada yapıldı; satır kalmış olamaz).
      await unassignWithAudit(tx, ctx, { userId: auth.user.id, username: auth.user.email }, { userId: id });
      await writeAudit(tx, ctx, {
        ...who(auth, tenantId),
        action: USER_AUDIT.DELETED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        oldValue: { status: "PASSIVE" },
        newValue: { status: "DELETED", ...counts },
      });
      return cur.avatarPath;
    }),
  );
  try {
    await fx.removeFile(avatarPath);
  } catch (err) {
    fx.log.error({ err, alarm: "upload_cleanup", userId: id }, "silinen kullanıcının avatar dosyası silinemedi (yetim taraması toplar)");
  }
  await appendUserLedger(fx, id, "done", at);
}

/** Defter yazım hatası silmeyi durdurmaz; alarm loglanır (sayaç `ErasureLedger` içinde). */
async function appendUserLedger(fx: UserPurgeEffects, id: string, phase: UserPhase, at: Date): Promise<void> {
  try {
    await fx.ledger.append({ type: "user", id, phase, at: at.toISOString() });
  } catch (err) {
    fx.log.error({ err, alarm: "erasure_ledger_write_failed", userId: id, phase }, "imha defterine yazılamadı");
  }
}
