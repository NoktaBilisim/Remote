// /api/v1/public/web-requests (P19 §8c.2, §8c.6; AC-259): web talep formu. Çerezsiz; BROWSER kuralı (Origin izin listesinde;
// CORS başlığı verilmez, aynı köken). ref, talep sırrı, form token'ı ve gizli alan loga/audit'e yazılmaz (logger redakte).
import type { CreateRequestResponse, WebFormInfo } from "@remote/contracts/api/requests";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { checkPublicClient } from "../auth/guards.ts";

const refOf = (q: unknown): unknown => (typeof q === "object" && q !== null ? (q as { ref?: unknown }).ref : undefined);

export async function publicWebRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/form", async (req, reply): Promise<WebFormInfo> => {
    void reply.header("Cache-Control", "no-store");
    return app.requests.webFormInfo(auditContext(req), refOf(req.query));
  });

  // Sıra (§8c.2 m.2): bodyLimit 8 KB → Origin → zod → bot kapısı → ref/form → kovalar → mesai → TX.
  app.post("", { bodyLimit: 8 * 1024 }, async (req, reply): Promise<CreateRequestResponse> => {
    void reply.header("Cache-Control", "no-store");
    checkPublicClient(req, "BROWSER");
    const out = await app.requests.createWeb(auditContext(req), req.body);
    return reply.status(201).send(out);
  });
}
