// /api/v1/customer-send (mimari-link-gonderme §4.2): requireAuth (CSRF) → tenantScope → zod → servis. Ayrıntılı yetki hedefe
// göre serviste (§6). POST: gövde gizli değer (bağlantı, kod) taşır; sorgu dizesine konmaz (G-10). D-LG-1: tüm yanıtlar no-store.
import {
  customerSendInputSchema,
  customerSendOptionsInputSchema,
  type CustomerSendOptions,
  type CustomerSendResponse,
} from "@remote/contracts/api/customer-send";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, tenantScope } from "../auth/guards.ts";
import { parseInput } from "../lib/errors.ts";
import { agentDeps } from "../sessions/routes.ts";
import { createGate } from "../unattended/gate.ts";
import { customerSend, customerSendOptions, type CustomerSendDeps } from "./service.ts";

export async function customerSendRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const gate = createGate(app.env);
  const deps = (): CustomerSendDeps => ({
    db: app.db,
    secrets: app.secrets,
    gate,
    publicBaseUrl: app.env.PUBLIC_BASE_URL,
    unattendedSha256: app.env.UNATTENDED_AGENT_SHA256,
    unattendedVersion: app.env.UNATTENDED_AGENT_VERSION,
    agent: agentDeps(app),
    mail: app.mail,
    whatsapp: app.whatsapp,
    sms: app.sms,
    metrics: app.metrics,
    serviceBinary: app.unattendedBinary,
    sendLink: {
      db: app.db,
      sms: app.sms,
      whatsapp: app.whatsapp,
      secrets: app.secrets,
      metrics: app.metrics,
      publicBaseUrl: app.env.PUBLIC_BASE_URL,
      limits: app.sendLinkLimits,
      agent: agentDeps(app),
    },
  });

  app.post("/options", async (req): Promise<CustomerSendOptions> => {
    const { tenantId } = tenantScope(req);
    const { target } = parseInput(customerSendOptionsInputSchema, req.body);
    return customerSendOptions(deps(), authOf(req), tenantId, target);
  });

  app.post("", async (req): Promise<CustomerSendResponse> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(customerSendInputSchema, req.body);
    await customerSend(deps(), auditContext(req), authOf(req), tenantId, input);
    return { sent: true };
  });
}
