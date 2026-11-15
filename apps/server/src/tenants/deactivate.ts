// Firma pasife alma TX gövdesi ve commit sonrası bildirimler (service.ts'ten taşındı, PT-K12; AC-70, 115, 145, P14a AC-205).
// Kurallar service.ts başlığında: tüm iptal/geçersizleştirme/audit AYNI TX'te; commit sonrası yalnız bildirimler.
import { BINDING_AUDIT, TENANT_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { deleteForTenant as deleteTenantTrustedDevices } from "../auth/trusted-device-repo.ts";
import { revokeForTenant as revokeTenantBindings } from "../bindings/repo.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { unassignWithAudit } from "../requests/assign.ts";
import * as repo from "./repo.ts";
import type { TenantLiveEffects } from "./service.ts";

export const ENTITY = "tenants";

export const actor = (auth: AuthContext) => ({ userId: auth.user.id, username: auth.user.email });

/** Kayıt geçersizleştirme parti boyutu (bindings süpürücüsüyle aynı). */
const BINDING_BATCH = 1000;

type Tx = Prisma.TransactionClient;

async function revokeAllBindings(tx: Tx, id: string, now: Date): Promise<number> {
  let revokedBindings = 0;
  for (;;) {
    const n = await revokeTenantBindings(tx, id, now, BINDING_BATCH);
    revokedBindings += n;
    if (n < BINDING_BATCH) break;
  }
  return revokedBindings;
}

/** İptal edilen talepler ve geçersizleşen kayıtların audit satırları (sıra: talepler, kayıt özeti). */
async function auditCancellations(tx: Tx, ctx: AuditContext, auth: AuthContext, id: string, requestIds: string[], revokedBindings: number) {
  for (const requestId of requestIds)
    await writeAudit(tx, ctx, {
      tenantId: id,
      ...actor(auth),
      action: "request.cancelled",
      entity: "support_requests",
      entityId: requestId,
      result: "success",
      oldValue: { status: "PENDING" },
      newValue: { status: "CANCELLED", reason: "TENANT_PASSIVE" },
    });
  if (revokedBindings > 0)
    await writeAudit(tx, ctx, {
      tenantId: id,
      ...actor(auth),
      action: BINDING_AUDIT.REVOKED,
      entity: "device_bindings",
      result: "success",
      newValue: { reason: "TENANT_PASSIVE", count: revokedBindings },
    });
}

/** deactivateTenant TX gövdesi. Zaten pasif → 409. */
export async function deactivateTx(
  tx: Tx,
  ctx: AuditContext,
  auth: AuthContext,
  id: string,
): Promise<{ requestIds: string[]; revokedBindings: number }> {
  const cur = await repo.lockTenant(tx, id);
  if (!cur) throw new AppError("NOT_FOUND");
  if (cur.status === "PASSIVE") throw new AppError("CONFLICT", { message: "Firma zaten pasif." });
  const now = new Date();
  await repo.updateTenant(tx, id, { status: "PASSIVE" });
  const revokedSessions = await repo.revokeTenantSessions(tx, id, now);
  // P27a (AC-328, mimari-p27a §3.4): firmanın tüm hatırlanan cihazları aynı TX'te.
  const revokedTrustedDevices = await deleteTenantTrustedDevices(tx, id);
  const cancelledSessions = await repo.cancelTenantPending(tx, id, now);
  // S-P18-T5: firma pasifinde bekleyen taleplerin ataması aynı TX'te kalkar (talepler ardından TENANT_PASSIVE iptal; panel
  // soketleri kapanacağı için `request.updated` yayını yok).
  await unassignWithAudit(tx, ctx, actor(auth), { tenantId: id });
  const requestIds = await repo.cancelTenantRequests(tx, id, now);
  const revokedBindings = await revokeAllBindings(tx, id, now);
  await auditCancellations(tx, ctx, auth, id, requestIds, revokedBindings);
  await writeAudit(tx, ctx, {
    tenantId: id,
    ...actor(auth),
    action: TENANT_AUDIT.DEACTIVATED,
    entity: ENTITY,
    entityId: id,
    result: "success",
    oldValue: { status: "ACTIVE" },
    newValue: {
      status: "PASSIVE",
      revokedSessions,
      cancelledSessions,
      cancelledRequests: requestIds.length,
      revokedBindings,
      revokedTrustedDevices,
    },
  });
  return { requestIds, revokedBindings };
}

/** Yalnız bildirimler; her adım ayrı (biri düşse de diğerleri çalışır), hata loglanır — DB durumu zaten commit'te. */
export async function afterDeactivate(
  fx: TenantLiveEffects,
  id: string,
  done: { requestIds: string[]; revokedBindings: number },
): Promise<void> {
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      fx.log.error(
        { err, alarm: "tenant_passive_effect", step: name, tenantId: id },
        "firma pasife alma sonrası bildirim başarısız (yedek yol devralır)",
      );
    }
  };
  await step("rooms", () => fx.rooms.endByTenant(id));
  await step("panels", async () => fx.hub.closeByTenant(id));
  for (const requestId of done.requestIds) await step("requests", () => fx.requestClosed(id, requestId));
  await step("bindings", async () => fx.bindingsRevoked(done.revokedBindings));
}
