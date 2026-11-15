// Müşteri okuma uçları (P8c; mimari-api "Müşteriler (P8c)"; AC-166, 175, 178): liste, ayrıntı, seçim kutusu, genel
// bağlantı ve müşteri sekmeleri (talepler, oturumlar). Tüm sorgular tenant kapsamlı.
import type {
  CustomerDetail,
  CustomerFirmRef,
  CustomerListResponse,
  CustomerOptionsQuery,
  CustomerOptionsResponse,
  CustomerStatus,
  CustomerTabQuery,
  GeneralLinkResponse,
  ListCustomersQuery,
} from "@remote/contracts/api/customers";
import { CUSTOMER_OPTIONS_MAX, digitsOf, foldKey } from "@remote/contracts/api/customers";
import type { SupportRequestListResponse } from "@remote/contracts/api/requests";
import type { SessionListResponse } from "@remote/contracts/api/sessions";
import type { AuthContext } from "../auth/session.ts";
import { AppError } from "../lib/errors.ts";
import { ensureSettings, generalRotatedAt, toItem } from "../requests/panel.ts";
import { requestDownloadUrl, requestFileName } from "../requests/ref.ts";
import * as rrepo from "../requests/repo.ts";
import type { RequestService } from "../requests/service.ts";
import { toListItem } from "../sessions/history.ts";
import { withWaitingGuests } from "../sessions/lobby.ts";
import * as hrepo from "../sessions/history-repo.ts";
import { historyScope } from "../sessions/service.ts";
import * as repo from "./repo.ts";
import { detail, listItem } from "./view.ts";

// ------------------------------------------------------------------ okuma

/** GET /customers (AC-166): durum + arama + sayfa; sayaçlar sayfadaki id'ler için tek gruplama sorgusu. */
export async function listCustomers(svc: RequestService, tenantId: string, q: ListCustomersQuery): Promise<CustomerListResponse> {
  const folded = q.q ? foldKey(q.q) : undefined;
  const d = q.q && /^[\d\s+\-()]+$/.test(q.q) ? digitsOf(q.q).replace(/^0+/, "") : undefined;
  const { rows, total } = await repo.list(
    svc.d.db,
    tenantId,
    {
      status: q.status,
      folded,
      digits: d && d.length >= 2 ? d : undefined,
      sort: q.sort,
    },
    { skip: (q.page - 1) * q.pageSize, take: q.pageSize },
  );
  const stats = await repo.requestStats(
    svc.d.db,
    tenantId,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) => listItem(svc, r, stats.get(r.id))),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export const getCustomer = (svc: RequestService, tenantId: string, id: string): Promise<CustomerDetail> => detail(svc, tenantId, id);

export async function customerOptions(svc: RequestService, tenantId: string, q: CustomerOptionsQuery): Promise<CustomerOptionsResponse> {
  const folded = q.q ? foldKey(q.q) : undefined;
  const rows = await repo.options(svc.d.db, tenantId, q.status, folded || undefined, CUSTOMER_OPTIONS_MAX);
  return {
    items: rows.map((r): CustomerFirmRef => ({
      id: r.id,
      name: r.name,
      status: r.status as CustomerStatus,
    })),
  };
}

/** GET /customers/general-link (AC-175): salt okunur; ayar yoksa tembel oluşturulur. */
export async function generalLink(svc: RequestService, tenantId: string): Promise<GeneralLinkResponse> {
  const s = await ensureSettings(svc, tenantId);
  return {
    downloadUrl: requestDownloadUrl(svc.d.env.PUBLIC_BASE_URL, s.requestRef),
    fileName: requestFileName(s.fileLabel, s.requestRef),
  };
}

async function assertExists(svc: RequestService, tenantId: string, id: string): Promise<void> {
  if (
    !(await svc.d.db.customer.findFirst({
      where: { id, tenantId },
      select: { id: true },
    }))
  )
    throw new AppError("NOT_FOUND");
}

/** GET /customers/:id/requests (AC-178): tüm durumlar, yeniden eskiye. */
export async function customerRequests(
  svc: RequestService,
  tenantId: string,
  id: string,
  q: CustomerTabQuery,
): Promise<SupportRequestListResponse> {
  await assertExists(svc, tenantId, id);
  const { rows, total } = await rrepo.listByCustomer(svc.d.db, tenantId, id, {
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  const now = svc.d.clock.now();
  const rotated = await generalRotatedAt(svc, tenantId);
  return {
    items: rows.map((r) => toItem(r, now, rotated)),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

/** GET /customers/:id/sessions (AC-178, K23): oturum geçmişi kapsamı (USER yalnız kendi oturumları). */
export async function customerSessions(
  svc: RequestService,
  auth: AuthContext,
  tenantId: string,
  id: string,
  q: CustomerTabQuery,
): Promise<SessionListResponse> {
  await assertExists(svc, tenantId, id);
  const scope = historyScope(auth); // tenantScope önce zorlandı → kind "tenant"
  const { rows, total } = await hrepo.listHistory(svc.d.db, scope, { customerFirm: id }, "createdAt:desc", {
    skip: (q.page - 1) * q.pageSize,
    take: q.pageSize,
  });
  // P13b-L: SessionListItem.waitingGuests (S13L-1: sessions.view yoksa 0).
  return withWaitingGuests(
    { items: rows.map((r) => toListItem(r, scope, auth.user.id)), page: q.page, pageSize: q.pageSize, total },
    svc.d.rooms,
    auth,
  );
}
