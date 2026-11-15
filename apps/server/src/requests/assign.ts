// P18 atama yaşam döngüsü (mimari-e11 §8b.13 S-P18-T5 (a)): kullanıcı pasife alma / kalıcı silme / talep yetkisi kaybı ve
// firma pasife alma, o kullanıcıya (firmaya) atanmış BEKLEYEN taleplerin atamasını AYNI TX'te kaldırır; her talep için audit
// `request.assigned {reason: "user_inactive"}`; commit sonrası `request.updated` yayını (mezar taşı adı yayılmaz: assignedTo null).
// users/tenants servisleri buradan kullanır (panel.ts'nin bağımlılıklarını çekmemek için ayrı küçük modül).
import type { PanelOutbound } from "@remote/contracts/ws-request";
import type { RequestPriority } from "@remote/contracts/api/requests";
import { REQUEST_COMMS_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { unassignPending } from "./repo.ts";

export type UnassignedRow = Awaited<ReturnType<typeof unassignPending>>[number];

/** Atamayı kaldırır + her talep için audit (aynı TX). Aktör: işlemi yapan kullanıcı (ya da sistem). */
export async function unassignWithAudit(
  tx: Prisma.TransactionClient,
  ctx: AuditContext,
  actor: { userId: string | null; username: string },
  where: { userId?: string; tenantId?: string },
): Promise<UnassignedRow[]> {
  const rows = await unassignPending(tx, where);
  for (const r of rows)
    await writeAudit(tx, ctx, {
      tenantId: r.tenantId,
      userId: actor.userId,
      username: actor.username,
      action: REQUEST_COMMS_AUDIT.ASSIGNED,
      entity: "support_requests",
      entityId: r.id,
      result: "success",
      oldValue: { assignedTo: r.assignedTo },
      newValue: { assignedTo: null, reason: "user_inactive" },
    });
  return rows;
}

/** Commit sonrası: tenant paneline `request.updated` (assignedTo null). */
export function publishUnassigned(
  hub: { publish(tenantId: string, msg: PanelOutbound): void } | undefined,
  rows: readonly UnassignedRow[],
): void {
  if (!hub) return;
  for (const r of rows)
    hub.publish(r.tenantId, {
      t: "request.updated",
      id: r.id,
      priority: r.priority as RequestPriority,
      assignedTo: null,
      slaDueAt: r.slaDueAt?.toISOString() ?? null,
    });
}
