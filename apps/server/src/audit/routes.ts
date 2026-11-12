// /api/v1/audit (P11; AC-76, AC-124). Sıra: requireAuth → requirePerm → kapsam (auditScope) → zod → servis.
// Yalnız GET; POST/PUT/PATCH/DELETE → 405 METHOD_NOT_ALLOWED + `Allow` (kimlik doğrulamadan önce, deterministik).
import { AUDIT_READ_ONLY_MESSAGE, listAuditQuerySchema, type AuditListResponse } from "@remote/contracts/api/audit";
import type { FastifyInstance } from "fastify";
import { auditContext } from "./service.ts";
import { authOf, requireAuth, requirePerm } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { exportAuditCsv, listAuditItems } from "./read.ts";

const MIN_MS = 60_000;
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** 405 uçları: `/audit`, `/audit/export.csv` (Allow: GET, HEAD) ve `/audit/:id` (okunabilir tekil kaynak yok → Allow boş). */
export async function auditReadOnlyRoutes(app: FastifyInstance): Promise<void> {
  const deny = (allow: string) => async (_req: unknown, reply: { header(k: string, v: string): unknown }) => {
    void reply.header("Allow", allow);
    throw new AppError("METHOD_NOT_ALLOWED", { message: AUDIT_READ_ONLY_MESSAGE });
  };
  app.route({ method: [...WRITE_METHODS], url: "", handler: deny("GET, HEAD") });
  app.route({ method: [...WRITE_METHODS], url: "/export.csv", handler: deny("GET, HEAD") });
  app.route({ method: [...WRITE_METHODS], url: "/:id", handler: deny("") });
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });

  app.get("", { preHandler: requirePerm("audit.view") }, async (req): Promise<AuditListResponse> => listAuditItems(app.db, authOf(req), parseInput(listAuditQuerySchema, req.query)));

  // AC-124: 5/dk/kullanıcı (6. istek 429). Statik yol.
  const exportLimit = new FixedWindowCounter(6, MIN_MS, MIN_MS);
  app.addHook("onClose", async () => exportLimit.close());
  app.get("/export.csv", { preHandler: requirePerm("audit.export") }, async (req, reply) => {
    const q = parseInput(listAuditQuerySchema, req.query);
    const out = await exportAuditCsv(app.db, req.log, auditContext(req), authOf(req), q, exportLimit);
    void reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${out.filename}"`)
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(out.body);
  });
}
