// /api/v1/users (P9; mimari-api "Yönetim"). Sıra: requireAuth (CSRF durum değiştirenlerde) → requirePerm → tenantScope
// (Super Admin firma seçmeli) → zod → servis. P10: /users/:id/reset-mfa (2FA sıfırlama).
import {
  createUserInputSchema,
  listUsersQuerySchema,
  updateUserInputSchema,
  userActionInputSchema,
  userIdSchema,
  type CreateUserResponse,
  type UserDetail,
  type UserListResponse,
} from "@remote/contracts/api/users";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  reactivateUser,
  resetUserMfa,
  updateUser,
  type UserLiveEffects,
} from "./service.ts";

function idParam(req: FastifyRequest): string {
  const r = userIdSchema.safeParse((req.params as { id?: string }).id);
  if (!r.success) throw new AppError("NOT_FOUND");
  return r.data;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const fx = (): UserLiveEffects => ({ rooms: app.rooms, hub: app.requestHub, log: app.log });
  const view = { preHandler: requirePerm("users.view") };
  // mimari-api: deactivate (ve P9 eki reactivate) users.edit; users.delete'in ucu yok (kalıcı silme yok).
  const edit = { preHandler: requirePerm("users.edit") };

  app.get("", view, async (req): Promise<UserListResponse> => {
    const { tenantId } = tenantScope(req);
    return listUsers(app.db, tenantId, parseInput(listUsersQuerySchema, req.query));
  });

  app.post("", { preHandler: requirePerm("users.create") }, async (req, reply): Promise<CreateUserResponse> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(createUserInputSchema, req.body);
    const out = await createUser(app.db, auditContext(req), authOf(req), tenantId, input);
    return reply.status(201).send(out);
  });

  app.get("/:id", view, async (req): Promise<UserDetail> => getUser(app.db, authOf(req), tenantScope(req).tenantId, idParam(req)));

  app.patch("/:id", edit, async (req): Promise<UserDetail> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    return updateUser(app.db, fx(), auditContext(req), authOf(req), tenantId, id, parseInput(updateUserInputSchema, req.body));
  });

  app.post("/:id/deactivate", edit, async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(userActionInputSchema, req.body);
    await deactivateUser(app.db, fx(), auditContext(req), authOf(req), tenantId, id);
    return reply.status(204).send();
  });

  // P10 (AC-67, 115): Admin kullanıcının 2FA'sını sıfırlar.
  app.post("/:id/reset-mfa", edit, async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(userActionInputSchema, req.body);
    await resetUserMfa(app.db, fx(), auditContext(req), authOf(req), tenantId, id);
    return reply.status(204).send();
  });

  app.post("/:id/reactivate", edit, async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    parseInput(userActionInputSchema, req.body);
    await reactivateUser(app.db, auditContext(req), authOf(req), tenantId, id);
    return reply.status(204).send();
  });
}
