// Oturum geçmişi veri erişimi (P8; mimari-api "Oturum geçmişi (P8)", db-notlari P8 "Backend-dev için").
// Kapsam (`HistoryScope`) her sorguda zorunlu; tüm-tenant değeri (`kind: "all"`) yalnız service.historyScope üretir.
import type { SessionListSort, SessionMode, SessionSource, SessionStatus } from "@remote/contracts/api/sessions";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

declare const allTenantsBrand: unique symbol;
/** Firma seçmemiş SUPER_ADMIN (mimari §5.1 istisnası). Marka: başka modül bu değeri elle kuramaz (yalnız historyScope). */
export type AllTenantsScope = { readonly kind: "all"; readonly [allTenantsBrand]: true };
export type TenantHistoryScope = { readonly kind: "tenant"; readonly tenantId: string; readonly technicianId?: string };
export type HistoryScope = TenantHistoryScope | AllTenantsScope;

/** Kapsamın uyguladığı filtreler servis tarafından çözülmüştür (USER'da technicianId, tenant kapsamında tenantId yok). */
export interface HistoryFilter {
  status?: SessionStatus;
  mode?: SessionMode;
  /** P8b (AC-158): TECH = request_id IS NULL, REQUEST = IS NOT NULL. */
  source?: SessionSource;
  /** created_at >= from (UTC anı) */
  from?: Date;
  /** created_at < to (UTC anı) */
  to?: Date;
  technicianId?: string;
  tenantId?: string;
  customer?: string;
  /** P8c (AC-179): "none" = customer_id IS NULL; aksi müşteri kimliği. */
  customerFirm?: string;
}

/** Prisma 7 (MySQL) `contains` LIKE jokerlerini kaçışlamaz (db-notlari P8): `%`, `_`, `\` literal aranır. */
export const escapeLike = (q: string): string => q.replace(/[\\%_]/g, "\\$&");

/** Kapsam her zaman filtreden sonra yazılır (ezer). */
export function historyWhere(scope: HistoryScope, f: HistoryFilter = {}): Prisma.SupportSessionWhereInput {
  const scoped: Prisma.SupportSessionWhereInput =
    scope.kind === "all"
      ? { ...(f.tenantId ? { tenantId: f.tenantId } : {}) }
      : { tenantId: scope.tenantId, ...(scope.technicianId ? { technicianId: scope.technicianId } : {}) };
  return {
    ...(f.technicianId ? { technicianId: f.technicianId } : {}),
    ...scoped,
    ...(f.status ? { status: f.status } : {}),
    ...(f.mode ? { mode: f.mode } : {}),
    ...(f.source ? { requestId: f.source === "REQUEST" ? { not: null } : null } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.customer ? { customerName: { contains: escapeLike(f.customer) } } : {}),
    ...(f.customerFirm ? { customerId: f.customerFirm === "none" ? null : f.customerFirm } : {}),
  };
}

const listSelect = {
  id: true,
  tenantId: true,
  status: true,
  activeCode: true,
  techVerifyCode: true,
  createdAt: true,
  expiresAt: true,
  endedAt: true,
  endedBy: true,
  endReason: true,
  mode: true,
  consumedAt: true,
  customerName: true,
  ticketNo: true,
  technician: { select: { id: true, fullName: true } },
  tenant: { select: { id: true, name: true } },
  // P8b (AC-158): kaynak + bekleme (talep→kabul)
  requestId: true,
  request: { select: { createdAt: true, acceptedAt: true } },
  // P8c (AC-179): müşteri firma (tek ek IN sorgusu, N+1 yok)
  customer: { select: { id: true, name: true, status: true } },
  // P13a (AC-197): anonimleştirme işareti
  anonymizedAt: true,
} as const;

export type HistoryListRow = Prisma.SupportSessionGetPayload<{ select: typeof listSelect }>;

const orderOf = (sort: SessionListSort): Prisma.SupportSessionOrderByWithRelationInput[] => {
  const dir = sort === "createdAt:asc" ? "asc" : "desc";
  return [{ createdAt: dir }, { id: dir }]; // ikincil sıra aynı yön (kararlı sayfalama, filesort yok)
};

/** `count` ve `findMany` aynı `where` (§1); N+1 yok (technician/tenant tek select). */
export async function listHistory(
  db: DbOrTx,
  scope: HistoryScope,
  f: HistoryFilter,
  sort: SessionListSort,
  page: { skip: number; take: number },
): Promise<{ rows: HistoryListRow[]; total: number }> {
  const where = historyWhere(scope, f);
  const [rows, total] = await Promise.all([
    db.supportSession.findMany({ where, select: listSelect, orderBy: orderOf(sort), ...page }),
    db.supportSession.count({ where }),
  ]);
  return { rows, total };
}

