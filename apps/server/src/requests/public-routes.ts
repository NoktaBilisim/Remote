// /api/v1/public/requests (çerezsiz, kimliksiz; ADR-0012 AGENT kuralı) ve firma indirme ucu (mimari-api "Public").
// ref ve talep sırrı loga/audit'e yazılmaz (logger `*.ref`, `*.requestSecret` redakte; URL sorgu dizesi loglanmaz).
import {
  cancelRequestInputSchema,
  createRequestInputSchema,
  requestDownloadQuerySchema,
  type CreateRequestResponse,
  type TenantRequestInfo,
} from "@remote/contracts/api/requests";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { checkPublicClient } from "../auth/guards.ts";
import { parseInput } from "../lib/errors.ts";
import { assertAgentReady } from "../public/agent.ts";
import type { DownloadGates } from "./service.ts";

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

  // P19 (§8c.2 m.4): AGENT veya BROWSER (Origin varsa BROWSER kuralı); tür ↔ `source` uyuşmazlığında sessizce 204.
  app.post("/cancel", { bodyLimit: 1024 }, async (req, reply) => {
    const kind = req.headers.origin !== undefined ? "BROWSER" : "AGENT";
    checkPublicClient(req, kind);
    const { requestSecret } = parseInput(cancelRequestInputSchema, req.body);
    await app.requests.cancelBySecret(auditContext(req), requestSecret, kind === "BROWSER" ? "WEB" : "AGENT");
    return reply.status(204).header("Cache-Control", "no-store").send();
  });
}

export async function publicRequestDownloadRoutes(app: FastifyInstance): Promise<void> {
  const gates: DownloadGates = {
    assertReady: (os) => assertAgentReady(os === "macos" ? app.macAgentBinary : app.agentBinary),
    macosOk: async () => (await app.macAgentBinary.check()) === "ok",
  };
  // AC-130/132: 302 → /downloads/NoktaDestek-<label>-<ref>.exe (aynı jenerik ikili; son yanıtı Caddy verir). P31 (AC-509,
  // 521): `os` (windows|macos) ya da UA → macOS'ta `.zip`. Geçersiz `os` (linux dahil) servise girmeden 400 → kova tüketilmez.
  app.get("/request-download", async (req, reply) => {
    void reply.header("Cache-Control", "no-store");
    const { os } = parseInput(requestDownloadQuerySchema, req.query);
    const location = await app.requests.download(auditContext(req), refOf(req.query), os, gates);
    return reply.redirect(location, 302);
  });
}
