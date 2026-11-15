// Audit okuma sorguları (P11; AC-76). Keyset (`created_at DESC, id DESC`), COUNT yok (dışa aktarımda üst sınırlı sayım).
// Kapsam her sorguda zorunlu: tenant → yalnız o tenant; all (firma seçmemiş SUPER_ADMIN) → isteğe bağlı tenantId.
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { escapeLike } from "../sessions/history-repo.ts";

export type AuditScope = { kind: "tenant"; tenantId: string } | { kind: "all" };

export interface AuditFilter {
  from: Date;
  to: Date;
  tenantId?: string;
  userId?: string;
  /** Tam değer; `prefix` true ise `action LIKE 'x.%'`. */
  action?: { value: string; prefix: boolean };
  result?: "success" | "fail";
}

export interface AuditCursor {
  createdAt: Date;
  id: bigint;
}

function auditWhere(scope: AuditScope, f: AuditFilter, after: AuditCursor | null): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [{ createdAt: { gte: f.from, lt: f.to } }];
  if (scope.kind === "tenant") and.push({ tenantId: scope.tenantId });
  else if (f.tenantId) and.push({ tenantId: f.tenantId });
  if (f.userId) and.push({ userId: f.userId });
  if (f.action) and.push(f.action.prefix ? { action: { startsWith: escapeLike(f.action.value) } } : { action: f.action.value });
  if (f.result) and.push({ result: f.result });
  if (after) and.push({ OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] });
  return { AND: and };
}

const ROW_SELECT = {
  id: true,
  createdAt: true,
  tenantId: true,
  userId: true,
  username: true,
  action: true,
  entity: true,
  entityId: true,
  oldValue: true,
  newValue: true,
  ipAddress: true,
  userAgent: true,
  result: true,
} as const;

/** P16 (ADR-0030 m.1): audit_logs.tenant_id artık FK değil → firma adı ayrı `IN` sorgusuyla; silinmiş firmada `tenant: null`. */
export type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof ROW_SELECT }> & { tenant: { name: string } | null };

export async function listAudit(db: Db, scope: AuditScope, f: AuditFilter, after: AuditCursor | null, take: number): Promise<AuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: auditWhere(scope, f, after),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: ROW_SELECT,
  });
  const ids = [...new Set(rows.flatMap((r) => (r.tenantId ? [r.tenantId] : [])))];
  const tenants = ids.length === 0 ? [] : await db.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(tenants.map((t) => [t.id, { name: t.name }]));
  return rows.map((r) => ({ ...r, tenant: (r.tenantId ? byId.get(r.tenantId) : undefined) ?? null }));
}

/** `limit + 1`'e kadar sayar (tüm aralığı taramaz). */
export function countAuditUpTo(db: Db, scope: AuditScope, f: AuditFilter, limit: number): Promise<number> {
  return db.auditLog.count({ where: auditWhere(scope, f, null), take: limit + 1 });
}

/** Satırlardaki kullanıcıların güncel adı ve durumu (user_id FK değil — ayrı sorgu; P16 maskesi `status` ister). */
export interface AuditUserInfo {
  fullName: string;
  avatarPath: string | null;
  status: string;
}

/**
 * P16 (S16-1): sayfadaki `user_id` ∪ (`entity = users` satırlarının `entity_id`) için tek `IN` sorgusu. Satırı OLMAYAN id
 * haritada yoktur — maske bunu "silinmiş" sayar (fail-closed).
 */
export async function userNames(db: Db, ids: readonly string[]): Promise<Map<string, AuditUserInfo>> {
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, fullName: true, avatarPath: true, status: true },
  });
  return new Map(users.map((u) => [u.id, { fullName: u.fullName, avatarPath: u.avatarPath, status: u.status }]));
}