export function countHistory(db: DbOrTx, scope: HistoryScope, f: HistoryFilter): Promise<number> {
  return db.supportSession.count({ where: historyWhere(scope, f) });
}

const exportSelect = { ...listSelect, note: true } as const;
export type HistoryExportRow = Prisma.SupportSessionGetPayload<{ select: typeof exportSelect }>;

/** CSV partisi: (created_at, id) keyset imleci (offset değil; db-notlari P8). */
export function exportBatch(
  db: DbOrTx,
  scope: HistoryScope,
  f: HistoryFilter,
  sort: SessionListSort,
  after: { createdAt: Date; id: string } | null,
  take: number,
): Promise<HistoryExportRow[]> {
  const asc = sort === "createdAt:asc";
  const cursor: Prisma.SupportSessionWhereInput | null = after
    ? {
        OR: [
          { createdAt: asc ? { gt: after.createdAt } : { lt: after.createdAt } },
          { createdAt: after.createdAt, id: asc ? { gt: after.id } : { lt: after.id } },
        ],
      }
    : null;
  const where = historyWhere(scope, f);
  return db.supportSession.findMany({
    where: cursor ? { AND: [where, cursor] } : where,
    select: exportSelect,
    orderBy: orderOf(sort),
    take,
  });
}

const detailSelect = {
  ...listSelect,
  technicianId: true,
  customerEmail: true,
  note: true,
  terminatedBy: true,
  qualitySummary: true,
  request: {
    select: {
      id: true,
      createdAt: true,
      acceptedAt: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      description: true,
    },
  },
} as const;

export type HistoryDetailRow = Prisma.SupportSessionGetPayload<{ select: typeof detailSelect }>;

export function findHistory(db: DbOrTx, scope: HistoryScope, id: string): Promise<HistoryDetailRow | null> {
  return db.supportSession.findFirst({ where: { ...historyWhere(scope), id }, select: detailSelect });
}

/** Detay alt listeleri: `created_at, id` artan, en çok `take`. Hepsi oturumun tenant'ıyla (bileşik indeks). */
export function consentsOf(db: DbOrTx, s: { id: string; tenantId: string }, take: number) {
  return db.sessionConsent.findMany({
    where: { sessionId: s.id, tenantId: s.tenantId },
    select: {
      id: true,
      createdAt: true,
      level: true,
      decision: true,
      source: true,
      consentText: { select: { id: true, version: true, sha256: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
}

export function filesOf(db: DbOrTx, s: { id: string; tenantId: string }, take: number) {
  return db.sessionFile.findMany({
    where: { sessionId: s.id, tenantId: s.tenantId },
    select: {
      id: true,
      direction: true,
      fileName: true,
      sizeBytes: true,
      sha256: true,
      result: true,
      createdAt: true,
      reportedBy: true,
      matchKey: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
}

/** P15 (AC-238): CSV "Dosyalar" hücresi için parti oturumlarının rapor satırları (yalnız eşleme alanları; fid'siz eşleme için yön/özet/boyut). */
export function fileReportsOf(db: DbOrTx, tenantIds: readonly string[], sessionIds: readonly string[]) {
  return db.sessionFile.findMany({
    where: { sessionId: { in: [...sessionIds] }, tenantId: { in: [...tenantIds] } },
    select: { id: true, sessionId: true, reportedBy: true, matchKey: true, direction: true, sha256: true, sizeBytes: true },
  });
}

const auditSelect = {
  id: true,
  createdAt: true,
  userId: true,
  username: true,
  action: true,
  oldValue: true,
  newValue: true,
  result: true,
} as const;
export type HistoryAuditRow = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

/** IX(tenant_id, entity, entity_id, created_at) (dba P8). IP/UA seçilmez. */
export function auditsOf(
  db: DbOrTx,
  s: { id: string; tenantId: string },
  actions: readonly string[],
  take: number,
): Promise<HistoryAuditRow[]> {
  return db.auditLog.findMany({
    where: { tenantId: s.tenantId, entity: "support_sessions", entityId: s.id, action: { in: [...actions] } },
    select: auditSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
}

export function userNames(db: DbOrTx, ids: readonly string[]) {
  return ids.length === 0
    ? Promise.resolve([])
    : db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullName: true } });
}

/** Kapsam koşulu UPDATE'in kendisinde (§4); count 0 → 404. */
/** P13a: `anonymized_at IS NULL` koşulu — eşzamanlı anonimleştirmeden sonra 0 satır (servis 409 döner, DB 3819'a gitmez). */
export async function updateNotes(
  db: DbOrTx,
  scope: HistoryScope,
  id: string,
  data: { ticketNo?: string | null; note?: string | null },
): Promise<number> {
  const r = await db.supportSession.updateMany({ where: { ...historyWhere(scope), id, anonymizedAt: null }, data });
  return r.count;
}
