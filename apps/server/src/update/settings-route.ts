// P29 Ayarlar → İstemciler (mimari-p29 §4.8; AC-485). GET `settings.view`, PUT `settings.edit` (step-up YOK). PUT tek TX:
// ayar satırı FOR UPDATE → değişmişse UPDATE + audit `settings.client_update {old,new}`; commit sonrası firmanın açık `update1`
// soketlerine yeni teklif/politika (≤ 60 sn kuralı anında karşılanır).
import { clientUpdateSettingsSchema, type ClientUpdateSettings } from "@remote/contracts/api/update";
import { CLIENT_UPDATE_SETTINGS_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance } from "fastify";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { parseInput } from "../lib/errors.ts";
import { lockSettings } from "../tenants/repo.ts";
import { rebroadcastPolicy } from "./device-update.ts";

export async function getClientUpdate(db: Db, tenantId: string): Promise<ClientUpdateSettings> {
  const s = await db.tenantSettings.findUnique({ where: { tenantId }, select: { clientAutoUpdate: true } });
  return { autoUpdate: s?.clientAutoUpdate ?? true };
}

/** true → değişti (audit yazıldı). */
export async function putClientUpdate(db: Db, ctx: AuditContext, auth: AuthContext, tenantId: string, next: boolean): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await lockSettings(tx, tenantId);
    const cur = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId }, select: { clientAutoUpdate: true } });
    if (cur.clientAutoUpdate === next) return false;
    await tx.tenantSettings.update({ where: { tenantId }, data: { clientAutoUpdate: next }, select: { tenantId: true } });
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: CLIENT_UPDATE_SETTINGS_AUDIT,
      entity: "tenant_settings",
      entityId: tenantId,
      result: "success",
      oldValue: { autoUpdate: cur.clientAutoUpdate },
      newValue: { autoUpdate: next },
    });
    return true;
  });
}

/** Önek `/api/v1/settings/client-update`: çerez + CSRF (requireAuth). */
export async function clientUpdateSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  app.get("", { preHandler: requirePerm("settings.view") }, async (req): Promise<ClientUpdateSettings> =>
    getClientUpdate(app.db, tenantScope(req).tenantId),
  );
  app.put("", { preHandler: requirePerm("settings.edit") }, async (req): Promise<ClientUpdateSettings> => {
    const { tenantId } = tenantScope(req);
    const { autoUpdate } = parseInput(clientUpdateSettingsSchema, req.body);
    if (await putClientUpdate(app.db, auditContext(req), authOf(req), tenantId, autoUpdate))
      await rebroadcastPolicy({ updates: app.updates, hub: app.unattendedHub }, tenantId).catch((err: unknown) =>
        app.log.error({ err }, "güncelleme politikası cihazlara iletilemedi"),
      );
    return { autoUpdate };
  });
}
