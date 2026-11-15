// P15 (AC-235): /api/v1/request-blocks — talep engelleri. Sıra: requireAuth (CSRF) → `support_requests.block` →
// tenantScope (Super Admin firma seçmeli) → (yazmada) hız sınırı → zod → servis. Liste sayfalı (≤ 100).
import {
  createRequestBlockInputSchema,
  listRequestBlocksQuerySchema,
  requestBlockIdSchema,
  type RequestBlockItem,
  type RequestBlockListResponse,
} from "@remote/contracts/api/request-blocks";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { createBlock, deleteBlock, listBlocks, type BlockDeps } from "./blocks.ts";

/** Yazma uçları kullanıcı başına dakikada 30 (P14a `/users*` kalıbı). */
export const REQUEST_BLOCK_WRITES_PER_MIN = 30;

export async function requestBlockRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requirePerm("support_requests.block"));
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const writes = new FixedWindowCounter(REQUEST_BLOCK_WRITES_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => writes.close());
  app.addHook("preHandler", async (req) => {
    if (req.method === "GET" || req.method === "HEAD") return;
    const key = authOf(req).user.id;
    const wait = writes.blockedFor(key);
    if (wait > 0 || writes.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: writes.blockedFor(key) || 60 });
  });
  const d = (): BlockDeps => ({ db: app.db, cache: app.requests.blocks, now: () => app.requests.d.clock.now() });

  app.get("", async (req): Promise<RequestBlockListResponse> =>
    listBlocks(d(), tenantScope(req).tenantId, parseInput(listRequestBlocksQuerySchema, req.query)),
  );

  app.post("", async (req, reply): Promise<RequestBlockItem> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(createRequestBlockInputSchema, req.body);
    const out = await createBlock(d(), auditContext(req), authOf(req), tenantId, input);
    return reply.status(201).send(out);
  });

  app.delete("/:id", async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const id = requestBlockIdSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) throw new AppError("NOT_FOUND");
    await deleteBlock(d(), auditContext(req), authOf(req), tenantId, id.data);
    return reply.status(204).send();
  });
}
