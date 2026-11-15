// Kullanıcı yönetimi ortak yetki/kilit yardımcıları (service.ts'ten taşındı, PT-K12; kurallar service.ts başlığında).
import { USER_EMAIL_CONFLICT_MESSAGE, type ManagedRole } from "@remote/contracts/api/users";
import { AUDIT_ENTITY, USER_AUDIT } from "@remote/contracts/audit";
import { PERMISSION_KEYS, effectivePermissions, roleDefaultGranted, type PermissionKey, type Role } from "@remote/contracts/permissions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import * as repo from "./repo.ts";

export const ENTITY = AUDIT_ENTITY.USERS;
const EMAIL_UQ = "users_email_key";

/** P18 (AC-256): atanabilirlik — talep görüntüleme + kabul yetkisi (sunucu `assignRequest` ile aynı kural). */
export const canTakeRequests = (p: ReadonlySet<PermissionKey>): boolean =>
  p.has("support_requests.view") && p.has("support_requests.accept");

/** Testlere özel gecikme kancası (ADR-0023): kilit alındıktan hemen sonra, okumalardan önce. Üretimde verilmez. */
export interface LockHooks {
  afterLock?: () => Promise<void>;
}

type Op = "create" | "update" | "deactivate" | "reactivate" | "reset_mfa" | "forget_devices" | "delete";

/** Audit'e `denied` anahtarlarıyla yazılan 403 (AC-204). */
export class DeniedError extends AppError {
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

export type ManagedRow = repo.UserRow & { role: ManagedRole };

export const asManaged = (r: repo.UserRow): ManagedRow => r as ManagedRow;

export const who = (auth: AuthContext, tenantId: string) => ({ tenantId, userId: auth.user.id, username: auth.user.email });

const emailConflict = (): AppError =>
  new AppError("CONFLICT", { message: USER_EMAIL_CONFLICT_MESSAGE, fields: { email: USER_EMAIL_CONFLICT_MESSAGE } });
export const stale = (): AppError => new AppError("STALE_WRITE");

export function effectiveOf(role: Role, rows: readonly { permKey: string; granted: boolean }[]): Set<PermissionKey> {
  return new Set(effectivePermissions(role, rows));
}

/** Hedefin etkin yetkilerinden işlemi yapanda olmayanlar (boş → yönetebilir). Super Admin her zaman yönetir. */
export function exceeding(actor: Actor, target: ReadonlySet<PermissionKey>): PermissionKey[] {
  if (actor.role === "SUPER_ADMIN") return [];
  return PERMISSION_KEYS.filter((k) => target.has(k) && !actor.permissions.has(k));
}

export const sessionActor = (auth: AuthContext): Actor => ({ role: auth.user.role, permissions: auth.permissions });

export function assertManage(actor: Actor, target: ReadonlySet<PermissionKey>, message: string): void {
  const over = exceeding(actor, target);
  if (over.length > 0) throw new DeniedError(message, over);
}
/**
 * İstenen yetki haritasını mevcut ezmelerin üstüne uygular, rol varsayılanına eşit satırları atar (normalize).
 * Tanım dışı eski anahtarlar düşer.
 */
export function normalizeRows(
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
export function diffKeys(before: ReadonlySet<PermissionKey>, after: ReadonlySet<PermissionKey>): PermissionKey[] {
  return PERMISSION_KEYS.filter((k) => before.has(k) !== after.has(k));
}

/** AC-73: değişen her anahtar işlemi yapanda olmalı (Super Admin tümüne sahip). */
export function assertGrantable(actor: Actor, changed: readonly PermissionKey[]): void {
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
export async function lockActor(
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
export async function auditFailures<T>(
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

export async function permissionAudits(
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

export async function loadOrThrow(db: Db | Prisma.TransactionClient, scope: repo.TenantScope, id: string): Promise<repo.UserRow> {
  const row = await repo.findUser(db, scope, id);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}
