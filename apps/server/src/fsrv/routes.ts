// P28b bayt uçları (mimari-p28b §4; D-P28b-2, D-P28b-5; AC-356, AC-360). `PUT …/uploads/:fid/chunks/:n` ve
// `GET …/files/:fid/content` ÇEREZ OKUMAZ: kimlik yalnız `Authorization: Bearer`, `onRequest`'te gövde okunmadan denetlenir.
// Belirteç yok / süresi dolmuş / fid uyuşmaz / satır CLEAN değil / (HISTORY) oturum, kullanıcı, yetki veya kapsam geçersiz →
// tek tip 404; IP başına 60/dk 404 → 429. Geçmiş link ucu (`POST /sessions/:id/stored-files/:fid/link`) çerez + CSRF.
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  FSRV_CONTENT_HEADERS,
  fsrvBearerSchema,
  fsrvChunkParamsSchema,
  fsrvContentParamsSchema,
  storedFileLinkInputSchema,
  storedFileLinkParamsSchema,
  type StoredFileLinkResponse,
} from "@remote/contracts/api/fsrv";
import { FSRV_CHUNK_BYTES, FSRV_LINK_PER_MIN, FSRV_NOTFOUND_PER_MIN_IP } from "@remote/contracts/ws-fsrv";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm } from "../auth/guards.ts";
import { resolveSessionById, type AuthContext } from "../auth/session.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { historyScope } from "../sessions/service.ts";
import { auditDownload } from "./lifecycle.ts";
import * as repo from "./repo.ts";
import { TokenTable, type TokenEntry } from "./tokens.ts";

const entries = new WeakMap<FastifyRequest, TokenEntry>();

/** RFC 6266/5987: ASCII yedek (tırnak, ters bölü, denetim ve ASCII dışı → `_`) + UTF-8 yüzde kodlu ad. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/** Bayt uçları (prefix `/api/v1/fsrv`). */
export async function fsrvRoutes(app: FastifyInstance): Promise<void> {
  const notFound = new FixedWindowCounter(FSRV_NOTFOUND_PER_MIN_IP + 1, 60_000, 60_000);
  app.addHook("onClose", async () => notFound.close());
  const svc = app.fsrv.service;

  /** Tek tip 404 (gövde yok); IP başına sınır aşılırsa 429. */
  const deny = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const wait = notFound.blockedFor(req.ip);
    if (wait > 0 || notFound.hit(req.ip)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    app.metrics.inc("rs_fsrv_denied_total", { reason: "token" });
    return reply.code(404).header("Cache-Control", "no-store").send();
  };

  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: FSRV_CHUNK_BYTES + 1 }, (_req, body, done) =>
    done(null, body),
  );

  // D-P28b-2: belirteç gövde okunmadan; çerez okunmaz.
  app.addHook("onRequest", async (req, reply) => {
    const auth = fsrvBearerSchema.safeParse(req.headers.authorization);
    const upload = req.method === "PUT";
    const params = (upload ? fsrvChunkParamsSchema : fsrvContentParamsSchema).safeParse(req.params);
    const e = auth.success ? svc.tokens.get(auth.data) : null;
    if (!params.success || !e || e.fid !== params.data.fid || (upload ? e.kind !== "upload" : e.kind !== "download"))
      return deny(req, reply);
    entries.set(req, e);
    return undefined;
  });

  app.put("/uploads/:fid/chunks/:n", { bodyLimit: FSRV_CHUNK_BYTES + 1 }, async (req, reply) => {
    const { fid, n } = fsrvChunkParamsSchema.parse(req.params);
    const body = req.body;
    if (!Buffer.isBuffer(body)) throw new AppError("VALIDATION", { message: "Gövde application/octet-stream olmalı." });
    const r = await svc.putChunk(fid, n, body);
    void reply.header("Cache-Control", "no-store");
    if ("quota" in r) throw new AppError("STORAGE_QUOTA");
    if (!("body" in r)) {
      if (r.status === 404) return deny(req, reply);
      throw new AppError("VALIDATION", { message: "Parça boyu beklenenle uyuşmuyor." });
    }
    return reply.code(r.status).send(r.body);
  });

  // HEAD açılmaz: her istek `file.download` audit'i yazar ve akış başlatır.
  app.get("/files/:fid/content", { exposeHeadRoute: false }, async (req, reply) => {
    const e = entries.get(req);
    if (e?.kind !== "download") return deny(req, reply);
    const row = await repo.findRow(app.db, e.fid);
    if (!row || row.tenantId !== e.tenantId || row.sessionId !== e.sessionId || row.state !== "CLEAN" || !row.storageRel)
      return deny(req, reply);
    let username: string | null = null;
    if (e.actor.kind === "HISTORY") {
      const ok = await historyAllowed(app, e.actor, row);
      if (!ok) return deny(req, reply);
      username = ok.user.email;
    } else if (e.actor.kind === "TECH") {
      username = (await app.db.user.findUnique({ where: { id: e.actor.userId }, select: { email: true } }))?.email ?? null;
    }
    auditDownload(svc, { id: row.id, tenantId: row.tenantId, sessionId: row.sessionId }, e.actor, username, auditContext(req));
    const size = Number(row.sizeBytes);
    void reply.headers({
      ...FSRV_CONTENT_HEADERS,
      "Content-Length": String(size),
      "Content-Disposition": contentDisposition(row.fileName),
    });
    return reply.send(Readable.from(svc.plain({ rel: row.storageRel, keyVer: row.keyVer, size, tenantId: row.tenantId, fid: row.id })));
  });
}

