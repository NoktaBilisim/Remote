// Panel tarafı talep işlemleri (AC-146..148, 152, 153, 155, 157; mimari-api "Panel"). Kapsam: tenantScope (Super Admin firma
// seçmeli). Kabul TX'i (mimari-e9 §3.4): teknisyen satırı FOR UPDATE → açık oturum sınırı → koşullu UPDATE → oturum INSERT
// → audit → commit; bellek (ön-kabul, ticket, hub) commit sonrası.
import type {
  AcceptRequestResponse,
  ListRequestsQuery,
  NetworkMatch,
  RequestPriority,
  RequestSource,
  RequestStatus,
  CancelReason,
  SupportRequestItem,
  SupportRequestListResponse,
} from "@remote/contracts/api/requests";
import { ASSIGNEE_INVALID_MESSAGE, slaBreachedAt, REQUEST_HISTORY_DAYS } from "@remote/contracts/api/requests";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { AppError } from "../lib/errors.ts";
import type { CustomerStatus } from "@remote/contracts/api/customers";
import { REQUEST_COMMS_AUDIT } from "@remote/contracts/audit";
import { effectivePermissions, type Role } from "@remote/contracts/permissions";
import type { Prisma } from "../generated/prisma/client.ts";
import { acceptTx, afterAccept } from "./panel-accept.ts";
import { who } from "./panel-settings.ts";
import * as repo from "./repo.ts";
import type { RequestService } from "./service.ts";

const DAY_MS = 86_400_000;

const sec = (ms: number): number => Math.max(0, Math.floor(ms / 1000));

/** Kayıt etkin mi + kaynak bayat mı (aşağıdaki `toItem` notu). */
function sourceState(r: repo.ItemRow, generalRotatedAt: Date | null): { bindingActive: boolean; staleSource: boolean } {
  const bindingActive = r.bindingId !== null && r.binding?.revokedAt === null;
  const rotatedAt = r.customer ? r.customer.refRotatedAt : generalRotatedAt;
  const staleSource = r.bindingId !== null ? !bindingActive : rotatedAt !== null && r.createdAt.getTime() < rotatedAt.getTime();
  return { bindingActive, staleSource };
}

/**
 * `generalRotatedAt`: tenant Genel ref'inin son yenilenmesi (staleSource, §15.1). Müşteri ref'inde müşterinin
 * `refRotatedAt`'i; kayıtla açılanda kayıt geçersizse bayat.
 */
export function toItem(r: repo.ItemRow, now: number, generalRotatedAt: Date | null): SupportRequestItem {
  const { bindingActive, staleSource } = sourceState(r, generalRotatedAt);
  const end = r.status === "PENDING" ? now : (r.acceptedAt ?? r.closedAt ?? r.createdAt).getTime();
  return {
    id: r.id,
    requestCode: r.requestCode,
    networkMatch: r.networkMatch as NetworkMatch,
    knownDevice: r.knownDevice,
    status: r.status as RequestStatus,
    cancelReason: (r.cancelReason as CancelReason | null) ?? null,
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
    waitSec: sec(end - r.createdAt.getTime()),
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    description: r.description,
    clientVersion: r.clientVersion,
    source: r.source as RequestSource,
    acceptedBy: r.acceptor ? { id: r.acceptor.id, name: r.acceptor.fullName } : null,
    rejectMessage: r.rejectMessage,
    sessionId: r.session?.id ?? null,
    customerFirm: r.customer ? { id: r.customer.id, name: r.customer.name, status: r.customer.status as CustomerStatus } : null,
    viaBinding: bindingActive,
    bindingRevoked: r.bindingId !== null && !bindingActive,
    staleSource,
    priority: r.priority as RequestPriority,
    assignedTo: r.assignee ? { id: r.assignee.id, name: r.assignee.fullName } : null,
    slaDueAt: r.slaDueAt?.toISOString() ?? null,
    slaBreached: slaBreachedAt({ status: r.status, slaDueAt: r.slaDueAt, closedAt: r.closedAt, acceptedAt: r.acceptedAt }, now),
    afterHours: r.afterHours,
  };
}

/** Tenant Genel ref'inin son yenileme anı (staleSource); ayar yoksa null. */
export async function generalRotatedAt(svc: RequestService, tenantId: string): Promise<Date | null> {
  return (await repo.settingsByTenant(svc.d.db, tenantId))?.refRotatedAt ?? null;
}

