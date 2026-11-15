// /api/v1/users (P9; mimari-api "Yönetim"). Sıra: requireAuth (CSRF durum değiştirenlerde) → requirePerm → tenantScope
// (Super Admin firma seçmeli) → zod → servis. P10: /users/:id/reset-mfa (2FA sıfırlama).
// P14a: yazma uçları kullanıcı başına 30/dk, POST ayrıca 10/dk (AC-203); PATCH `If-Match` zorunlu, GET/PATCH `ETag`
// (AC-206). P14b: GET /users/options (AC-225; Super Admin `?tenantId=`).
import {
  USERS_CREATES_PER_MIN,
  USERS_WRITES_PER_MIN,
  createUserInputSchema,
  deleteUserInputSchema,
  parseUserIfMatch,
  userEtag,
  listUsersQuerySchema,
  updateUserInputSchema,
  userActionInputSchema,
  userIdSchema,
  userOptionsQuerySchema,
  type CreateUserResponse,
  type UserDetail,
  type UserListResponse,
  type UserOptionsResponse,
} from "@remote/contracts/api/users";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAnyPerm, requireAuth, requirePerm, requireStepUp, tenantScope } from "../auth/guards.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  purgeUser,
  reactivateUser,
  resetUserMfa,
  updateUser,
  userOptions,
  userOptionsTenant,
  type UserLiveEffects,
} from "./service.ts";

const UNSAFE: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Kullanıcı başına sabit pencere (lib/rate); aşımda 429 + Retry-After (sn). */
function limitBy(counter: FixedWindowCounter) {
  return async (req: FastifyRequest): Promise<void> => {
    const key = authOf(req).user.id;
    const wait = counter.blockedFor(key);
    if (wait > 0) throw new AppError("RATE_LIMITED", { retryAfterSec: wait });
    if (counter.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: counter.blockedFor(key) || 60 });
  };
}

const withEtag = (reply: FastifyReply, d: UserDetail): UserDetail => {
  void reply.header("ETag", userEtag(d.version));
  return d;
};

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
  // AC-203: N. istek geçer, N+1. → 429 (FixedWindowCounter `limit` = kilidin başladığı olay).
  const writes = new FixedWindowCounter(USERS_WRITES_PER_MIN + 1, 60_000, 60_000);
  const creates = new FixedWindowCounter(USERS_CREATES_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => {
    writes.close();
    creates.close();
  });
  const writeLimit = limitBy(writes);
  app.addHook("preHandler", async (req) => {
    if (UNSAFE.has(req.method)) await writeLimit(req);
  });
  const fx = (): UserLiveEffects => ({ rooms: app.rooms, hub: app.requestHub, log: app.log });
  const view = { preHandler: requirePerm("users.view") };
  // mimari-api: deactivate (ve P9 eki reactivate) users.edit; P16: users.delete → DELETE /users/:id (kalıcı silme).
  const edit = { preHandler: requirePerm("users.edit") };

  app.get("", view, async (req): Promise<UserListResponse> => {
    const { tenantId } = tenantScope(req);
    return listUsers(app.db, tenantId, parseInput(listUsersQuerySchema, req.query));
  });

  // P14b (AC-225): teknisyen filtre seçenekleri (tam liste ≤ 1000; USER yalnız kendisi). Firma seçmemiş Super Admin
  // `?tenantId=` ile firma seçer; diğer rollerde parametre yok sayılır (etkin tenant ezer).
  app.get(
    "/options",
    { preHandler: requireAnyPerm("session_history.view", "support_requests.view", "users.view") },
    async (req): Promise<UserOptionsResponse> => {
      const auth = authOf(req);
      const { tenantId, includeDeleted } = parseInput(userOptionsQuerySchema, req.query);
      return userOptions(app.db, auth, await userOptionsTenant(app.db, auth, tenantId), includeDeleted);
    },
  );

  app.post("", { preHandler: [limitBy(creates), requirePerm("users.create")] }, async (req, reply): Promise<CreateUserResponse> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(createUserInputSchema, req.body);
    const out = await createUser(app.db, auditContext(req), authOf(req), tenantId, input);
    return reply.status(201).send(out);
  });

  app.get("/:id", view, async (req, reply): Promise<UserDetail> =>
    withEtag(reply, await getUser(app.db, authOf(req), tenantScope(req).tenantId, idParam(req))),
  );

  // AC-206: If-Match yoksa/bozuksa 428 (gövdeden önce; kayıt varlığı sızmaz), sürüm güncel değilse servis 409 STALE_WRITE.
  app.patch("/:id", edit, async (req, reply): Promise<UserDetail> => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    const version = parseUserIfMatch(req.headers["if-match"]);
    if (version === null) throw new AppError("PRECONDITION_REQUIRED");
    const input = parseInput(updateUserInputSchema, req.body);
    return withEtag(reply, await updateUser(app.db, fx(), auditContext(req), authOf(req), tenantId, id, input, version));
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

  // P16 (AC-237, AC-241): kalıcı silme. Sıra: yazma hızı (kanca) → users.delete (anahtarsız 403, step-up'tan önce) →
  // step-up → If-Match (428) → gövde (400) → servis.
  app.delete("/:id", { preHandler: [requirePerm("users.delete"), requireStepUp()] }, async (req, reply) => {
    const { tenantId } = tenantScope(req);
    const id = idParam(req);
    const version = parseUserIfMatch(req.headers["if-match"]);
    if (version === null) throw new AppError("PRECONDITION_REQUIRED");
    const { confirmName } = parseInput(deleteUserInputSchema, req.body);
    const fx = { removeFile: (rel: string | null) => app.uploads.remove(rel), ledger: app.erasureLedger, log: app.log };
    await purgeUser(app.db, fx, auditContext(req), authOf(req), tenantId, id, confirmName, version);
    return reply.status(204).send();
  });
}
