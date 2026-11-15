// /api/v1/customers (P8c; mimari-api "Müşteriler ve bilgisayar kaydı (P8c)", mimari-e10 §4). Sıra: requireAuth (CSRF
// durum değiştirenlerde) → requirePerm → tenantScope (Super Admin firma seçmeli; `all` istisnası YOK — AC-172) → zod → servis.
// Gövdeler loglanmaz (logger gövde yazmaz; K19 §15.6 (5)); doğrulama hatası yalnız alan adı + mesaj döner.
import multipart from "@fastify/multipart";
import {
  CUSTOMER_EXPORTS_PER_MIN,
  CUSTOMER_IMPORT_MAX_BYTES,
  CUSTOMER_IMPORT_PREVIEWS_PER_HOUR,
  createCustomerInputSchema,
  exportCustomersQuerySchema,
  importCommitInputSchema,
  customerActionInputSchema,
  customerOptionsQuerySchema,
  customerTabQuerySchema,
  listCustomersQuerySchema,
  updateCustomerInputSchema,
  type CustomerDetail,
  type CustomerListResponse,
  type CustomerOptionsResponse,
  type GeneralLinkResponse,
  type ImportPreview,
  type ImportResult,
} from "@remote/contracts/api/customers";
import type { SupportRequestListResponse } from "@remote/contracts/api/requests";
import type { SessionListResponse } from "@remote/contracts/api/sessions";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { RequestService } from "../requests/service.ts";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAnyPerm, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { exportCustomersCsv } from "./csv-export.ts";
import { commitImport, ImportPreviewStore, previewImport, readCsvUpload } from "./csv-import.ts";
import { customerOptions, customerRequests, customerSessions, generalLink, getCustomer, listCustomers } from "./read.ts";
import { createCustomer, deactivateCustomer, reactivateCustomer, rotateCustomerRef, updateCustomer } from "./service.ts";

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

  await csvRoutes(app, svc);
  firmRoutes(app, svc, view, edit);
  actionRoutes(app, svc, edit);
  tabRoutes(app, svc);
}

type Svc = () => RequestService;
type Guard = { preHandler: preHandlerHookHandler };

/** P19 (AC-263, S-P19-14, K-P19-9): CSV dışa/içe aktarma. Statik yollar `/:id`'den önce eşleşir (find-my-way). */
async function csvRoutes(app: FastifyInstance, svc: Svc): Promise<void> {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const exportLimit = new FixedWindowCounter(CUSTOMER_EXPORTS_PER_MIN + 1, MIN, MIN);
  const previewLimit = new FixedWindowCounter(CUSTOMER_IMPORT_PREVIEWS_PER_HOUR + 1, HOUR, HOUR);
  const previews = new ImportPreviewStore(() => svc().d.clock.now());
  const importLocks = new Set<string>();
  app.addHook("onClose", async () => {
    exportLimit.close();
    previewLimit.close();
  });

  app.get("/export.csv", { preHandler: [requirePerm("customers.view"), requirePerm("customers.export")] }, async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const q = parseInput(exportCustomersQuerySchema, req.query);
    const out = await exportCustomersCsv(app.db, req.log, auditContext(req), authOf(req), tenantId, q, exportLimit);
    void reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${out.filename}"`)
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(out.body);
  });

  await previewRoute(app, svc, previewLimit, previews);

  app.post(
    "/import/commit",
    { preHandler: [requirePerm("customers.import"), requirePerm("customers.create")] },
    async (req): Promise<ImportResult> => {
      const { tenantId } = tenantScope(req);
      const input = parseInput(importCommitInputSchema, req.body);
      return commitImport(svc(), previews, importLocks, auditContext(req), authOf(req), tenantId, input);
    },
  );
}

/** multipart ayrıştırıcısı yalnız önizleme alt bağlamında (diğer uçlar multipart gövdeyi reddetmeye devam eder). */
async function previewRoute(app: FastifyInstance, svc: Svc, previewLimit: FixedWindowCounter, previews: ImportPreviewStore): Promise<void> {
  await app.register(async (sub) => {
    await sub.register(multipart, {
      limits: { fileSize: CUSTOMER_IMPORT_MAX_BYTES, files: 1, fields: 0, parts: 1 },
      throwFileSizeLimit: true,
    });
    sub.post(
      "/import/preview",
      { preHandler: [requirePerm("customers.import"), requirePerm("customers.create"), requirePerm("customers.view")] },
      async (req): Promise<ImportPreview> => {
        const { tenantId } = tenantScope(req);
        const auth = authOf(req);
        const wait = previewLimit.blockedFor(auth.user.id);
        if (wait > 0 || previewLimit.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 3600 });
        const file = await readCsvUpload(req);
        return previewImport(svc(), previews, auth, tenantId, file);
      },
    );
  });
}

/** Genel bağlantı, seçim kutusu, oluşturma, ayrıntı ve düzenleme. */
function firmRoutes(app: FastifyInstance, svc: Svc, view: Guard, edit: Guard): void {
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
}

/** Ref yenileme, pasife alma, yeniden aktif etme. */
function actionRoutes(app: FastifyInstance, svc: Svc, edit: Guard): void {
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
}

function tabRoutes(app: FastifyInstance, svc: Svc): void {
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
