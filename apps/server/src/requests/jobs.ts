// Talep süpürücüsü ve anonimleştirme (mimari-e9 §2 Zamanlayıcı, §3.6; AC-141, 142, 145, 155, 159). jobs/scheduler.ts çağırır.
import { writeAudit } from "../audit/service.ts";
import { sweepPassiveTenantBindings } from "../bindings/service.ts";
import { sweepCustomerPassive } from "../customers/service.ts";
import * as repo from "./repo.ts";
import { SYSTEM, SYSTEM_CTX, type RequestService } from "./service.ts";

const BATCH = 500;
const ANON_BATCH = 1000;
const DAY_MS = 86_400_000;

export interface SweepResult {
  expired: number;
  connectFailed: number;
  tenantPassive: number;
  /** P8c (AC-171): pasif müşterinin bekleyenleri → CANCELLED(CUSTOMER_PASSIVE) (servis yolunun yedeği). */
  customerPassive: number;
  /** P8c (§3.4): pasif tenant'ın etkin kayıtları → TENANT_PASSIVE. */
  bindingsRevoked: number;
}

/** Süre dolumu (EXPIRED), kabul sonrası bağlanmama (CONNECT_FAILED), pasif tenant (CANCELLED/TENANT_PASSIVE). */
export async function sweepRequests(svc: RequestService, now = new Date(svc.d.clock.now())): Promise<SweepResult> {
  const out: SweepResult = { expired: 0, connectFailed: 0, tenantPassive: 0, customerPassive: 0, bindingsRevoked: 0 };
  for (const r of await repo.findExpired(svc.d.db, now, BATCH)) {
    const ok = await svc.d.db.$transaction(async (tx) => {
      if ((await repo.expireOne(tx, r.id, now)) === 0) return false;
      await writeAudit(tx, SYSTEM_CTX, {
        tenantId: r.tenantId,
        ...SYSTEM,
        action: "request.expired",
        entity: "support_requests",
        entityId: r.id,
        result: "success",
        oldValue: { status: "PENDING" },
        newValue: { status: "EXPIRED" },
      });
      return true;
    });
    if (!ok) continue;
    out.expired++;
    svc.d.hub.closeRequest(r.id, { t: "request.closed", status: "EXPIRED" });
    svc.d.hub.publish(r.tenantId, { t: "request.removed", id: r.id, status: "EXPIRED" });
    svc.countSlaBreach(r.id);
    svc.d.hub.queueChanged(r.tenantId);
    await svc.publishCount(r.tenantId);
  }
  for (const r of await repo.findConnectDue(svc.d.db, now, BATCH))
    if (await svc.connectTimeout(r.id, "connect_timeout")) out.connectFailed++;
  for (const r of await repo.findPassivePending(svc.d.db, BATCH)) if (await svc.cancelSystem(r.id, "TENANT_PASSIVE")) out.tenantPassive++;
  out.customerPassive = await sweepCustomerPassive(svc, BATCH);
  out.bindingsRevoked = await sweepPassiveTenantBindings(svc);
  pendingGauge.value = await repo.countAllPending(svc.d.db);
  return out;
}

/** /metrics `rs_requests_pending` (süpürücü turunda tazelenir). */
export const pendingGauge = { value: 0 };

/** Açılış (§3.5): PENDING talepler için 120 sn tolerans — istemciler yeniden bağlanabilir; bağlanmayan DISCONNECTED olur. */
export async function armOrphanedPending(svc: RequestService): Promise<number> {
  const rows = await repo.findAllPending(svc.d.db, 10_000);
  for (const r of rows)
    svc.d.hub.setDisconnect(
      r.id,
      () => void svc.cancelSystem(r.id, "DISCONNECTED").catch((e: unknown) => svc.logErr(e, "request_disconnect")),
      svc.d.timing.requestDisconnectMs,
    );
  return rows.length;
}

/**
 * AC-159 / P13a: tek tenant için `retention_days`'ten eski talepler anonimleştirilir (1000'lik partiler; jobs/retention.ts
 * tenant döngüsü). P18 H3: aynı TX'te mesajları silinir; sayı `counts.messages`'a eklenir (`purgedMessages`).
 */
export async function anonymizeRequestsOf(
  svc: RequestService,
  t: { tenantId: string; retentionDays: number },
  now: Date,
  counts: { messages: number } = { messages: 0 },
): Promise<number> {
  const cutoff = new Date(now.getTime() - t.retentionDays * DAY_MS);
  let total = 0;
  for (;;) {
    const n = await repo.anonymizeBatch(svc.d.db, t.tenantId, cutoff, ANON_BATCH);
    total += n.requests;
    counts.messages += n.messages;
    if (n.requests < ANON_BATCH) return total;
  }
}

/** Bir sonraki 03:30 Europe/Istanbul (UTC+3, DST yok) = 00:30 UTC. */
export function nextRetentionAt(nowMs: number): number {
  const d = new Date(nowMs);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 30, 0, 0);
  return at > nowMs ? at : at + DAY_MS;
}
