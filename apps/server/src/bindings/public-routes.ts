// /api/v1/public/bindings (P8c; mimari-api "Public (P8c)", ADR-0017). Çerezsiz; ADR-0012 AGENT kuralı. `bindingKey`
// yalnız gövdede (URL'de asla); logger `*.bindingKey` redakte, gövde zaten loglanmaz.
import type { BindingInfo } from "@remote/contracts/api/bindings";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { checkPublicClient } from "../auth/guards.ts";
import { bindingRevoke, bindingStatus } from "./service.ts";

export async function publicBindingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });

  app.post("/status", { bodyLimit: 1024 }, async (req): Promise<BindingInfo> => {
    checkPublicClient(req, "AGENT");
    return bindingStatus(app.requests, auditContext(req), req.body);
  });

  app.post("/revoke", { bodyLimit: 1024 }, async (req, reply) => {
    checkPublicClient(req, "AGENT");
    await bindingRevoke(app.requests, auditContext(req), req.body);
    return reply.status(204).send();
  });
}
