// P28b kota kullanımı — TEK fonksiyon (mimari-p28b §3.1, K-P28b-10; AC-362). `UPLOADING` beyan edilen boyutla rezerve eder;
// teslim edilmemiş/silinmiş satırlar sayılmaz. P28e (mimari-p28e §5.2, V50): `DELETED` olmayan kayıtların düz metin toplamı eklenir
// (dosya ve kayıt tek kota kavramı).
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

export async function storageUsage(db: Db | Prisma.TransactionClient, tenantId: string): Promise<number> {
  const r = await db.$queryRaw<{ n: bigint | null }[]>`SELECT SUM(size_bytes) AS n FROM session_stored_files
    WHERE tenant_id = ${tenantId} AND state IN ('UPLOADING', 'SCANNING', 'CLEAN')`;
  const rec = await db.$queryRaw<{ n: bigint | null }[]>`SELECT SUM(size_bytes) AS n FROM session_recordings
    WHERE tenant_id = ${tenantId} AND state <> 'DELETED'`;
  return Number(r[0]?.n ?? 0) + Number(rec[0]?.n ?? 0);
}

/** Görünüm: kullanım + kota (bayt). */
export async function tenantStorage(
  db: Db | Prisma.TransactionClient,
  tenantId: string,
): Promise<{ usedBytes: number; quotaBytes: number }> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { storageQuotaGb: true } });
  return { usedBytes: await storageUsage(db, tenantId), quotaBytes: (t?.storageQuotaGb ?? 0) * 1024 ** 3 };
}
