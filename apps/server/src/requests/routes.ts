// /api/v1/support-requests (kuyruk/geçmiş/kabul/ret) ve /api/v1/settings/support-requests (ayarlar). Sıra:
// requireAuth (CSRF durum değiştirenlerde) → requirePerm → tenantScope (Super Admin firma seçmeli, AC-148) → zod → servis.
import { emailTestInputSchema, type EmailTestResponse } from "@remote/contracts/api/requests";
import { SMTP_SEND_FAILED_MESSAGE } from "@remote/contracts/api/tenants";
import { MAIL_AUDIT } from "@remote/contracts/audit";
import { newRequestMail } from "../mail/templates.ts";
import { sendTenantTest } from "../tenants/smtp-routes.ts";
import {
  acceptRequestInputSchema,
  assignRequestInputSchema,
  listRequestMessagesQuerySchema,
  priorityInputSchema,
  sendRequestMessageInputSchema,
  listRequestsQuerySchema,
  rejectRequestInputSchema,
  revokeBindingInputSchema,
  rotateRefInputSchema,
  updateRequestSettingsInputSchema,
  whatsappTestInputSchema,
  type AcceptRequestResponse,
  type RequestMessageListResponse,
  type SendRequestMessageResponse,
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
import {
  acceptRequest,
  assignRequest,
  changePriority,
  getRequest,
  getSettings,
  listRequests,
  rejectRequest,
  rotateRef,
  updateSettings,
  whatsappTest,
} from "./panel.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { revokeRequestBinding } from "../bindings/service.ts";
import * as repo from "./repo.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** P18: atama/öncelik yazmaları kullanıcı başına dakikada 30 (mimari-e11 §8b.5). */
export const ASSIGN_WRITES_PER_MIN = 30;
/** P18 H3 (mimari-e11 §8b.5): mesaj okuma/yazma kovaları. */
export const MESSAGE_READS_PER_MIN = 120;
export const MESSAGE_WRITES_USER_PER_MIN = 60;
export const MESSAGE_WRITES_TENANT_PER_MIN = 600;
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
    return listRequests(app.requests, tenantId, parseInput(listRequestsQuerySchema, req.query), authOf(req).user.id);
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

  // P18 (AC-256, 257): atama ve öncelik — view + assign; kullanıcı başına 30/dk (iki uç ortak kova, P15 engel kalıbı).
  const assignWrites = new FixedWindowCounter(ASSIGN_WRITES_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => assignWrites.close());
  const assignLimit = async (req: FastifyRequest): Promise<void> => {
    const key = authOf(req).user.id;
    const wait = assignWrites.blockedFor(key);
    if (wait > 0 || assignWrites.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: assignWrites.blockedFor(key) || 60 });
  };
  const assignPerm = { preHandler: [requirePerm("support_requests.view"), requirePerm("support_requests.assign"), assignLimit] };

  app.post("/:id/assign", assignPerm, async (req): Promise<SupportRequestItem> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    const { userId } = parseInput(assignRequestInputSchema, req.body);
    return assignRequest(app.requests, auditContext(req), authOf(req), tenantId, id, userId);
  });

  app.post("/:id/priority", assignPerm, async (req): Promise<SupportRequestItem> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    const { priority } = parseInput(priorityInputSchema, req.body);
    return changePriority(app.requests, auditContext(req), authOf(req), tenantId, id, priority);
  });

  // P18 H3 (AC-255; S-P18-T3/T10): mesajlar — okuma view (120/dk/kullanıcı), yazma view + message (60/dk/kullanıcı,
  // 600/dk/tenant; talep başına 1/sn servis içinde). Kova aşımı 429 + Retry-After.
  const msgRead = new FixedWindowCounter(MESSAGE_READS_PER_MIN + 1, 60_000, 60_000);
  const msgWriteUser = new FixedWindowCounter(MESSAGE_WRITES_USER_PER_MIN + 1, 60_000, 60_000);
  const msgWriteTenant = new FixedWindowCounter(MESSAGE_WRITES_TENANT_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => {
    msgRead.close();
    msgWriteUser.close();
    msgWriteTenant.close();
  });
  const take = (c: FixedWindowCounter, key: string): void => {
    const wait = c.blockedFor(key);
    if (wait > 0 || c.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: c.blockedFor(key) || 60 });
  };

  app.get("/:id/messages", view, async (req): Promise<RequestMessageListResponse> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    take(msgRead, authOf(req).user.id);
    const { after } = parseInput(listRequestMessagesQuerySchema, req.query);
    return app.requests.messages.list(tenantId, id, after);
  });

  app.post(
    "/:id/messages",
    { preHandler: [requirePerm("support_requests.view"), requirePerm("support_requests.message")] },
    async (req, reply): Promise<SendRequestMessageResponse> => {
      const { tenantId } = tenantScope(req);
      const id = idParam(req);
      const { body, clientMsgId } = parseInput(sendRequestMessageInputSchema, req.body);
      take(msgWriteUser, authOf(req).user.id);
      take(msgWriteTenant, tenantId);
      const out = await app.requests.messages.fromTech(auditContext(req), authOf(req), tenantId, id, body, clientMsgId);
      return reply.status(201).send(out);
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
