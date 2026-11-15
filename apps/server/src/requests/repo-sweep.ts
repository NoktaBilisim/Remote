// Süpürücü ve saklama/anonimleştirme sorguları (PT-K9: repo.ts'den taşındı; repo.ts yeniden dışa verir).
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

// ---------------- Süpürücü ----------------

export function findExpired(db: DbOrTx, now: Date, take: number) {
  return db.supportRequest.findMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    select: { id: true, tenantId: true },
    orderBy: { expiresAt: "asc" },
    take,
  });
}

/** Kabul edilmiş ama bağlanmamış: oturum PENDING ve süresi dolmuş ya da tüketilmeden kapanmış (teknisyen iptali vb.). */
export function findConnectDue(db: DbOrTx, now: Date, take: number) {
  return db.supportRequest.findMany({
    where: {
      status: "ACCEPTED",
      session: {
        is: { consumedAt: null, OR: [{ status: "PENDING", expiresAt: { lte: now } }, { status: { in: ["CANCELLED", "EXPIRED"] } }] },
      },
    },
    select: { id: true, tenantId: true },
    take,
  });
}

/** Pasif/silinmiş tenant'ın bekleyenleri (AC-145). */
export function findPassivePending(db: DbOrTx, take: number) {
  return db.supportRequest.findMany({
    where: { status: "PENDING", tenant: { is: { OR: [{ status: { not: "ACTIVE" } }, { deletedAt: { not: null } }] } } },
    select: { id: true, tenantId: true },
    take,
  });
}

/** P8c (AC-171): pasif müşterinin bekleyenleri (süpürücü yedek yolu; servis yolu deactivate sonrası). */
export function findCustomerPassivePending(db: DbOrTx, take: number) {
  return db.supportRequest.findMany({
    where: { status: "PENDING", customer: { is: { status: "PASSIVE" } } },
    select: { id: true, tenantId: true },
    take,
  });
}

export function findPendingOfCustomer(db: DbOrTx, tenantId: string, customerId: string) {
  return db.supportRequest.findMany({ where: { tenantId, customerId, status: "PENDING" }, select: { id: true, tenantId: true } });
}

export function findAllPending(db: DbOrTx, take: number) {
  return db.supportRequest.findMany({ where: { status: "PENDING" }, select: { id: true, tenantId: true }, take });
}

export function countAllPending(db: DbOrTx): Promise<number> {
  return db.supportRequest.count({ where: { status: "PENDING" } });
}

// ---------------- Anonimleştirme (AC-159) ----------------

/**
 * S16-14 (P16 G2): `anonymized_at` DB saatiyle (`UTC_TIMESTAMP(3)`) yazılır — iş mantıksal saatle (`cutoff`) aday seçer,
 * damga S16-3 tetikleyicisinin `[UTC − 1 g, UTC + 1 dk]` aralığında kalır (uygulama saati ileride olsa da). Prisma
 * `@updatedAt` ham ifadede çalışmadığı için `updated_at` de DB saatiyle. IX(tenant_id, anonymized_at, created_at).
 */
/**
 * AC-159 / P18 H3 (ADR-0025 m.3, mimari-e11 §8b.1 Retention): parti kimlikleri kilitlenir → PII temizlenir → aynı TX'te
 * o taleplerin `session_messages` satırları silinir (tetikleyici `anonymized_at` aynı TX'te yazıldığı için izin verir).
 * P19: aynı TX'te `notification_outbox` satırları da silinir (sayıya katılmaz; metrik J3'te).
 */
export async function anonymizeBatch(
  db: Db,
  tenantId: string,
  cutoff: Date,
  limit: number,
): Promise<{ requests: number; messages: number }> {
  return db.$transaction(async (tx) => {
    const ids = (
      await tx.$queryRaw<{ id: string }[]>`SELECT id FROM support_requests
        WHERE tenant_id = ${tenantId} AND anonymized_at IS NULL AND created_at < ${cutoff} LIMIT ${limit} FOR UPDATE`
    ).map((r) => r.id);
    if (ids.length === 0) return { requests: 0, messages: 0 };
    const requests = await tx.$executeRaw`UPDATE support_requests
      SET customer_name = NULL, customer_phone = NULL, customer_email = NULL, description = NULL, ip = NULL, ip_key = NULL,
          net_key = NULL, device_hash = NULL, anonymized_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
      WHERE tenant_id = ${tenantId} AND id IN (${Prisma.join(ids)}) AND anonymized_at IS NULL`;
    const messages = (await tx.sessionMessage.deleteMany({ where: { tenantId, requestId: { in: ids } } })).count;
    // P19 (§8c.1 Retention, B2): bildirim kuyruğu satırları (recipient_hash kişisel veri) aynı TX'te silinir; aksi hâlde
    // purgeAnonymized'in talep silmesi FK RESTRICT'e takılırdı. UQ(request_id, tenant_id, …) aralığı.
    await tx.notificationOutbox.deleteMany({ where: { tenantId, requestId: { in: ids } } });
    return { requests, messages };
  });
}

export function retentionTenants(db: DbOrTx) {
  return db.tenantSettings.findMany({ select: { tenantId: true, retentionDays: true } });
}
