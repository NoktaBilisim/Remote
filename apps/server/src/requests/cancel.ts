// Talep iptali ve bağlanma zaman aşımı TX'leri (AC-141, 145, 155; §13.3) — PT-K9: service.ts `customerCancel` /
// `resendFinal` / `cancelSystem` / `connectTimeout` gövdelerinin mekanik taşınması. Sınıf yöntemleri bu işlevleri çağırır;
// TX sınırı, audit ve commit sonrası bellek adımlarının sırası aynı.
import { writeAudit, type AuditContext } from "../audit/service.ts";
import * as repo from "./repo.ts";
import { CUSTOMER, SYSTEM, SYSTEM_CTX, type RequestService } from "./service.ts";

/**
 * Müşteri iptali (`request.cancel` / `request.decline` / close 1000 / REST): PENDING → CANCELLED(CUSTOMER);
 * ACCEPTED + oturum PENDING → decline (§13.3): oturum CANCELLED(customer_declined) + talep CANCELLED(CUSTOMER), tek TX.
 * Oturum ACTIVE olmuşsa yok sayılır.
 */
export async function customerCancelOf(svc: RequestService, ctx: AuditContext, row: repo.SecretRow): Promise<void> {
  const now = new Date(svc.d.clock.now());
  if (row.status === "PENDING") {
    await cancelPendingByCustomer(svc, ctx, row, now);
    return;
  }
  if (row.status !== "ACCEPTED" || row.session?.status !== "PENDING") return;
  await declineAccepted(svc, ctx, row, row.session.id, now);
}

async function cancelPendingByCustomer(svc: RequestService, ctx: AuditContext, row: repo.SecretRow, now: Date): Promise<void> {
  const ok = await svc.d.db.$transaction(async (tx) => {
    if ((await repo.cancelPending(tx, row.id, "CUSTOMER", now)) === 0) return false;
    await writeAudit(tx, ctx, {
      tenantId: row.tenantId,
      ...CUSTOMER,
      action: "request.cancelled",
      entity: "support_requests",
      entityId: row.id,
      result: "success",
      oldValue: { status: "PENDING" },
      newValue: { status: "CANCELLED", reason: "CUSTOMER" },
    });
    return true;
  });
  if (ok) await svc.closedAfterCommit(row.tenantId, row.id, "CANCELLED", { reason: "CUSTOMER" });
  else await resendFinal(svc, row.id);
}

async function declineAccepted(svc: RequestService, ctx: AuditContext, row: repo.SecretRow, sessionId: string, now: Date): Promise<void> {
  const ok = await svc.d.db.$transaction(async (tx) => {
    if ((await repo.cancelRequestSession(tx, row.id, now, "CUSTOMER", "customer_declined")) === 0) return false;
    if ((await repo.cancelAccepted(tx, row.id)) === 0) throw new Error("request_decline_state");
    await writeAudit(tx, ctx, {
      tenantId: row.tenantId,
      ...CUSTOMER,
      action: "request.cancelled",
      entity: "support_requests",
      entityId: row.id,
      result: "success",
      oldValue: { status: "ACCEPTED" },
      newValue: { status: "CANCELLED", reason: "CUSTOMER", phase: "accepted", sessionId },
    });
    return true;
  });
  if (!ok) return;
  svc.clearConnectTimer(row.id);
  svc.d.rooms.closeSession(sessionId, "cancelled");
  if (row.acceptedBy) svc.d.hub.sendToUser(row.tenantId, row.acceptedBy, { t: "request.declined", id: row.id, sessionId });
  svc.d.hub.closeRequest(row.id, { t: "request.closed", status: "CANCELLED", reason: "CUSTOMER" });
}

/** Yarışta kaybeden müşteri isteği: güncel son durumu bildir (ör. süre doldu). */
async function resendFinal(svc: RequestService, requestId: string): Promise<void> {
  const r = await repo.findById(svc.d.db, requestId);
  if (r && (r.status === "EXPIRED" || r.status === "CANCELLED"))
    svc.d.hub.closeRequest(requestId, { t: "request.closed", status: r.status });
}

/** Sistem iptali: DISCONNECTED (120 sn kopma) / TENANT_PASSIVE (AC-141, 145). */
export async function cancelSystemOf(svc: RequestService, requestId: string, reason: repo.SystemCancelReason): Promise<boolean> {
  const now = new Date(svc.d.clock.now());
  const row = await svc.d.db.$transaction(async (tx) => {
    const r = await repo.findById(tx, requestId);
    if (!r || (await repo.cancelPending(tx, requestId, reason, now)) === 0) return null;
    await writeAudit(tx, SYSTEM_CTX, {
      tenantId: r.tenantId,
      ...SYSTEM,
      action: "request.cancelled",
      entity: "support_requests",
      entityId: requestId,
      result: "success",
      oldValue: { status: "PENDING" },
      newValue: { status: "CANCELLED", reason },
    });
    return r;
  });
  if (!row) return false;
  await svc.closedAfterCommit(row.tenantId, requestId, "CANCELLED", { reason });
  return true;
}

/**
 * ACCEPTED → CONNECT_FAILED + oturum PENDING → CANCELLED(`connect_timeout`|`auth_revoked`), tek TX. Oturum admit
 * edilmişse (consumed) hiçbir şey yapılmaz. Kabul edene `request.connect_failed`, müşteriye `request.closed`.
 */
export async function connectTimeoutOf(
  svc: RequestService,
  requestId: string,
  endReason: "connect_timeout" | "auth_revoked",
): Promise<boolean> {
  svc.clearConnectTimer(requestId);
  const now = new Date(svc.d.clock.now());
  const res = await svc.d.db.$transaction(async (tx) => {
    const r = await repo.findById(tx, requestId);
    if (!r || r.status !== "ACCEPTED") return null;
    const sess = await tx.supportSession.findFirst({ where: { requestId }, select: { id: true, status: true, consumedAt: true } });
    if (!sess || sess.consumedAt) return null;
    if (sess.status === "PENDING") await repo.cancelRequestSession(tx, requestId, now, "SYSTEM", endReason);
    if ((await repo.connectFailed(tx, requestId)) === 0) return null;
    await writeAudit(tx, SYSTEM_CTX, {
      tenantId: r.tenantId,
      ...SYSTEM,
      action: "request.connect_failed",
      entity: "support_requests",
      entityId: requestId,
      result: "success",
      oldValue: { status: "ACCEPTED" },
      newValue: { status: "CONNECT_FAILED", sessionId: sess.id, reason: endReason },
    });
    return { r, sessionId: sess.id };
  });
  if (!res) return false;
  svc.d.rooms.closeSession(res.sessionId, endReason === "auth_revoked" ? "cancelled" : "timeout");
  if (res.r.acceptedBy)
    svc.d.hub.sendToUser(res.r.tenantId, res.r.acceptedBy, { t: "request.connect_failed", id: requestId, sessionId: res.sessionId });
  svc.d.hub.closeRequest(requestId, { t: "request.closed", status: "CONNECT_FAILED" });
  return true;
}
