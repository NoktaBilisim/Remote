// /api/v1/customers/:id/portal-accounts (P21; mimari-p21 §4.3). `customers/routes.ts`'e dokunmaz: ayrı eklenti, aynı önek.
// Sıra: requireAuth (CSRF durum değiştirenlerde) → customers.view → customers.portal → tenantScope → zod → servis.
import { portalAccountActionInputSchema, portalAccountCreateInputSchema } from "@remote/contracts/api/portal";
import type {
  PortalAccountCreateResponse,
  PortalAccountItem,
  PortalAccountListResponse,
  PortalPasswordResetResponse,
} from "@remote/contracts/api/portal";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import {
  createPortalAccount,
  deactivatePortalAccount,
  listPortalAccounts,
  reactivatePortalAccount,
  resetPortalAccountPassword,
  type PortalAdminDeps,
} from "./admin.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function ids(req: FastifyRequest): { customerId: string; accountId: string } {
  const { id, accountId } = req.params as { id?: string; accountId?: string };
  if (!id || !ULID.test(id) || (accountId !== undefined && !ULID.test(accountId))) throw new AppError("NOT_FOUND");
  return { customerId: id, accountId: accountId ?? "" };
}

export async function portalAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requirePerm("customers.view"));
  app.addHook("preHandler", requirePerm("customers.portal"));
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const d: PortalAdminDeps = { db: app.db, publicBaseUrl: app.env.PUBLIC_BASE_URL, createLimit: app.portalLimits.accountCreates };

  app.get("/:id/portal-accounts", async (req): Promise<PortalAccountListResponse> => {
    const { tenantId } = tenantScope(req);
    return listPortalAccounts(d, tenantId, ids(req).customerId);
  });

  app.post("/:id/portal-accounts", async (req, reply): Promise<PortalAccountCreateResponse> => {
    const { tenantId } = tenantScope(req);
    const { customerId } = ids(req);
    const input = parseInput(portalAccountCreateInputSchema, req.body);
    return reply.status(201).send(await createPortalAccount(d, auditContext(req), authOf(req), tenantId, customerId, input));
  });

  const action =
    (fn: typeof deactivatePortalAccount | typeof reactivatePortalAccount) =>
    async (req: FastifyRequest): Promise<PortalAccountItem> => {
      const { tenantId } = tenantScope(req);
      const { customerId, accountId } = ids(req);
      parseInput(portalAccountActionInputSchema, req.body);
      return fn(d, auditContext(req), authOf(req), tenantId, customerId, accountId);
    };
  app.post("/:id/portal-accounts/:accountId/deactivate", action(deactivatePortalAccount));
  app.post("/:id/portal-accounts/:accountId/reactivate", action(reactivatePortalAccount));

  app.post("/:id/portal-accounts/:accountId/reset-password", async (req): Promise<PortalPasswordResetResponse> => {
    const { tenantId } = tenantScope(req);
    const { customerId, accountId } = ids(req);
    parseInput(portalAccountActionInputSchema, req.body);
    return resetPortalAccountPassword(d, auditContext(req), authOf(req), tenantId, customerId, accountId);
  });
}
