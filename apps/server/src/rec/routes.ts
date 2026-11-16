// P28e kayıt uçları (mimari-p28e r2 §5; AC-383..386, 450; S-P28e-3/5/6/7). Parça uçları (`/api/v1/rec`) ÇEREZ OKUMAZ: kimlik
// yalnız `Authorization: Bearer`, `onRequest`'te gövde okunmadan (belirteç, rid, tek uçuş/oran/semafor, kullanıcı + oturum,
// ön denetim). Belirteç yok/uyuşmaz/düşmüş → tek tip 404; IP başına 60/dk 404 → 429. Geçmiş uçları (`/api/v1/sessions`)
// çerez + CSRF (requireAuth), yetki + `historyScope`; kapsam dışı 404.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  REC_PART_CONTENT_HEADERS,
  deleteRecordingInputSchema,
  recBearerSchema,
  recPartHeadersSchema,
  recPartParamsSchema,
  recSeriesStartValid,
  recordingParamsSchema,
  recordingViewInputSchema,
  type RecordingSeriesItem,
  type RecordingView,
  type RecordingViewResponse,
} from "@remote/contracts/api/recording";
import type { ConsentMode } from "@remote/contracts/unattended-consent";
import { REC_NOTFOUND_PER_MIN_IP, REC_PART_MAX_BYTES, REC_PART_CONTENT_TYPE, REC_VIEW_PER_MIN, recFromDb } from "@remote/contracts/ws-rec";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm } from "../auth/guards.ts";
import { resolveSessionById, type AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { historyScope } from "../sessions/service.ts";
import { deleteRecording } from "./delete.ts";
import { PutGate } from "./limits.ts";
import * as repo from "./repo.ts";
import type { PartOutcome, PartRequest } from "./service.ts";
import { REC_METRICS, type RecUploadTokenEntry, type RecViewTokenEntry } from "./types.ts";

interface PartCtx {
  upload?: PartRequest;
  view?: RecViewTokenEntry;
  s: number;
  p: number;
  release?: () => void;
}
const ctxOf = new WeakMap<FastifyRequest, PartCtx>();

/** Oturum kapsamda mı (historyScope: Admin tenant'ı, teknisyen yalnız kendi oturumları). Dönen satır ya da null. */
export async function sessionInScope(db: Db, auth: AuthContext, sessionId: string) {
  let scope: ReturnType<typeof historyScope>;
  try {
    scope = historyScope(auth);
  } catch {
    return null;
  }
  return db.supportSession.findFirst({
    where: {
      id: sessionId,
      ...(scope.kind === "tenant" ? { tenantId: scope.tenantId, ...(scope.technicianId ? { technicianId: scope.technicianId } : {}) } : {}),
    },
    select: { id: true, tenantId: true, consentMode: true, silentReason: true, anonymizedAt: true },
  });
}

const canView = (auth: AuthContext): boolean =>
  auth.permissions.has("session_history.view") && auth.permissions.has("sessions.view_recording");

/** Parça uçları (prefix `/api/v1/rec`). */
export async function recPartRoutes(app: FastifyInstance): Promise<void> {
  const notFound = new FixedWindowCounter(REC_NOTFOUND_PER_MIN_IP + 1, 60_000, 60_000);
  app.addHook("onClose", async () => notFound.close());
  const gate = new PutGate();
  const { service: svc, views } = app.rec;
  const metric = (result: string): void => app.metrics.inc(REC_METRICS.PART_TOTAL, { result });

  const deny = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const wait = notFound.blockedFor(req.ip);
    if (wait > 0 || notFound.hit(req.ip)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    return reply.code(404).header("Cache-Control", "no-store").send();
  };
  const busy = (): never => {
    metric("busy");
    throw new AppError("RATE_LIMITED", { retryAfterSec: 1 });
  };
  const send = async (req: FastifyRequest, reply: FastifyReply, out: PartOutcome): Promise<FastifyReply> => {
    void reply.header("Cache-Control", "no-store");
    switch (out.kind) {
      case "ok":
      case "dup":
        return reply.code(200).send({ next: out.next });
      case "order":
        return reply.code(409).send({ next: out.next });
      case "gone":
        return deny(req, reply);
      case "quota":
        throw new AppError("STORAGE_QUOTA");
      case "invalid":
        throw new AppError("VALIDATION", { message: "Kayıt parçası geçersiz." });
      case "conflict":
      case "rate":
        throw new AppError("CONFLICT");
    }
  };

  app.addContentTypeParser(REC_PART_CONTENT_TYPE, { parseAs: "buffer", bodyLimit: REC_PART_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  const release = async (req: FastifyRequest): Promise<void> => ctxOf.get(req)?.release?.();
  app.addHook("onResponse", release);
  app.addHook("onRequestAbort", release);

  // S-P28e-5/6: gövde okunmadan; çerez okunmaz.
  app.addHook("onRequest", async (req, reply) => {
    const auth = recBearerSchema.safeParse(req.headers.authorization);
    const e = auth.success ? svc.tokens.get(auth.data) : null;
    const upload = req.method === "PUT";
    if (!e || (upload ? e.kind !== "recUpload" : e.kind !== "recView")) return deny(req, reply);
    const { rid, s, p } = parseInput(recPartParamsSchema, req.params);
    if (rid !== e.rid) return deny(req, reply);
    if (e.kind === "recView") return void ctxOf.set(req, { view: e, s, p });
    const h = parseInput(recPartHeadersSchema, req.headers);
    if (!recSeriesStartValid(p, h["x-rec-series-start-ms"]))
      throw new AppError("VALIDATION", { fields: { "x-rec-series-start-ms": "Bölüm başlangıcı yalnız ilk parçada gönderilir" } });
    const key = sha256Hex(auth.data ?? "");
    const rel = gate.enter(key, app.rec.service.d.clock.now());
    if (!rel) return busy();
    const r: PartRequest = { entry: e, s, p, durationMs: h["x-rec-duration-ms"], seriesStartMs: h["x-rec-series-start-ms"] };
    ctxOf.set(req, { upload: r, s, p, release: rel });
    if (!(await uploaderActive(app, e))) {
      svc.tokens.remove(e);
      gate.forget(key);
      return deny(req, reply);
    }
    const pre = await svc.precheck(r, Number(req.headers["content-length"] ?? 0));
    return pre ? send(req, reply, pre) : undefined;
  });

  app.put("/:rid/series/:s/parts/:p", { bodyLimit: REC_PART_MAX_BYTES }, async (req, reply) => {
    const c = ctxOf.get(req);
    if (!c?.upload) return deny(req, reply);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError("VALIDATION", { message: "Gövde video/webm olmalı." });
    return send(req, reply, await svc.acceptPart(c.upload, body));
  });

  // HEAD açılmaz; Range yok, Content-Disposition yok (K-P28e-5).
  app.get("/:rid/series/:s/parts/:p", { exposeHeadRoute: false }, async (req, reply) => {
    const c = ctxOf.get(req);
    if (!c?.view) return deny(req, reply);
    const e = c.view;
    const out = await views.serve(e, c.s, c.p, async () => {
      const auth = await resolveSessionById(app.db, e.authSessionId, new Date(), { setupEnforced: app.mfaSetupEnforced });
      if (!auth || auth.user.id !== e.userId) return "logout";
      if (!canView(auth)) return "revoked";
      const s = await sessionInScope(app.db, auth, e.sessionId);
      return s?.tenantId === e.tenantId ? "ok" : "revoked";
    });
    if (out.kind === "notFound") return deny(req, reply);
    if (out.kind === "throttled") {
      app.metrics.inc(REC_METRICS.VIEW_THROTTLED_TOTAL);
      throw new AppError("RATE_LIMITED", { retryAfterSec: out.retryAfterSec });
    }
    void reply.headers({ ...REC_PART_CONTENT_HEADERS, "Content-Length": String(out.body.length) });
    return reply.send(out.body);
  });
}

/** S-P28e-6: her PUT kullanıcı + `auth_session` etkinliği yeniden (çıkış/pasifleştirme sonrası 404). */
async function uploaderActive(app: FastifyInstance, e: RecUploadTokenEntry): Promise<boolean> {
  const auth = await resolveSessionById(app.db, e.authSessionId, new Date(), { setupEnforced: app.mfaSetupEnforced });
  return auth !== null && auth.user.id === e.userId && (auth.tenantId === e.tenantId || auth.user.role === "SUPER_ADMIN");
}

/** Meta yanıtı (§5): bölümler + parça dizini, kip/gerekçe (AC-450). */
export async function recordingView(
  db: Db,
  rec: repo.RecRow,
  s: { consentMode: string | null; silentReason: string | null; anonymizedAt: Date | null },
  canDelete: boolean,
): Promise<RecordingView> {
  const parts = await repo.listParts(db, rec.id, rec.tenantId);
  const series: RecordingSeriesItem[] = [];
  for (const p of parts) {
    let cur = series.at(-1);
    if (cur?.s !== p.seriesNo) {
      cur = { s: p.seriesNo, offsetMs: p.offsetMs, parts: [] };
      series.push(cur);
    }
    cur.parts.push({ p: p.partNo, offsetMs: p.offsetMs, durationMs: p.durationMs });
  }
  const state = rec.state === "ACTIVE" ? "active" : "stopped";
  return {
    id: rec.id,
    state,
    basis: recFromDb(rec.basis) as RecordingView["basis"],
    ...(rec.stopReason ? { stopReason: recFromDb(rec.stopReason) as NonNullable<RecordingView["stopReason"]> } : {}),
    startedAt: rec.startedAt.toISOString(),
    ...(rec.stoppedAt ? { stoppedAt: rec.stoppedAt.toISOString() } : {}),
    durationMs: rec.durationMs,
    sizeBytes: Number(rec.sizeBytes),
    expiresAt: rec.expiresAt.toISOString(),
    ...(s.consentMode ? { consentMode: s.consentMode as ConsentMode } : {}),
    ...(s.consentMode === "silent" && s.silentReason && s.anonymizedAt === null ? { silentReason: s.silentReason } : {}),
    series,
    canDelete: canDelete && state === "stopped",
  };
}

/** Geçmiş uçları (prefix `/api/v1/sessions`): çerez + Origin + CSRF (requireAuth). */
export async function recordingSessionRoutes(app: FastifyInstance): Promise<void> {
  const limit = new FixedWindowCounter(REC_VIEW_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => limit.close());
  app.addHook("preHandler", requireAuth);
  const view = { preHandler: [requirePerm("session_history.view"), requirePerm("sessions.view_recording")] };

  const load = async (req: FastifyRequest) => {
    const { id } = parseInput(recordingParamsSchema, req.params);
    const s = await sessionInScope(app.db, authOf(req), id);
    const rec = s ? await repo.findBySession(app.db, s.tenantId, s.id) : null;
    if (!s || !rec) throw new AppError("NOT_FOUND");
    return { s, rec };
  };

  app.get("/:id/recording", view, async (req, reply): Promise<RecordingView> => {
    const { s, rec } = await load(req);
    if (rec.state === "DELETED") throw new AppError("NOT_FOUND");
    void reply.header("Cache-Control", "no-store");
    return recordingView(app.db, rec, s, authOf(req).permissions.has("session_history.edit"));
  });

  app.post("/:id/recording/view", view, async (req, reply): Promise<RecordingViewResponse> => {
    parseInput(recordingViewInputSchema, req.body ?? {});
    const auth = authOf(req);
    const wait = limit.blockedFor(auth.user.id);
    if (wait > 0 || limit.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    const { rec } = await load(req);
    if (rec.state === "DELETED") throw new AppError("NOT_FOUND");
    void reply.header("Cache-Control", "no-store");
    return app.rec.views.open(rec, {
      userId: auth.user.id,
      username: auth.user.email,
      authSessionId: auth.sessionId,
      ctx: auditContext(req),
    });
  });

  app.delete("/:id/recording", { preHandler: requirePerm("session_history.edit") }, async (req, reply) => {
    parseInput(deleteRecordingInputSchema, req.body);
    const auth = authOf(req);
    const { rec } = await load(req);
    const actor = { kind: "user" as const, userId: auth.user.id, username: auth.user.email, ctx: auditContext(req) };
    if (await deleteRecording(app.rec.service, rec.tenantId, rec.id, actor)) await app.rec.views.dropRecording(rec.id);
    return reply.code(204).send();
  });
}
