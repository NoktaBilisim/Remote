// /api/v1/admin/tenants + /api/v1/admin/switch-tenant (SUPER_ADMIN; AC-70) ve /api/v1/settings/tenant
// (settings.view/edit, etkin tenant; AC-4). Sıra: requireAuth → rol/yetki → (kapsam) → zod → servis.
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import {
  createTenantInputSchema,
  listTenantsQuerySchema,
  switchTenantInputSchema,
  tenantActionInputSchema,
  tenantIdSchema,
  updateTenantInputSchema,
  updateTenantSettingsInputSchema,
  type SwitchTenantResponse,
  type TenantItem,
  type TenantListResponse,
  type TenantSettingsView,
} from "@remote/contracts/api/tenants";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, requireSuperAdmin, tenantScope } from "../auth/guards.ts";
import { revokeForTenant } from "../bindings/service.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import {
  createTenant,
  deactivateTenant,
  getTenant,
  getTenantSettings,
  listTenants,
  reactivateTenant,
  switchTenant,
  updateTenant,
  updateTenantSettings,
  type TenantLiveEffects,
} from "./service.ts";

function idParam(req: FastifyRequest): string {
  const r = tenantIdSchema.safeParse((req.params as { id?: string }).id);
  if (!r.success) throw new AppError("NOT_FOUND");
  return r.data;
}

const noStore = async (_req: FastifyRequest, reply: { header(k: string, v: string): unknown }) => {
  void reply.header("Cache-Control", "no-store");
};

export async function adminTenantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireSuperAdmin);
  app.addHook("onSend", noStore);
  const fx = (): TenantLiveEffects => ({
    rooms: app.rooms,
    hub: app.requestHub,
    cancelRequests: (id) => app.requests.cancelAllForTenant(id),
    revokeBindings: (id) => revokeForTenant(app.requests, id),
    log: app.log,
  });

  app.get("/tenants", async (req): Promise<TenantListResponse> => listTenants(app.db, parseInput(listTenantsQuerySchema, req.query)));

  app.post("/tenants", async (req, reply): Promise<TenantItem> => {
    const out = await createTenant(app.db, auditContext(req), authOf(req), parseInput(createTenantInputSchema, req.body));
    return reply.status(201).send(out);
  });

  app.get("/tenants/:id", async (req): Promise<TenantItem> => getTenant(app.db, idParam(req)));

  app.patch("/tenants/:id", async (req): Promise<TenantItem> => {
    const id = idParam(req);
    return updateTenant(app.db, auditContext(req), authOf(req), id, parseInput(updateTenantInputSchema, req.body));
  });

  app.post("/tenants/:id/deactivate", async (req): Promise<TenantItem> => {
    const id = idParam(req);
    parseInput(tenantActionInputSchema, req.body);
    return deactivateTenant(app.db, fx(), auditContext(req), authOf(req), id);
  });

  app.post("/tenants/:id/reactivate", async (req): Promise<TenantItem> => {
    const id = idParam(req);
    parseInput(tenantActionInputSchema, req.body);
    return reactivateTenant(app.db, auditContext(req), authOf(req), id);
  });

  app.post("/switch-tenant", async (req): Promise<SwitchTenantResponse> => {
    const { tenantId } = parseInput(switchTenantInputSchema, req.body);
    const tokenHash = sha256Hex(req.cookies[SESSION_COOKIE] ?? "");
    return switchTenant(app.db, fx(), auditContext(req), authOf(req), tokenHash, tenantId);
  });
}

export async function tenantSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", noStore);

  app.get("", { preHandler: requirePerm("settings.view") }, async (req): Promise<TenantSettingsView> =>
    getTenantSettings(app.db, tenantScope(req).tenantId),
  );

  app.put("", { preHandler: requirePerm("settings.edit") }, async (req): Promise<TenantSettingsView> => {
    const { tenantId } = tenantScope(req);
    return updateTenantSettings(
      app.db,
      app,
      auditContext(req),
      authOf(req),
      tenantId,
      parseInput(updateTenantSettingsInputSchema, req.body),
    );
  });
}
