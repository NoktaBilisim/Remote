// P27 müşteri pasifi → cihaz iptali (mimari-p27 §3.6 "Müşteri pasif"; AC-275). customers/write-tx.ts `deactivateTx` TX'inde:
// müşterinin iptal edilmemiş cihazları kilitlenir → `CUSTOMER_PASSIVE` (revoked_by NULL, last_ip NULL) + grant'lar silinir +
// cihaz başına audit. Commit sonrası çağıran `rooms.devices.revoked(id)` ile soketi/odayı kapatır.
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