export async function listRequests(
  svc: RequestService,
  tenantId: string,
  q: ListRequestsQuery,
  userId: string,
): Promise<SupportRequestListResponse> {
  const now = svc.d.clock.now();
  const rotated = await generalRotatedAt(svc, tenantId);
  if (q.tab === "pending") {
    const assigned = q.assigned ? { mode: q.assigned, userId } : undefined;
    const { rows, total } = await repo.listPending(svc.d.db, tenantId, q.customer, assigned, q.source);
    return { items: rows.map((r) => toItem(r, now, rotated)), page: 1, pageSize: rows.length, total };
  }
  const since = new Date(now - REQUEST_HISTORY_DAYS * DAY_MS);
  const { rows, total } = await repo.listHistory(
    svc.d.db,
    tenantId,
    since,
    q.status,
    { skip: (q.page - 1) * q.pageSize, take: q.pageSize },
    q.customer,
    q.source,
  );
  return { items: rows.map((r) => toItem(r, now, rotated)), page: q.page, pageSize: q.pageSize, total };
}

export async function getRequest(svc: RequestService, tenantId: string, id: string): Promise<SupportRequestItem> {
  const r = await repo.findItem(svc.d.db, tenantId, id);
  if (!r) throw new AppError("NOT_FOUND");
  return toItem(r, svc.d.clock.now(), await generalRotatedAt(svc, tenantId));
}

/** count=0 sonrası sınıflandırma (AC-153): yok → 404; kabul edilmiş → REQUEST_TAKEN; diğer kapalı → REQUEST_CLOSED. */
async function lostRace(svc: RequestService, tenantId: string, id: string): Promise<AppError> {
  const r = await repo.findStatusInTenant(svc.d.db, tenantId, id);
  if (!r) return new AppError("NOT_FOUND");
  if (r.status === "ACCEPTED" || r.status === "CONNECT_FAILED" || (r.status === "CANCELLED" && r.acceptedBy))
    return new AppError("REQUEST_TAKEN");
  return new AppError("REQUEST_CLOSED");
}

async function acceptLimit(svc: RequestService, ctx: AuditContext, auth: AuthContext, tenantId: string): Promise<void> {
  await svc.limit(ctx, tenantId, "accept", "req.accept", "user", auth.user.id);
}

/** POST /support-requests/:id/accept (AC-153, 154). TX ve commit sonrası adımlar panel-accept.ts. */
export async function acceptRequest(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<AcceptRequestResponse> {
  // Oturum yalnız teknisyenin kendi tenant'ında açılır (P2 kuralı; Super Admin seçili firmada görüntüler, kabul edemez).
  if (auth.user.tenantId !== tenantId) throw new AppError("FORBIDDEN", { message: "Talep yalnız kendi firmanızda kabul edilebilir." });
  await acceptLimit(svc, ctx, auth, tenantId);
  const { db } = svc.d;
  const res = await db.$transaction((tx) => acceptTx({ svc, ctx, auth, tenantId, id }, tx));
  if (res === "customer_passive") {
    await svc.cancelSystem(id, "CUSTOMER_PASSIVE");
    throw new AppError("REQUEST_CLOSED");
  }
  if (res === "client_unsupported") throw new AppError("ACCEPT_CODE_CLIENT_UNSUPPORTED");
  if (!res) throw await lostRace(svc, tenantId, id);
  await afterAccept({ svc, auth, tenantId, id }, res);
  return { sessionId: res.sessionId, consoleUrl: `/sessions/${res.sessionId}/console` };
}

/** POST /support-requests/:id/reject (AC-157). */
export async function rejectRequest(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  message: string,
): Promise<void> {
  // AC-148 / sapma 2: Super Admin (firma seçmiş olsa da) ret yapamaz — acceptRequest ile aynı kural.
  if (auth.user.tenantId !== tenantId) throw new AppError("FORBIDDEN", { message: "Talep yalnız kendi firmanızda reddedilebilir." });
  await acceptLimit(svc, ctx, auth, tenantId);
  const ok = await svc.d.db.$transaction(async (tx) => {
    await repo.lockSettings(tx, tenantId); // S-P19-T12: ilk ifade
    const now = new Date(svc.d.clock.now());
    if ((await repo.rejectPending(tx, tenantId, id, auth.user.id, message, now)) === 0) return false;
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: "request.rejected",
      entity: "support_requests",
      entityId: id,
      result: "success",
      oldValue: { status: "PENDING" },
      newValue: { status: "REJECTED", message },
    });
    await svc.d.outbox.enqueue(tx, tenantId, id, "REQ_REJECTED"); // P19 (AC-261): aynı TX
    return true;
  });
  if (!ok) throw await lostRace(svc, tenantId, id);
  svc.d.hub.closeRequest(id, { t: "request.closed", status: "REJECTED", message });
  svc.d.hub.publish(tenantId, { t: "request.removed", id, status: "REJECTED" });
  svc.countSlaBreach(id);
  svc.d.hub.queueChanged(tenantId);
  await svc.publishCount(tenantId);
}

