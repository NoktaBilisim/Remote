// Outbox işçisinin son durum yan etkileri (P27-K4, mimari-p27 §7.1 r2; AC-336): gözetimsiz cihaz rozeti ve son durum
// metrikleri. `notify/outbox.ts` `settle` TX'inden çağrılır.
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { writeAudit } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Metrics } from "../ops/metrics.ts";
import { OUTBOX_CTX } from "./outbox-enqueue.ts";

export interface SettleRow {
  id: string;
  tenantId: string;
  kind: string;
  channel: string;
  recipientMask: string;
  attempts: number;
  createdAt: Date;
  sessionId: string | null;
}

/**
 * "Son bildirim gönderilemedi" rozeti: `UNATTENDED_STARTED` FAILED → `notify_failed_at = now` + audit
 * `unattended.notify.failed`; SENT (`reason` null) → yalnız bu satırdan ÖNCE kaydedilmiş başarısızlığı kaldırır (aynı
 * oturumun eşzamanlı başarısız kardeşi silinmez).
 */
export async function deviceBadge(
  tx: Prisma.TransactionClient,
  row: SettleRow,
  deviceId: string,
  reason: string | null,
  now: number,
): Promise<void> {
  const where = { id: deviceId, tenantId: row.tenantId };
  if (reason === null) {
    await tx.unattendedDevice.updateMany({ where: { ...where, notifyFailedAt: { lt: row.createdAt } }, data: { notifyFailedAt: null } });
    return;
  }
  await tx.unattendedDevice.updateMany({ where, data: { notifyFailedAt: new Date(now) } });
  await writeAudit(tx, OUTBOX_CTX, {
    tenantId: row.tenantId,
    username: "system",
    action: UNATTENDED_AUDIT.NOTIFY_FAILED,
    entity: "support_sessions",
    entityId: row.sessionId,
    result: "fail",
    newValue: { sessionId: row.sessionId, deviceId, channel: row.channel, recipient: row.recipientMask, reason },
  });
}

/** `rs_notify_outbox_total` (rate_limited hariç), `rs_notify_rate_limited_total{wa_bucket}`, gecikme toplamı/sayısı. */
export function finalMetrics(metrics: Metrics, row: SettleRow, reason: string, now: number): void {
  if (reason === "rate_limited") metrics.inc("rs_notify_rate_limited_total", { scope: "wa_bucket", channel: row.channel });
  else metrics.inc("rs_notify_outbox_total", { channel: row.channel, result: reason === "ok" ? "sent" : "failed" });
  metrics.inc("rs_notify_outbox_latency_seconds_sum", { channel: row.channel }, (now - row.createdAt.getTime()) / 1000);
  metrics.inc("rs_notify_outbox_latency_seconds_count", { channel: row.channel });
}
