// P28c REST uçları `/api/v1/sessions/...` (mimari-p28c r2 §4.1; AC-364, 365, 368, 372). Sıra: requireAuth (Origin + CSRF) →
// requirePerm → tenantScope → hız sınırı → zod → servis (`invites.ts`) → yanıt. Statik yollar (`/invites`, `/active`) `/:id`'den
// önce eşleşir (find-my-way). Silent odada katılım/devir dört göz e-postası kancası burada bağlanır (`rooms.silentNotify`).
import {
  createInviteInputSchema,
  inviteParamsSchema,
  joinWithReasonInputSchema,
  multiSessionParamsSchema,
  sessionInviteParamsSchema,
  type ActiveSessionsResponse,
  type CreateInviteResponse,
  type IncomingInvitesResponse,
  type InviteCandidatesResponse,
  type JoinSessionAsMemberResponse,
} from "@remote/contracts/api/multi";
import { MULTI_JOIN_PER_MIN, MULTI_POLL_PER_MIN } from "@remote/contracts/ws-multi";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import type { SilentJoinEvent } from "../signaling/member-life.ts";
import { createGate } from "../unattended/gate.ts";
import { sendSilentNotice, silentJoinMail } from "../unattended/mail.ts";
import {
  acceptInvite,
  activeSessions,
  createInvite,
  incomingInvites,
  inviteCandidates,
  rejectInvite,
  revokeInvite,
  supervise,
  type MultiDeps,
} from "./invites.ts";

const MIN_MS = 60_000;

/** Biçimsiz parametre → 404 (varlık/biçim bilgisi sızmaz). */
function params<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, req: FastifyRequest): T {
  const r = schema.safeParse(req.params);
  if (!r.success) throw new AppError("NOT_FOUND");
  return r.data;
}

function limited(c: FixedWindowCounter, key: string): void {
  const wait = c.blockedFor(key);
  if (wait > 0 || c.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
}

/** Silent odada katılım (`join`) / devir (`transfer`) dört göz e-postası (Y-PC-1; beklenmez, hata fırlatmaz). */
function bindSilentNotify(app: FastifyInstance): void {
  app.rooms.silentNotify = (e: SilentJoinEvent) => {
    const content = silentJoinMail({
      event: e.event,
      user: e.actor.fullName,
      role: e.role,
      owner: e.room.technicianName,
      device: e.room.unattended?.deviceName ?? "",
      at: new Date(app.rooms.clock.now()),
      ...(e.reason !== undefined ? { reason: e.reason } : {}),
    });
    void sendSilentNotice(
      { db: app.db, mail: app.mail, metrics: app.metrics, log: app.log },
      {
        ctx: e.ctx,
        tenantId: e.room.tenantId,
        actor: { userId: e.actor.userId, email: e.actor.email },
        event: e.event,
        entity: "support_sessions",
        entityId: e.room.sessionId,
        content,
      },
    );
  };
}

export async function multiSessionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  bindSilentNotify(app);
  const d = (): MultiDeps => ({ db: app.db, rooms: app.rooms, gate: createGate(app.env) });
  const poll = new FixedWindowCounter(MULTI_POLL_PER_MIN + 1, MIN_MS, MIN_MS);
  const join = new FixedWindowCounter(MULTI_JOIN_PER_MIN + 1, MIN_MS, MIN_MS);
  app.addHook("onClose", async () => {
    poll.close();
    join.close();
  });

  app.get("/invites", async (req, reply): Promise<IncomingInvitesResponse> => {
    const auth = authOf(req);
    limited(poll, `inv:${auth.user.id}`);
    void reply.header("Cache-Control", "no-store");
    return incomingInvites(d(), auth);
  });

  app.post("/invites/:inviteId/accept", async (req): Promise<JoinSessionAsMemberResponse> => {
    const auth = authOf(req);
    const { inviteId } = params(inviteParamsSchema, req);
    limited(join, auth.user.id);
    const { reason } = parseInput(joinWithReasonInputSchema, req.body);
    return acceptInvite(d(), auditContext(req), auth, inviteId, reason);
  });

  app.post("/invites/:inviteId/reject", async (req, reply) => {
    const { inviteId } = params(inviteParamsSchema, req);
    await rejectInvite(d(), auditContext(req), authOf(req), inviteId);
    return reply.status(204).send();
  });

  app.get("/active", { preHandler: requirePerm("sessions.supervise") }, async (req, reply): Promise<ActiveSessionsResponse> => {
    const auth = authOf(req);
    const { tenantId } = tenantScope(req);
    limited(poll, `act:${auth.user.id}`);
    void reply.header("Cache-Control", "no-store");
    return activeSessions(d(), auth, tenantId);
  });

  app.post("/:id/supervise", { preHandler: requirePerm("sessions.supervise") }, async (req): Promise<JoinSessionAsMemberResponse> => {
    const auth = authOf(req);
    const { tenantId } = tenantScope(req);
    const { id } = params(multiSessionParamsSchema, req);
    limited(join, auth.user.id);
    const { reason } = parseInput(joinWithReasonInputSchema, req.body);
    return supervise(d(), auditContext(req), auth, tenantId, id, reason);
  });

  const invitePerm = { preHandler: requirePerm("sessions.invite") };
  app.get("/:id/invite-candidates", invitePerm, async (req, reply): Promise<InviteCandidatesResponse> => {
    const { tenantId } = tenantScope(req);
    const { id } = params(multiSessionParamsSchema, req);
    void reply.header("Cache-Control", "no-store");
    return inviteCandidates(d(), authOf(req), tenantId, id);
  });

  app.post("/:id/invites", invitePerm, async (req, reply): Promise<CreateInviteResponse> => {
    const { tenantId } = tenantScope(req);
    const { id } = params(multiSessionParamsSchema, req);
    const { userId } = parseInput(createInviteInputSchema, req.body);
    const out = await createInvite(d(), auditContext(req), authOf(req), tenantId, id, userId);
    void reply.status(201).header("Cache-Control", "no-store");
    return out;
  });

  app.delete("/:id/invites/:inviteId", async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const { id, inviteId } = params(sessionInviteParamsSchema, req);
    await revokeInvite(d(), auditContext(req), authOf(req), tenantId, id, inviteId);
    return reply.status(204).send();
  });
}