// ------------------------------------------------------------------ P18 atama / öncelik (AC-256, 257)

/** Kapalı/yok ayrımı (atama/öncelik uçları): yok → 404, PENDING değil → REQUEST_CLOSED. */
const notPending = (found: boolean): AppError => new AppError(found ? "REQUEST_CLOSED" : "NOT_FOUND");

/** Commit sonrası: `request.updated` (tenant geneli; atanan kendi soketinde toast) + kuyruk sırası yayını. */
async function publishUpdated(svc: RequestService, tenantId: string, id: string): Promise<SupportRequestItem> {
  const item = await getRequest(svc, tenantId, id);
  svc.d.hub.publish(tenantId, { t: "request.updated", id, priority: item.priority, assignedTo: item.assignedTo, slaDueAt: item.slaDueAt });
  svc.d.hub.queueChanged(tenantId);
  return item;
}

/**
 * Atanabilir mi (TX içinde, kullanıcı satırı FOR SHARE — pasife alma/yetki değişimi `FOR UPDATE` ile sırayla bekler):
 * aynı tenant, ACTIVE, ADMIN|USER, etkin `support_requests.view` + `support_requests.accept`.
 */
async function assignable(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { role: string; status: string }[]
  >`SELECT role, status FROM users WHERE id = ${userId} AND tenant_id = ${tenantId} FOR SHARE`;
  const u = rows[0];
  if (!u || u.status !== "ACTIVE" || (u.role !== "ADMIN" && u.role !== "USER")) return false;
  const overrides = await tx.userPermission.findMany({ where: { userId }, select: { permKey: true, granted: true } });
  const eff = effectivePermissions(u.role as Role, overrides);
  return eff.includes("support_requests.view") && eff.includes("support_requests.accept");
}

/** POST /support-requests/:id/assign (AC-256): `userId` null → atamayı kaldır. Aynı atama → değişiklik/audit yok. */
export async function assignRequest(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  userId: string | null,
): Promise<SupportRequestItem> {
  const changed = await svc.d.db.$transaction(async (tx) => {
    if (userId !== null && !(await assignable(tx, tenantId, userId)))
      throw new AppError("VALIDATION", { fields: { userId: ASSIGNEE_INVALID_MESSAGE } });
    const cur = await repo.lockRequest(tx, tenantId, id);
    if (!cur || cur.status !== "PENDING") throw notPending(cur !== null);
    if (cur.assigned_to === userId) return false;
    if ((await repo.setAssignee(tx, tenantId, id, userId, new Date(svc.d.clock.now()))) !== 1) throw notPending(true);
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: REQUEST_COMMS_AUDIT.ASSIGNED,
      entity: "support_requests",
      entityId: id,
      result: "success",
      oldValue: { assignedTo: cur.assigned_to },
      newValue: { assignedTo: userId },
    });
    return true;
  });
  return changed ? publishUpdated(svc, tenantId, id) : getRequest(svc, tenantId, id);
}

/** POST /support-requests/:id/priority (AC-257): SLA hedefi değişmez (oluşturmada dondurulur, §8b.2). */
export async function changePriority(
  svc: RequestService,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
  priority: RequestPriority,
): Promise<SupportRequestItem> {
  const changed = await svc.d.db.$transaction(async (tx) => {
    const cur = await repo.lockRequest(tx, tenantId, id);
    if (!cur || cur.status !== "PENDING") throw notPending(cur !== null);
    if (cur.priority === priority) return false;
    if ((await repo.setPriority(tx, tenantId, id, priority)) !== 1) throw notPending(true);
    await writeAudit(tx, ctx, {
      ...who(auth, tenantId),
      action: REQUEST_COMMS_AUDIT.PRIORITY_CHANGED,
      entity: "support_requests",
      entityId: id,
      result: "success",
      oldValue: { priority: cur.priority },
      newValue: { priority },
    });
    return true;
  });
  return changed ? publishUpdated(svc, tenantId, id) : getRequest(svc, tenantId, id);
}

export { ensureSettings, getSettings, rotateRef, updateSettings, webFormUrl, whatsappTest } from "./panel-settings.ts";
