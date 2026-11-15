// P27 müşteri pasifi → cihaz iptali (mimari-p27 §3.6 "Müşteri pasif"; AC-275). customers/write-tx.ts `deactivateTx` TX'inde:
// müşterinin iptal edilmemiş cihazları kilitlenir → `CUSTOMER_PASSIVE` (revoked_by NULL, last_ip NULL) + grant'lar silinir +
// cihaz başına audit; bekleyen kayıt kodları silinir (D-P27-K2). Commit sonrası çağıran `rooms.devices.revoked(id)` ile soketi/odayı kapatır.
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";

export async function revokeCustomerDevicesTx(
  tx: Prisma.TransactionClient,
  ctx: AuditContext,
  actor: { userId: string; username: string },
  o: { tenantId: string; customerId: string; now: Date },
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM unattended_devices
    WHERE tenant_id = ${o.tenantId} AND customer_id = ${o.customerId} AND revoked_at IS NULL ORDER BY id FOR UPDATE`;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return ids;
  await tx.unattendedDevice.updateMany({
    where: { tenantId: o.tenantId, id: { in: ids }, revokedAt: null },
    data: { revokedAt: o.now, revokedBy: null, revokeReason: "CUSTOMER_PASSIVE", lastIp: null },
  });
  await tx.unattendedDeviceGrant.deleteMany({ where: { tenantId: o.tenantId, deviceId: { in: ids } } });
  for (const id of ids)
    await writeAudit(tx, ctx, {
      tenantId: o.tenantId,
      ...actor,
      action: UNATTENDED_AUDIT.DEVICE_REVOKED,
      entity: "unattended_devices",
      entityId: id,
      result: "success",
      newValue: { reason: "CUSTOMER_PASSIVE" },
    });
  return ids;
}

/**
 * D-P27-K2: müşteri pasifinde bekleyen (kullanılmamış) kayıt kodları aynı TX'te silinir; sayı müşteri pasif audit'ine yazılır.
 * Müşteri satırı çağıranda X kilitli; kayıt TX'i müşteriyi FOR SHARE ile okuduğundan silinen kod bu TX'ten sonra kullanılamaz.
 */
async function dropCustomerCodesTx(tx: Prisma.TransactionClient, tenantId: string, customerId: string): Promise<number> {
  return (await tx.unattendedRegistrationCode.deleteMany({ where: { tenantId, customerId, usedAt: null } })).count;
}

/** `deactivateTx` için tek giriş: cihaz iptali + bekleyen kod silme (aynı TX). */
export async function customerPassiveUnattendedTx(
  tx: Prisma.TransactionClient,
  ctx: AuditContext,
  actor: { userId: string; username: string },
  o: { tenantId: string; customerId: string; now: Date },
): Promise<{ devices: string[]; codes: number }> {
  const devices = await revokeCustomerDevicesTx(tx, ctx, actor, o);
  return { devices, codes: await dropCustomerCodesTx(tx, o.tenantId, o.customerId) };
}
