// /api/v1/customers (P8c; mimari-api "Müşteriler ve bilgisayar kaydı (P8c)", mimari-e10 §4). Sıra: requireAuth (CSRF
// durum değiştirenlerde) → requirePerm → tenantScope (Super Admin firma seçmeli; `all` istisnası YOK — AC-172) → zod → servis.
// Gövdeler loglanmaz (logger gövde yazmaz; K19 §15.6 (5)); doğrulama hatası yalnız alan adı + mesaj döner.
import {
  createCustomerInputSchema,
  customerActionInputSchema,
  customerOptionsQuerySchema,
  customerTabQuerySchema,
  listCustomersQuerySchema,
  updateCustomerInputSchema,
  type CustomerDetail,
  type CustomerListResponse,
  type CustomerOptionsResponse,
  type GeneralLinkResponse,
} from "@remote/contracts/api/customers";
import type { SupportRequestListResponse } from "@remote/contracts/api/requests";
import type { SessionListResponse } from "@remote/contracts/api/sessions";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAnyPerm, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import {
  createCustomer,
  customerOptions,
  customerRequests,
  customerSessions,
  deactivateCustomer,
  generalLink,
  getCustomer,
  listCustomers,
  reactivateCustomer,
  rotateCustomerRef,
  updateCustomer,
} from "./service.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
function idParam(req: FastifyRequest): string {
  const { id } = req.params as { id?: string };
  if (!id || !ULID.test(id)) throw new AppError("NOT_FOUND");
  return id;
}

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const view = { preHandler: requirePerm("customers.view") };
  const edit = { preHandler: requirePerm("customers.edit") };
  const svc = () => app.requests;

  app.get("", view, async (req): Promise<CustomerListResponse> => {
    const { tenantId } = tenantScope(req);
    return listCustomers(svc(), tenantId, parseInput(listCustomersQuerySchema, req.query));
  });

  app.get("/general-link", view, async (req): Promise<GeneralLinkResponse> => generalLink(svc(), tenantScope(req).tenantId));

  // Filtre/seçim kutusu: customers.view VEYA support_requests.view VEYA session_history.view (≤ 20 sonuç).
  app.get(
    "/options",
    { preHandler: requireAnyPerm("customers.view", "support_requests.view", "session_history.view") },
    async (req): Promise<CustomerOptionsResponse> => {
      const { tenantId } = tenantScope(req);
      return customerOptions(svc(), tenantId, parseInput(customerOptionsQuerySchema, req.query));
    },
  );

  app.post("", { preHandler: requirePerm("customers.create") }, async (req, reply): Promise<CustomerDetail> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(createCustomerInputSchema, req.body);
    const out = await createCustomer(svc(), auditContext(req), authOf(req), tenantId, input);
    return reply.status(201).send(out);
  });

  app.get("/:id", view, async (req): Promise<CustomerDetail> => getCustomer(svc(), tenantScope(req).tenantId, idParam(req)));

  app.patch("/:id", edit, async (req): Promise<CustomerDetail> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    return updateCustomer(svc(), auditContext(req), authOf(req), tenantId, id, parseInput(updateCustomerInputSchema, req.body));
  });

  app.post("/:id/rotate-ref", edit, async (req): Promise<CustomerDetail> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(customerActionInputSchema, req.body);
    return rotateCustomerRef(svc(), auditContext(req), authOf(req), tenantId, id);
  });

  // V23: pasife alma = customers.delete (kalıcı silme yok).
  app.post("/:id/deactivate", { preHandler: requirePerm("customers.delete") }, async (req): Promise<CustomerDetail> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(customerActionInputSchema, req.body);
    return deactivateCustomer(svc(), auditContext(req), authOf(req), tenantId, id);
  });

  app.post("/:id/reactivate", edit, async (req): Promise<CustomerDetail> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(customerActionInputSchema, req.body);
    return reactivateCustomer(svc(), auditContext(req), authOf(req), tenantId, id);
  });

  // K23: sekmeler ayrıca talep / oturum geçmişi yetkisi ister.
  app.get(
    "/:id/requests",
    { preHandler: [requirePerm("customers.view"), requirePerm("support_requests.view")] },
    async (req): Promise<SupportRequestListResponse> => {
      const { tenantId } = tenantScope(req);
      const id = idParam(req);
      return customerRequests(svc(), tenantId, id, parseInput(customerTabQuerySchema, req.query));
    },
  );

  app.get(
    "/:id/sessions",
    { preHandler: [requirePerm("customers.view"), requirePerm("session_history.view")] },
    async (req): Promise<SessionListResponse> => {
      const { tenantId } = tenantScope(req);
      const id = idParam(req);
      return customerSessions(svc(), authOf(req), tenantId, id, parseInput(customerTabQuerySchema, req.query));
    },
  );
}
