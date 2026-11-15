// Müşteri yanıt görünümleri (customers/service.ts): liste satırı, ayrıntı (sayaçlar + web formu bağlantısı), indirme
// bağlantısı ve audit alan seçimi; ortak kimlik/çakışma yardımcıları.
import type { CustomerDetail, CustomerListItem, CustomerStatus } from "@remote/contracts/api/customers";
import { CUSTOMER_NAME_CONFLICT_MESSAGE } from "@remote/contracts/api/customers";
import type { RequestPriority } from "@remote/contracts/api/requests";
import type { CustomerAuditFields } from "../audit/mask.ts";
import type { AuthContext } from "../auth/session.ts";
import { AppError } from "../lib/errors.ts";
import { webFormUrl } from "../requests/panel.ts";
import { requestDownloadUrl, requestFileName } from "../requests/ref.ts";
import type { RequestService } from "../requests/service.ts";
import * as repo from "./repo.ts";

export const ENTITY = "customer";

export const who = (auth: AuthContext, tenantId: string) => ({
  tenantId,
  userId: auth.user.id,
  username: auth.user.email,
});
export const nameConflict = (): AppError =>
  new AppError("CONFLICT", {
    message: CUSTOMER_NAME_CONFLICT_MESSAGE,
    fields: { name: CUSTOMER_NAME_CONFLICT_MESSAGE },
  });

function link(svc: RequestService, c: { status: string; fileLabel: string; requestRef: string }) {
  const active = c.status === "ACTIVE";
  return {
    downloadUrl: active ? requestDownloadUrl(svc.d.env.PUBLIC_BASE_URL, c.requestRef) : null,
    fileName: active ? requestFileName(c.fileLabel, c.requestRef) : null,
  };
}

export function listItem(
  svc: RequestService,
  c: repo.CustomerListRow,
  stats: { count: number; last: Date | null } | undefined,
): CustomerListItem {
  return {
    id: c.id,
    name: c.name,
    status: c.status as CustomerStatus,
    ...link(svc, c),
    createdAt: c.createdAt.toISOString(),
    lastRequestAt: stats?.last?.toISOString() ?? null,
    requestCount: stats?.count ?? 0,
  };
}

export async function detail(svc: RequestService, tenantId: string, id: string): Promise<CustomerDetail> {
  const c = await repo.find(svc.d.db, tenantId, id);
  if (!c) throw new AppError("NOT_FOUND");
  const [stats, sessionCount, rs] = await Promise.all([
    repo.requestStats(svc.d.db, tenantId, [id]),
    repo.sessionCount(svc.d.db, tenantId, id),
    svc.d.db.tenantRequestSettings.findUnique({ where: { tenantId }, select: { webFormEnabled: true } }),
  ]);
  return {
    ...listItem(svc, c, stats.get(id)),
    fileLabel: c.fileLabel,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    note: c.note,
    refRotatedAt: c.refRotatedAt?.toISOString() ?? null,
    passiveAt: c.passiveAt?.toISOString() ?? null,
    anonymizedAt: c.anonymizedAt?.toISOString() ?? null,
    sessionCount,
    defaultPriority: (c.defaultPriority as RequestPriority | null) ?? null,
    slaMinutes: c.slaMinutes,
    // P19 (§8c.6, AC-259): müşterinin kendi ref'iyle web formu; form kapalıysa ya da müşteri pasif/anonimse null.
    webFormUrl:
      rs?.webFormEnabled && c.status === "ACTIVE" && c.anonymizedAt === null ? webFormUrl(svc.d.env.PUBLIC_BASE_URL, c.requestRef) : null,
  };
}

export const auditFields = (c: repo.CustomerRow): CustomerAuditFields => ({
  name: c.name,
  fileLabel: c.fileLabel,
  status: c.status,
  contactName: c.contactName,
  phone: c.phone,
  email: c.email,
  note: c.note,
  defaultPriority: c.defaultPriority,
  slaMinutes: c.slaMinutes,
});
