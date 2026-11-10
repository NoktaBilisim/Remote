// /api/v1/sessions (teknisyen) ve /api/v1/public/sessions (müşteri, çerezsiz) uçları — P2 kısmı.
// Sıra: requireAuth → requirePerm → tenantScope → zod → servis → yanıt. Handler'da iş mantığı yok.
import {
  createSessionInputSchema,
  listSessionsQuerySchema,
  resolveSessionInputSchema,
  sessionStatusQuerySchema,
  type CancelSessionResponse,
  type CreateSessionResponse,
  type PublicSessionStatusResponse,
  type ResolveSessionResponse,
  type SessionListResponse,
  type SessionView,
} from "@remote/contracts/api/sessions";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, checkOrigin, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { publicSessionStatus, resolvePublicSession } from "./public.ts";
import { cancelSession, createSupportSession, getSession, listSessions } from "./service.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Biçimsiz id de 404 (varlık/biçim bilgisi sızmaz). */
function idParam(req: FastifyRequest): string {
  const { id } = req.params as { id?: string };
  if (!id || !ULID.test(id)) throw new AppError("NOT_FOUND");
  return id;
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("", { preHandler: requirePerm("sessions.create") }, async (req, reply): Promise<CreateSessionResponse> => {
    const { tenantId } = tenantScope(req);
    parseInput(createSessionInputSchema, req.body);
    const created = await createSupportSession(app.db, auditContext(req), authOf(req), tenantId, app.env.PUBLIC_BASE_URL);
    void reply.status(201).header("Cache-Control", "no-store");
    return created;
  });

  app.get("", { preHandler: requirePerm("sessions.view") }, async (req): Promise<SessionListResponse> => {
    const { tenantId } = tenantScope(req);
    return listSessions(app.db, authOf(req), tenantId, parseInput(listSessionsQuerySchema, req.query));
  });

  app.get("/:id", { preHandler: requirePerm("sessions.view") }, async (req): Promise<SessionView> => {
    const { tenantId } = tenantScope(req);
    return getSession(app.db, authOf(req), tenantId, idParam(req));
  });

  app.post("/:id/cancel", { preHandler: requirePerm("sessions.delete") }, async (req): Promise<CancelSessionResponse> => {
    const { tenantId } = tenantScope(req);
    await cancelSession(app.db, auditContext(req), authOf(req), tenantId, idParam(req));
    return { status: "CANCELLED" };
  });
}

export async function publicSessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/resolve", async (req, reply): Promise<ResolveSessionResponse> => {
    checkOrigin(req);
    const input = parseInput(resolveSessionInputSchema, req.body);
    const out = await resolvePublicSession(app.db, app.publicLimits, app.sessionRefKey, auditContext(req), input);
    void reply.header("Cache-Control", "no-store");
    return out;
  });

  app.get("/status", async (req, reply): Promise<PublicSessionStatusResponse> => {
    const parsed = sessionStatusQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError("NOT_FOUND");
    const { ref } = parsed.data;
    const out = await publicSessionStatus(app.db, app.publicLimits, app.sessionRefKey, auditContext(req), ref);
    void reply.header("Cache-Control", "no-store");
    return out;
  });
}
