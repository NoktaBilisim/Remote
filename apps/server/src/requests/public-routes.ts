// /api/v1/public/requests (çerezsiz, kimliksiz; ADR-0012 AGENT kuralı) ve firma indirme ucu (mimari-api "Public").
// ref ve talep sırrı loga/audit'e yazılmaz (logger `*.ref`, `*.requestSecret` redakte; URL sorgu dizesi loglanmaz).
import { cancelRequestInputSchema, createRequestInputSchema, type CreateRequestResponse, type TenantRequestInfo } from "@remote/contracts/api/requests";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { checkPublicClient } from "../auth/guards.ts";
import { parseInput } from "../lib/errors.ts";
import { assertAgentReady } from "../public/agent.ts";

const refOf = (q: unknown): unknown => (typeof q === "object" && q !== null ? (q as { ref?: unknown }).ref : undefined);

export async function publicRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tenant", async (req, reply): Promise<TenantRequestInfo> => {
    void reply.header("Cache-Control", "no-store");
    return app.requests.tenantInfo(auditContext(req), refOf(req.query));
  });

  // bodyLimit 8 KB (§5.2 T30); sıra G-E9-10 servis içinde.
  app.post("", { bodyLimit: 8 * 1024 }, async (req, reply): Promise<CreateRequestResponse> => {
    void reply.header("Cache-Control", "no-store");
    checkPublicClient(req, "AGENT");
    const out = await app.requests.create(auditContext(req), req.body, (b) => parseInput(createRequestInputSchema, b));
    return reply.status(201).send(out);
  });

  app.post("/cancel", { bodyLimit: 1024 }, async (req, reply) => {
    checkPublicClient(req, "AGENT");
    const { requestSecret } = parseInput(cancelRequestInputSchema, req.body);
    await app.requests.cancelBySecret(auditContext(req), requestSecret);
    return reply.status(204).header("Cache-Control", "no-store").send();
  });
}

export async function publicRequestDownloadRoutes(app: FastifyInstance): Promise<void> {
  // AC-130/132: 302 → /downloads/NoktaDestek-<label>-<ref>.exe (aynı jenerik ikili; son yanıtı Caddy verir).
  app.get("/request-download", async (req, reply) => {
    void reply.header("Cache-Control", "no-store");
    const location = await app.requests.download(auditContext(req), refOf(req.query), () => assertAgentReady(app.agentBinary));
    return reply.redirect(location, 302);
  });
}
