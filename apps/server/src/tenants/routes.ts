// /api/v1/admin/tenants + /api/v1/admin/switch-tenant (SUPER_ADMIN; AC-70) ve /api/v1/settings/tenant
// (settings.view/edit, etkin tenant; AC-4). Sıra: requireAuth → rol/yetki → (kapsam) → zod → servis.
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import {
  createTenantInputSchema,
  listTenantsQuerySchema,
  purgeJobsQuerySchema,
  tenantPurgeInputSchema,
  tenantOptionsQuerySchema,
  switchTenantInputSchema,
  tenantActionInputSchema,
  tenantIdSchema,
  updateTenantInputSchema,
  updateTenantSettingsInputSchema,
  type SwitchTenantResponse,
  type TenantItem,
  type TenantListResponse,
  type TenantOptionsResponse,
  type PurgeJobsResponse,
  type TenantPurgeCancelResponse,
  type TenantPurgeStatus,
  type TenantSettingsView,
} from "@remote/contracts/api/tenants";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, requireStepUp, requireSuperAdmin, tenantScope } from "../auth/guards.ts";
import { countRevoked } from "../bindings/service.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import {
  createTenant,
  deactivateTenant,
  getTenant,
  getTenantSettings,
  listTenants,
  reactivateTenant,
  switchTenant,
  tenantOptions,
  updateTenant,
  updateTenantSettings,
  type TenantLiveEffects,
} from "./service.ts";
import { cancelPurge, previewPurge, purgeJobs, purgeStatus, schedulePurge } from "./purge-service.ts";

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
    requestClosed: (tenantId, requestId) => app.requests.closedAfterCommit(tenantId, requestId, "CANCELLED", { reason: "TENANT_PASSIVE" }),
    bindingsRevoked: (n) => countRevoked(app.requests, "TENANT_PASSIVE", n),
    log: app.log,
  });
  // P14a (AC-203): /admin/* yazma uçları kullanıcı başına 30/dk (31. → 429 + Retry-After). Sistem ayarı uçlarının
  // (settings/routes.ts) kendi daha sıkı 10/dk kovası var.
  const writes = new FixedWindowCounter(ADMIN_WRITES_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => writes.close());
  app.addHook("preHandler", async (req) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const key = authOf(req).user.id;
    const wait = writes.blockedFor(key);
    if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
    if (writes.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: writes.blockedFor(key) || 60 });
  });

  // P14b (AC-226): aranabilir firma seçici (≤ 20).
  app.get("/tenants/options", async (req): Promise<TenantOptionsResponse> =>
    tenantOptions(app.db, parseInput(tenantOptionsQuerySchema, req.query)),
  );

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

  // P16 G3 (AC-242; mimari-e11 §7.5): kalıcı silme. Önizleme (`dryRun: true`) salt okuma, step-up yok; zamanlama ve
  // iptal step-up (gövde ayrıştırılmadan önce: `dryRun` true değilse). Zamanlama/iptal sonrası göstergeler tazelenir.
  const purgeDeps = () => ({ secrets: app.secrets, store: app.uploads });
  const refreshPurgeMetrics = () =>
    void app.tenantPurge.refreshMetrics().catch((err: unknown) => app.log.error({ err }, "silme işi göstergesi tazelenemedi"));
  const stepUp = requireStepUp();

  app.post("/tenants/:id/purge", async (req, reply) => {
    const id = idParam(req);
    const body: unknown = req.body;
    if ((body as { dryRun?: unknown } | undefined)?.dryRun !== true) await stepUp(req);
    const input = parseInput(tenantPurgeInputSchema, body);
    if (input.dryRun) return previewPurge(app.db, purgeDeps(), auditContext(req), authOf(req), id);
    const out = await schedulePurge(app.db, purgeDeps(), auditContext(req), authOf(req), id, input);
    refreshPurgeMetrics();
    return reply.status(202).send(out);
  });

  app.delete("/tenants/:id/purge", { preHandler: stepUp }, async (req): Promise<TenantPurgeCancelResponse> => {
    const out = await cancelPurge(app.db, auditContext(req), authOf(req), idParam(req));
    refreshPurgeMetrics();
    return out;
  });

  app.get("/tenants/:id/purge", async (req): Promise<TenantPurgeStatus> => purgeStatus(app.db, idParam(req)));

  app.get("/purge-jobs", async (req): Promise<PurgeJobsResponse> => purgeJobs(app.db, parseInput(purgeJobsQuerySchema, req.query).open));

  app.post("/switch-tenant", async (req): Promise<SwitchTenantResponse> => {
    const { tenantId } = parseInput(switchTenantInputSchema, req.body);
    const tokenHash = sha256Hex(req.cookies[SESSION_COOKIE] ?? "");
    return switchTenant(app.db, fx(), auditContext(req), authOf(req), tokenHash, tenantId);
  });
}

/** P14a (AC-203): `/admin/tenants*` ve `/admin/switch-tenant` yazma üst sınırı (kullanıcı başına, dakika). */
export const ADMIN_WRITES_PER_MIN = 30;

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
