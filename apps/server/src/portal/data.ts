// P21 portal veri servisleri (mimari-p21 §4.2, §5.3, K-P21-2/3/7): `me`, talep/oturum listeleri ve tekil kayıt (yalnız meta),
// talep formu bilgisi ve portal talebi. Kapsam YALNIZ oturumdan (`PortalScope`); tekil kayıtta başka müşteri/firma/yok → aynı 404.
import type { CreateRequestResponse } from "@remote/contracts/api/requests";
import type {
  PortalMe,
  PortalPage,
  PortalRequestData,
  PortalRequestFormInfo,
  PortalRequestItem,
  PortalSessionItem,
} from "@remote/contracts/api/portal";
import type { RequestPriority, RequestSource, RequestStatus } from "@remote/contracts/api/requests";
import type { SessionMode, SessionStatus } from "@remote/contracts/api/sessions";
import type { AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { requestDownloadUrl, requestFileName } from "../requests/ref.ts";
import * as rrepo from "../requests/repo.ts";
import type { RequestService } from "../requests/service.ts";
import { requestFormInfo } from "../requests/web-form.ts";
import { effectiveLogoUrl } from "../uploads/urls.ts";
import type { PortalLimits } from "./limits.ts";
import * as repo from "./repo.ts";
import type { PortalContext } from "./session.ts";

/** K-P21-3: firma dosyası = müşteri detayındaki indirme bağlantısının aynısı. */
export async function portalMe(db: Db, publicBaseUrl: string, p: PortalContext): Promise<PortalMe> {
  return {
    user: { ...p.user },
    customer: { name: p.customer.name },
    provider: { name: p.tenant.name, logoUrl: await effectiveLogoUrl(db, p.tenant.logoPath) },
    links: {
      downloadUrl: requestDownloadUrl(publicBaseUrl, p.customer.requestRef),
      fileName: requestFileName(p.customer.fileLabel, p.customer.requestRef),
    },
  };
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** K-P21-7: talep meta (anonim satırda kişi adı null). */
export function requestItem(r: repo.PortalRequestRow): PortalRequestItem {
  return {
    id: r.id,
    requestCode: r.requestCode,
    status: r.status as RequestStatus,
    source: r.source as RequestSource,
    priority: r.priority as RequestPriority,
    requesterName: r.anonymizedAt ? null : r.customerName,
    createdAt: r.createdAt.toISOString(),
    closedAt: iso(r.closedAt),
    sessionId: r.session?.id ?? null,
  };
}

/** K-P21-7: oturum meta (IP, not, cihaz, kalite, izinsiz bağlantı gerekçesi yok). */
export function sessionItem(s: repo.PortalSessionItemRow): PortalSessionItem {
  const started = s.consumedAt;
  return {
    id: s.id,
    status: s.status as SessionStatus,
    mode: s.mode as SessionMode | null,
    technicianName: s.technician.fullName,
    customerName: s.anonymizedAt ? null : s.customerName,
    ticketNo: s.ticketNo,
    createdAt: s.createdAt.toISOString(),
    startedAt: iso(started),
    endedAt: iso(s.endedAt),
    durationSec: started && s.endedAt ? Math.max(0, Math.round((s.endedAt.getTime() - started.getTime()) / 1000)) : null,
  };
}

export async function listPortalRequests(
  db: Db,
  scope: repo.PortalScope,
  q: { page: number; pageSize: number },
): Promise<PortalPage<PortalRequestItem>> {
  const { rows, total } = await repo.listRequests(db, scope, q.page, q.pageSize);
  return { items: rows.map(requestItem), page: q.page, pageSize: q.pageSize, total };
}

export async function getPortalRequest(db: Db, scope: repo.PortalScope, id: string): Promise<PortalRequestItem> {
  const r = await repo.findRequest(db, scope, id);
  if (!r) throw new AppError("NOT_FOUND");
  return requestItem(r);
}

export async function listPortalSessions(
  db: Db,
  scope: repo.PortalScope,
  q: { page: number; pageSize: number },
): Promise<PortalPage<PortalSessionItem>> {
  const { rows, total } = await repo.listSessions(db, scope, q.page, q.pageSize);
  return { items: rows.map(sessionItem), page: q.page, pageSize: q.pageSize, total };
}

export async function getPortalSession(db: Db, scope: repo.PortalScope, id: string): Promise<PortalSessionItem> {
  const s = await repo.findSession(db, scope, id);
  if (!s) throw new AppError("NOT_FOUND");
  return sessionItem(s);
}

/** GET /portal/request-form (K-P21-2): web formu bilgisinin token'sız hâli; `web_form_enabled` denetimi yok. */
export async function portalRequestForm(svc: RequestService, p: PortalContext): Promise<PortalRequestFormInfo> {
  const s = await rrepo.settingsByTenant(svc.d.db, p.scope.tenantId);
  if (!s) throw new AppError("CONFLICT", { message: "Destek talebi şu an açılamıyor; destek sağlayıcınıza başvurun." });
  return requestFormInfo(svc, s);
}

/**
 * POST /portal/requests (K-P21-2, r2 S-P21-1/S-P21-4): müşteri kovası (tüm hesaplar toplamı 10/sa; aşım `rateAudit` + metrik)
 * → gövde YALNIZ sunucuda kurulur (`ref` = oturumdaki müşterinin `request_ref`'i; `req.body` çekirdeğe verilmez) →
 * `createPortal` (beklenen firma + müşteri, bekleyen sınırı 3).
 */
export async function createPortalRequest(
  svc: RequestService,
  limits: PortalLimits,
  ctx: AuditContext,
  p: PortalContext,
  input: PortalRequestData,
): Promise<CreateRequestResponse> {
  const { tenantId, customerId, portalUserId } = p.scope;
  const bucket = limits.requestsCustomer;
  const wait = bucket.blockedFor(customerId);
  if (wait > 0 || bucket.hit(customerId)) {
    svc.d.metrics.inc("rs_portal_requests_total", { result: "rate_limited" });
    await svc.rateAudit(ctx, tenantId, "portal.customer", "customer", customerId);
    throw new AppError("RATE_LIMITED", { retryAfterSec: wait || bucket.blockedFor(customerId) || 60 });
  }
  const out = await queueFullMetric(svc, () =>
    svc.createPortal(
      ctx,
      {
        ref: p.customer.requestRef,
        clientInstanceId: input.clientInstanceId,
        customerName: input.customerName,
        phone: input.phone,
        ...(input.email !== undefined ? { email: input.email } : {}),
        description: input.description,
        consentTextId: input.consentTextId,
        consentAccepted: input.consentAccepted,
        notify: input.notify,
        source: "WEB",
        clientVersion: null,
      },
      { via: "portal", portalUserId, expectedTenantId: tenantId, expectedCustomerId: customerId },
    ),
  );
  svc.d.metrics.inc("rs_portal_requests_total", { result: "created" });
  return out;
}

/** Bekleyen sınırı reddi (`QUEUE_FULL`) `rs_portal_requests_total{result="queue_full"}` (runbook §29.5 alarmı). */
async function queueFullMetric<T>(svc: RequestService, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AppError && err.code === "QUEUE_FULL") svc.d.metrics.inc("rs_portal_requests_total", { result: "queue_full" });
    throw err;
  }
}
