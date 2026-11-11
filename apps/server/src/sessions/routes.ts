// /api/v1/sessions (teknisyen) ve /api/v1/public/sessions (müşteri, çerezsiz) uçları — P2 kısmı.
// Sıra: requireAuth → requirePerm → tenantScope → zod → servis → yanıt. Handler'da iş mantığı yok.
// P8 oturum geçmişi uçları (liste, :id, :id/history, PATCH, export.csv) tenantScope yerine `historyScope` kullanır
// (mimari §5.1 istisnası: firma seçmemiş Super Admin tüm tenant'lar).
import {
  createSessionInputSchema,
  joinSessionInputSchema,
  terminateSessionInputSchema,
  type JoinSessionResponse,
  type TerminateSessionResponse,
  listSessionsQuerySchema,
  resolveSessionInputSchema,
  sessionStatusQuerySchema,
  type CancelSessionResponse,
  type CreateSessionResponse,
  type PublicSessionStatusResponse,
  type ResolveSessionResponse,
  type SessionListResponse,
  type SessionView,
  type SessionHistoryDetail,
  updateSessionInputSchema,
} from "@remote/contracts/api/sessions";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, checkPublicClient, requireAnyPerm, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { exportHistoryCsv, getHistoryDetail, listHistorySessions, updateHistory } from "./history.ts";
import { publicSessionStatus, resolvePublicSession } from "./public.ts";
import { issueJoinNonce, joinPublicSession } from "../public/service.ts";
import { cancelSession, createSupportSession, getSession, terminateSession } from "./service.ts";

const MIN_MS = 60_000;

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

  // S8-3: müşteri araması 60/dk/kullanıcı (61. istek 429).
  const customerSearchLimit = new FixedWindowCounter(61, MIN_MS, MIN_MS);
  app.addHook("onClose", async () => customerSearchLimit.close());
  // P8 (AC-60, 61): konsol listesi ve geçmiş ekranı aynı uç — sessions.view VEYA session_history.view.
  app.get("", { preHandler: requireAnyPerm("sessions.view", "session_history.view") }, async (req, reply): Promise<SessionListResponse> => {
    const q = parseInput(listSessionsQuerySchema, req.query);
    void reply.header("Cache-Control", "no-store");
    return listHistorySessions(app.db, authOf(req), q, customerSearchLimit);
  });

  // AC-63, 124: 5/dk/kullanıcı (6. istek reddedilir). Statik yol `/:id`'den önce eşleşir (find-my-way).
  const exportLimit = new FixedWindowCounter(6, MIN_MS, MIN_MS);
  app.addHook("onClose", async () => exportLimit.close());
  app.get("/export.csv", { preHandler: requirePerm("session_history.export") }, async (req, reply) => {
    const q = parseInput(listSessionsQuerySchema, req.query);
    const out = await exportHistoryCsv(app.db, req.log, auditContext(req), authOf(req), q, exportLimit);
    void reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${out.filename}"`)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(out.body);
  });

  app.get("/:id", { preHandler: requirePerm("sessions.view") }, async (req): Promise<SessionView> => {
    return getSession(app.db, authOf(req), idParam(req));
  });

  app.get("/:id/history", { preHandler: requirePerm("session_history.view") }, async (req, reply): Promise<SessionHistoryDetail> => {
    const id = idParam(req);
    void reply.header("Cache-Control", "no-store");
    return getHistoryDetail(app.db, req.log, authOf(req), id);
  });

  // AC-63: Origin + CSRF requireAuth'ta (PATCH). Kapsam UPDATE'in where'inde; audit session.updated (not metni yok).
  app.patch("/:id", { preHandler: requirePerm("session_history.edit") }, async (req, reply): Promise<SessionHistoryDetail> => {
    const id = idParam(req);
    const data = parseInput(updateSessionInputSchema, req.body);
    void reply.header("Cache-Control", "no-store");
    return updateHistory(app.db, req.log, auditContext(req), authOf(req), id, data);
  });

  app.post("/:id/cancel", { preHandler: requirePerm("sessions.delete") }, async (req): Promise<CancelSessionResponse> => {
    const { tenantId } = tenantScope(req);
    await cancelSession(app.db, auditContext(req), authOf(req), tenantId, idParam(req), app.rooms);
    return { status: "CANCELLED" };
  });

  // A5, AC-114 (G-04): Admin aynı tenant / Super Admin (seçili tenant). Odaya session.ended{admin}.
  app.post("/:id/terminate", { preHandler: requirePerm("sessions.terminate") }, async (req): Promise<TerminateSessionResponse> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    const { reason } = parseInput(terminateSessionInputSchema, req.body);
    await terminateSession(app.db, auditContext(req), authOf(req), tenantId, id, reason, app.rooms);
    return { status: "ENDED", endedBy: "ADMIN" };
  });
}

export async function publicSessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/resolve", async (req, reply): Promise<ResolveSessionResponse> => {
    const input = parseInput(resolveSessionInputSchema, req.body);
    checkPublicClient(req, input.clientKind); // ADR-0012
    const out = await resolvePublicSession(app.db, app.publicLimits, app.sessionRefKey, auditContext(req), input, (id, kind) => issueJoinNonce(app.rooms, id, kind), {
      fromEnv: app.env.ABUSE_EMAIL,
      superAdminFallback: app.env.NODE_ENV !== "production", // S-P4-1
    });
    void reply.header("Cache-Control", "no-store");
    return out;
  });

  app.post("/join", async (req, reply): Promise<JoinSessionResponse> => {
    const input = parseInput(joinSessionInputSchema, req.body);
    const out = await joinPublicSession(app.db, app.rooms, app.publicLimits.joinIp, auditContext(req), (kind) => checkPublicClient(req, kind), input);
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
