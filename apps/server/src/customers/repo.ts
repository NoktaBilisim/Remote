// customers erişimi (mimari-e10 §3.1, §7; db-notlari P8c-1 "Backend-dev için"). Her sorgu tenant kapsamlı (AC-172).
// Kurallar: `status` + `passiveAt` aynı UPDATE'te; PII yazan UPDATE `anonymizedAt: null` yazar; `nameKey`/`searchKey`
// her ad/kişi/telefon yazımında `customerKeys` ile yeniden hesaplanır (CHECK customers_search_key_chk).
import type { CustomerListSort, CustomerStatusFilter } from "@remote/contracts/api/customers";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { escapeLike } from "../sessions/history-repo.ts";

type DbOrTx = Db | Prisma.TransactionClient;

export const detailSelect = {
  id: true,
  tenantId: true,
  name: true,
  status: true,
  fileLabel: true,
  requestRef: true,
  refRotatedAt: true,
  contactName: true,
  phone: true,
  email: true,
  note: true,
  passiveAt: true,
  anonymizedAt: true,
  createdAt: true,
  defaultPriority: true, // P18 (AC-257)
  slaMinutes: true,
} as const;
export type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof detailSelect }>;

const listSelect = { id: true, name: true, status: true, fileLabel: true, requestRef: true, createdAt: true } as const;
export type CustomerListRow = Prisma.CustomerGetPayload<{ select: typeof listSelect }>;

const statusWhere = (s: CustomerStatusFilter): Prisma.CustomerWhereInput =>
  s === "all" ? {} : { status: s === "active" ? "ACTIVE" : "PASSIVE" };

/** Arama (AC-166): katlanmış `q` `search_key` içinde; rakam ağırlıklı girişte ayrıca yalnız rakamlar (baştaki 0 atılır). */
function searchWhere(folded: string | undefined, digits: string | undefined): Prisma.CustomerWhereInput {
  if (!folded) return {};
  const or: Prisma.CustomerWhereInput[] = [{ searchKey: { contains: escapeLike(folded) } }];
  if (digits && digits !== folded) or.push({ searchKey: { contains: digits } });
  return { OR: or };
}

export async function list(
  db: DbOrTx,
  tenantId: string,
  f: { status: CustomerStatusFilter; folded?: string | undefined; digits?: string | undefined; sort: CustomerListSort },
  page: { skip: number; take: number },
): Promise<{ rows: CustomerListRow[]; total: number }> {
  const where: Prisma.CustomerWhereInput = { tenantId, ...statusWhere(f.status), ...searchWhere(f.folded, f.digits) };
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    f.sort === "createdAt:desc" ? [{ createdAt: "desc" }, { id: "desc" }] : [{ nameKey: "asc" }, { id: "asc" }];
  const [rows, total] = await Promise.all([
    db.customer.findMany({ where, select: listSelect, orderBy, ...page }),
    db.customer.count({ where }),
  ]);
  return { rows, total };
}

/** Türetilmiş sayaçlar (AC-166, V24): sayfadaki ≤ 100 id için TEK gruplama sorgusu — IX(tenant_id, customer_id, created_at). */
export async function requestStats(
  db: DbOrTx,
  tenantId: string,
  ids: string[],
): Promise<Map<string, { count: number; last: Date | null }>> {
  if (ids.length === 0) return new Map();
  const g = await db.supportRequest.groupBy({
    by: ["customerId"],
    where: { tenantId, customerId: { in: ids } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return new Map(
    g.filter((x) => x.customerId !== null).map((x) => [x.customerId as string, { count: x._count._all, last: x._max.createdAt }]),
  );
}

export function sessionCount(db: DbOrTx, tenantId: string, customerId: string): Promise<number> {
  return db.supportSession.count({ where: { tenantId, customerId } });
}

/** `options` (combobox): ad öneki ya da arama anahtarında geçen, ≤ take, `name_key` sırası. */
export function options(db: DbOrTx, tenantId: string, status: "active" | "all", folded: string | undefined, take: number) {
  const q = folded ? { OR: [{ nameKey: { startsWith: escapeLike(folded) } }, { searchKey: { contains: escapeLike(folded) } }] } : {};
  return db.customer.findMany({
    where: { tenantId, ...(status === "active" ? { status: "ACTIVE" } : {}), ...q },
    select: { id: true, name: true, status: true },
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
    take,
  });
}

export function find(db: DbOrTx, tenantId: string, id: string): Promise<CustomerRow | null> {
  return db.customer.findFirst({ where: { id, tenantId }, select: detailSelect });
}

/** Durum değiştiren işlemlerde satır kilidi (yenileme/pasif/aktif ve kayıt verme yarışı). */
export async function lock(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CustomerRow | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customers WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
  return rows.length === 0 ? null : tx.customer.findUnique({ where: { id }, select: detailSelect });
}

/**
 * B-P8c-1: talep oluşturma / kabul / kayıt verme TX'lerinde müşteri durumu PAYLAŞIMLI kilitle ve kilitli okumanın
 * kendisinden (REPEATABLE READ anlık görüntüsü değil, son commit) okunur. Eşzamanlı pasife alma (FOR UPDATE) bekler ya da
 * beklenir; yoksa null.
 */
export async function shareStatus(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<string | null> {
  const rows = await tx.$queryRaw<
    { status: string }[]
  >`SELECT status FROM customers WHERE id = ${id} AND tenant_id = ${tenantId} FOR SHARE`;
  return rows[0]?.status ?? null;
}

export async function insert(tx: DbOrTx, data: Prisma.CustomerUncheckedCreateInput): Promise<void> {
  await tx.customer.create({ data, select: { id: true } });
}

export async function update(
  tx: DbOrTx,
  tenantId: string,
  id: string,
  data: Prisma.CustomerUncheckedUpdateManyInput,
  where: Prisma.CustomerWhereInput = {},
): Promise<number> {
  const r = await tx.customer.updateMany({ where: { id, tenantId, ...where }, data });
  return r.count;
}

/** Anonimleştirme adayları (AC-195): pasif + `passive_at` saklama süresinden eski + henüz anonim değil — IX(status, passive_at). */
export function anonymizeCandidates(db: DbOrTx, tenantId: string, cutoff: Date, take: number) {
  return db.customer.findMany({
    where: { tenantId, status: "PASSIVE", passiveAt: { lt: cutoff }, anonymizedAt: null },
    select: { id: true, name: true },
    take,
  });
}

export function countActive(db: DbOrTx): Promise<number> {
  return db.customer.count({ where: { status: "ACTIVE" } });
}