/** D-P28b-2: HISTORY belirteci GET anında — oturum + kullanıcı etkin, iki yetki ve geçmiş kapsamı yeniden. */
async function historyAllowed(
  app: FastifyInstance,
  actor: { userId: string; authSessionId: string },
  row: { tenantId: string; sessionId: string; purpose: string; deliveredAt: Date | null },
): Promise<AuthContext | null> {
  if (row.purpose !== "FILE" || row.deliveredAt === null) return null;
  const auth = await resolveSessionById(app.db, actor.authSessionId, new Date(), { setupEnforced: app.mfaSetupEnforced });
  if (!auth || auth.user.id !== actor.userId || auth.user.mustChangePassword) return null;
  if (!(await inHistoryScope(app, auth, row.tenantId, row.sessionId))) return null;
  return auth;
}

async function inHistoryScope(app: FastifyInstance, auth: AuthContext, tenantId: string, sessionId: string): Promise<boolean> {
  if (!auth.permissions.has("session_history.view") || !auth.permissions.has("file_transfer.use")) return false;
  let scope: ReturnType<typeof historyScope>;
  try {
    scope = historyScope(auth);
  } catch {
    return false;
  }
  if (scope.kind === "tenant" && scope.tenantId !== tenantId) return false;
  const s = await app.db.supportSession.findFirst({
    where: { id: sessionId, tenantId, ...(scope.kind === "tenant" && scope.technicianId ? { technicianId: scope.technicianId } : {}) },
    select: { id: true },
  });
  return s !== null;
}

/** Geçmiş link ucu (prefix `/api/v1/sessions`): çerez + Origin + CSRF (requireAuth), iki yetki, `historyScope`, 20/dk/kullanıcı. */
export async function storedFileLinkRoutes(app: FastifyInstance): Promise<void> {
  const limit = new FixedWindowCounter(FSRV_LINK_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => limit.close());
  app.addHook("preHandler", requireAuth);
  const perms = { preHandler: [requirePerm("session_history.view"), requirePerm("file_transfer.use")] };
  app.post("/:id/stored-files/:fid/link", perms, async (req, reply): Promise<StoredFileLinkResponse> => {
    const { id, fid } = parseInput(storedFileLinkParamsSchema, req.params);
    parseInput(storedFileLinkInputSchema, req.body ?? {});
    const auth = authOf(req);
    const wait = limit.blockedFor(auth.user.id);
    if (wait > 0 || limit.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    void reply.header("Cache-Control", "no-store");
    const row = await repo.findRow(app.db, fid);
    const stored = row?.sessionId === id && row.purpose === "FILE" && row.state === "CLEAN" && row.deliveredAt !== null && row.storageRel;
    if (!row || !stored || !(await inHistoryScope(app, auth, row.tenantId, id))) throw new AppError("NOT_FOUND");
    const expiresAt = TokenTable.ttl(app.fsrv.service.d.clock.now());
    const token = app.fsrv.service.tokens.issue({
      kind: "download",
      fid,
      sessionId: id,
      tenantId: row.tenantId,
      actor: { kind: "HISTORY", userId: auth.user.id, authSessionId: auth.sessionId },
      expiresAt,
    });
    return { fid, token, expiresAt: new Date(expiresAt).toISOString() };
  });
}
