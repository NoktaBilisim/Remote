// Panel liste/detay ve P18 atama/öncelik sorguları (PT-K9: repo.ts'den taşındı; repo.ts yeniden dışa verir). Her sorgu
// tenant kapsamlı (AC-69, AC-148).
import { compareQueue } from "@remote/contracts/api/requests";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

const itemSelect = {
  id: true,
  requestCode: true,
  networkMatch: true,
  knownDevice: true,
  status: true,
  cancelReason: true,
  createdAt: true,
  closedAt: true,
  acceptedAt: true,
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  description: true,
  clientVersion: true,
  source: true,
  rejectMessage: true,
  acceptor: { select: { id: true, fullName: true } },
  session: { select: { id: true } },
  // P8c (AC-176, §15.1): müşteri firma + kayıt durumu (tek ek IN sorgusu; N+1 yok)
  bindingId: true,
  binding: { select: { revokedAt: true } },
  customer: { select: { id: true, name: true, status: true, refRotatedAt: true } },
  // P18 (AC-256..258)
  priority: true,
  assignee: { select: { id: true, fullName: true } },
  slaDueAt: true,
  afterHours: true,
} as const;
export type ItemRow = Prisma.SupportRequestGetPayload<{ select: typeof itemSelect }>;

/** P8c müşteri filtresi: `general` → customer_id IS NULL; ULID → o müşteri (tenant ile birlikte → IX(tenant_id, customer_id, …)). */
const customerWhere = (customer: string | undefined): Prisma.SupportRequestWhereInput =>
  customer === undefined ? {} : { customerId: customer === "general" ? null : customer };

/** P18 (AC-256): `me` → bana atananlar (IX(assigned_to, tenant_id, status)), `none` → atanmamış. */
const assignedWhere = (assigned: { mode: "me" | "none"; userId: string } | undefined): Prisma.SupportRequestWhereInput =>
  assigned === undefined ? {} : { assignedTo: assigned.mode === "me" ? assigned.userId : null };

export async function listPending(
  db: DbOrTx,
  tenantId: string,
  customer?: string,
  assigned?: { mode: "me" | "none"; userId: string },
  source?: string,
): Promise<{ rows: ItemRow[]; total: number }> {
  const where: Prisma.SupportRequestWhereInput = {
    tenantId,
    status: "PENDING",
    ...customerWhere(customer),
    ...assignedWhere(assigned),
    ...(source ? { source } : {}),
  };
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({ where, select: itemSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200 }),
    db.supportRequest.count({ where }),
  ]);
  return { rows: rows.sort(compareQueue), total };
}

export async function listHistory(
  db: DbOrTx,
  tenantId: string,
  since: Date,
  status: string | undefined,
  page: { skip: number; take: number },
  customer?: string,
  source?: string,
) {
  const where: Prisma.SupportRequestWhereInput = {
    tenantId,
    closedAt: { gte: since },
    ...(status ? { status } : {}),
    ...customerWhere(customer),
    ...(source ? { source } : {}),
  };
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({ where, select: itemSelect, orderBy: [{ closedAt: "desc" }, { id: "desc" }], ...page }),
    db.supportRequest.count({ where }),
  ]);
  return { rows, total };
}

/** P8c müşteri detayı "Talepler" sekmesi (AC-178): tüm durumlar, yeniden eskiye; IX(tenant_id, customer_id, created_at). */
export async function listByCustomer(db: DbOrTx, tenantId: string, customerId: string, page: { skip: number; take: number }) {
  const where: Prisma.SupportRequestWhereInput = { tenantId, customerId };
  const [rows, total] = await Promise.all([
    db.supportRequest.findMany({ where, select: itemSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...page }),
    db.supportRequest.count({ where }),
  ]);
  return { rows, total };
}

export function findItem(db: DbOrTx, tenantId: string, id: string): Promise<ItemRow | null> {
  return db.supportRequest.findFirst({ where: { id, tenantId }, select: itemSelect });
}

export function findStatusInTenant(db: DbOrTx, tenantId: string, id: string) {
  return db.supportRequest.findFirst({
    where: { id, tenantId },
    select: { status: true, acceptedBy: true, customerId: true, clientVersion: true, source: true },
  });
}

// ---------------- P18 öncelik / atama (mimari-e11 §8b.5; S-P18-T5) ----------------

/** Atama/öncelik TX'i: talep satırı kilidi (tenant kapsamlı; yoksa null). Kilit sırası users → support_requests. */
export async function lockRequest(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const rows = await tx.$queryRaw<
    { status: string; assigned_to: string | null; priority: string }[]
  >`SELECT status, assigned_to, priority FROM support_requests WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
  return rows[0] ?? null;
}

export async function setAssignee(tx: DbOrTx, tenantId: string, id: string, userId: string | null, now: Date): Promise<number> {
  const r = await tx.supportRequest.updateMany({
    where: { id, tenantId, status: "PENDING" },
    data: { assignedTo: userId, assignedAt: userId ? now : null },
  });
  return r.count;
}

export async function setPriority(tx: DbOrTx, tenantId: string, id: string, priority: string): Promise<number> {
  const r = await tx.supportRequest.updateMany({ where: { id, tenantId, status: "PENDING" }, data: { priority } });
  return r.count;
}

/**
 * S-P18-T5 (a): kullanıcı pasif/silinme/yetki kaybı ya da firma pasifinde o kullanıcıya (ya da `userId` verilmezse firmanın
 * tümüne) atanmış BEKLEYEN taleplerin ataması aynı TX'te kalkar. Kapalı taleplerde atama tarih olarak kalır.
 */
export async function unassignPending(tx: DbOrTx, where: { userId?: string; tenantId?: string }) {
  const filter: Prisma.SupportRequestWhereInput = {
    status: "PENDING",
    ...(where.userId ? { assignedTo: where.userId } : { assignedTo: { not: null } }),
    ...(where.tenantId ? { tenantId: where.tenantId } : {}),
  };
  const rows = await tx.supportRequest.findMany({
    where: filter,
    select: { id: true, tenantId: true, priority: true, slaDueAt: true, assignedTo: true },
    take: 1000,
  });
  if (rows.length === 0) return [];
  await tx.supportRequest.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: "PENDING" },
    data: { assignedTo: null, assignedAt: null },
  });
  return rows;
}
