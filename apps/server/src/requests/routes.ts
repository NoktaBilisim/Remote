// /api/v1/support-requests (kuyruk/geçmiş/kabul/ret) ve /api/v1/settings/support-requests (ayarlar). Sıra:
// requireAuth (CSRF durum değiştirenlerde) → requirePerm → tenantScope (Super Admin firma seçmeli, AC-148) → zod → servis.
import { emailTestInputSchema, type EmailTestResponse } from "@remote/contracts/api/requests";
import { SMTP_SEND_FAILED_MESSAGE } from "@remote/contracts/api/tenants";
import { MAIL_AUDIT } from "@remote/contracts/audit";
import { newRequestMail } from "../mail/templates.ts";
import { sendTenantTest } from "../tenants/smtp-routes.ts";
import {
  acceptRequestInputSchema,
  listRequestsQuerySchema,
  rejectRequestInputSchema,
  revokeBindingInputSchema,
  rotateRefInputSchema,
  updateRequestSettingsInputSchema,
  whatsappTestInputSchema,
  type AcceptRequestResponse,
  type SupportRequestCountResponse,
  type SupportRequestItem,
  type SupportRequestListResponse,
  type SupportRequestSettings,
  type WhatsappTestResponse,
} from "@remote/contracts/api/requests";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { acceptRequest, getRequest, getSettings, listRequests, rejectRequest, rotateRef, updateSettings, whatsappTest } from "./panel.ts";
import { revokeRequestBinding } from "../bindings/service.ts";
import * as repo from "./repo.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
function idParam(req: FastifyRequest): string {
  const { id } = req.params as { id?: string };
  if (!id || !ULID.test(id)) throw new AppError("NOT_FOUND");
  return id;
}

export async function supportRequestRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const view = { preHandler: requirePerm("support_requests.view") };
  // AC-147: view yoksa tüm talep uçları 403 — kabul/ret view + accept ister.
  const acceptPerm = { preHandler: [requirePerm("support_requests.view"), requirePerm("support_requests.accept")] };

  app.get("", view, async (req): Promise<SupportRequestListResponse> => {
    const { tenantId } = tenantScope(req);
    return listRequests(app.requests, tenantId, parseInput(listRequestsQuerySchema, req.query));
  });

  app.get("/count", view, async (req): Promise<SupportRequestCountResponse> => {
    const { tenantId } = tenantScope(req);
    return { pending: await repo.countPending(app.db, tenantId) };
  });

  app.get("/:id", view, async (req): Promise<SupportRequestItem> => {
    const { tenantId } = tenantScope(req);
    return getRequest(app.requests, tenantId, idParam(req));
  });

  app.post("/:id/accept", acceptPerm, async (req): Promise<AcceptRequestResponse> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(acceptRequestInputSchema, req.body);
    return acceptRequest(app.requests, auditContext(req), authOf(req), tenantId, id);
  });

  // r2 (§15.2, G-E10-2): tek kayıt iptali — customers.edit + (B-P8c-3) support_requests.view; kayıt talebin
  // binding_id'sinden (istemciden kimlik alınmaz).
  app.post(
    "/:id/revoke-binding",
    { preHandler: [requirePerm("support_requests.view"), requirePerm("customers.edit")] },
    async (req, reply) => {
      const { tenantId } = tenantScope(req);
      const id = idParam(req);
      parseInput(revokeBindingInputSchema, req.body);
      await revokeRequestBinding(app.requests, auditContext(req), authOf(req), tenantId, id);
      return reply.status(204).send();
    },
  );

  app.post("/:id/reject", acceptPerm, async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    const { message } = parseInput(rejectRequestInputSchema, req.body);
    await rejectRequest(app.requests, auditContext(req), authOf(req), tenantId, id, message);
    return reply.status(204).send();
  });
}

export async function requestSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requirePerm("settings.edit"));
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });

  app.get("", async (req): Promise<SupportRequestSettings> => getSettings(app.requests, tenantScope(req).tenantId));

  app.put("", async (req): Promise<SupportRequestSettings> => {
    const { tenantId } = tenantScope(req);
    return updateSettings(app.requests, auditContext(req), authOf(req), tenantId, parseInput(updateRequestSettingsInputSchema, req.body));
  });

  app.post("/rotate-ref", async (req): Promise<SupportRequestSettings> => {
    const { tenantId } = tenantScope(req);
    parseInput(rotateRefInputSchema, req.body);
    return rotateRef(app.requests, auditContext(req), authOf(req), tenantId);
  });

  // P10 (AC-151): e-posta kanalı testi — SMTP testiyle ortak 5/dk/tenant kovası; gönderim hatası 200 {ok:false}.
  app.post("/email/test", async (req): Promise<EmailTestResponse> => {
    const { tenantId } = tenantScope(req);
    const { to } = parseInput(emailTestInputSchema, req.body);
    const out = await sendTenantTest({
      mail: app.mail,
      limit: app.smtpTestLimit,
      ctx: auditContext(req),
      auth: authOf(req),
      tenantId,
      to,
      action: MAIL_AUDIT.EMAIL_TEST,
      entity: "tenant_request_settings",
      content: (firm) => newRequestMail({ publicBaseUrl: app.env.PUBLIC_BASE_URL, firm, requestCode: "123456" }),
    });
    return out.ok ? { ok: true, message: "Test e-postası gönderildi." } : { ok: false, message: SMTP_SEND_FAILED_MESSAGE };
  });

  app.post("/whatsapp/test", async (req): Promise<WhatsappTestResponse> => {
    const { tenantId } = tenantScope(req);
    const { phone } = parseInput(whatsappTestInputSchema, req.body);
    return whatsappTest(app.requests, auditContext(req), authOf(req), tenantId, phone);
  });
}
