// P29 public güncelleme uçları (`/api/v1/public/agent` öneki; mimari-p29 §4.2, §4.4, §4.5 r2; AC-473, 487–489, 492, 493).
// Çerezsiz, kimliksiz (ADR-0012 AGENT kuralı: Origin / Sec-Fetch-* yok). `MIN_AGENT_VERSION` UYGULANMAZ (K-P29-19). Yanıtlar
// `no-store` + `nosniff`. 400 yanıtları değer ve anahtar adı YANSITMAZ (r2 T-12: yalnız yol → sabit metin). `ref`, belirteç,
// `bindingKeys` loglanmaz (logger: sorgu dizesi kırpılır, `authorization` ve `*.bindingKeys` redakte; gövde loglanmaz).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  UPDATE_B64URL_32_PATTERN,
  UPDATE_EVENTS_BODY_MAX,
  UPDATE_LIMITS,
  updateCheckQuerySchema,
  updateEventsInputSchema,
  type UpdateEventsInput,
  type UpdateOffer,
} from "@remote/contracts/api/update";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { auditContext } from "../audit/service.ts";
import { checkPublicClient } from "../auth/guards.ts";
import { resolveUsable } from "../bindings/service.ts";
import { AppError } from "../lib/errors.ts";
import { ipKey } from "../lib/ip.ts";
import { auditBindingEvent, countEvent, countRateLimited, takeBudget } from "./events.ts";

const INVALID = "Geçersiz değer";

/** Değer/anahtar adı yansıtmayan doğrulama (T-12): alan yolu → sabit metin. */
export function parseQuiet<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) fields[issue.path.map(String).join(".") || "_"] = INVALID;
  throw new AppError("VALIDATION", { fields });
}

function headers(reply: FastifyReply): void {
  void reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
}

function rateLimited(retryAfterSec: number): AppError {
  return new AppError("RATE_LIMITED", { retryAfterSec });
}

export async function publicUpdateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onSend", async (_req, reply) => headers(reply));
  const u = app.updates;

  // §4.2: denetim. Sınır IP 60/sa (her istek; biçim hatası dahil). `ref` şemadan önce ayrılır: dizi/desen dışı → `auto`.
  app.get("/update", async (req, reply): Promise<UpdateOffer | FastifyReply> => {
    checkPublicClient(req, "AGENT");
    const ip = ipKey(req.ip);
    if (!takeBudget(u.limits.checkIp, ip, UPDATE_LIMITS.checkPerHourIp)) throw rateLimited(3600);
    const { ref, ...rest } = (req.query ?? {}) as Record<string, unknown>;
    const q = parseQuiet(updateCheckQuerySchema, rest);
    const offer = await u.clientOffer(q.platform, typeof ref === "string" ? ref : undefined);
    u.metrics.inc("rs_agent_update_check_total", { platform: q.platform, component: "client", result: offer ? "offer" : "none" });
    if (!offer) return reply.code(204).send();
    return offer;
  });

  // §4.4 r2: servis dosyası. Yalnız `Authorization: Bearer`; sorgu dizesi → 404. Sıra: biçim → IP 20/dk → global 8 akış (503 +
  // Retry-After; belirteç TÜKETİLMEZ, servis bekleyip aynı belirteçle yeniden dener) → tek kullanımlık belirteç (404) → ikili
  // kapısı + beklenen SHA = belirteçteki SHA (503 NOT_READY; belirteç tüketilmiştir).
  // HEAD yok: tek kullanımlık belirteci gövdesiz tüketmesin.
  app.get("/update/service-file", { exposeHeadRoute: false }, async (req, reply) => serviceFile(app, req, reply));

  // §4.5: olaylar — her durumda 204 (anahtar oracle'ı yok); biçim 400; IP kovaları 429.
  app.post("/update-events", { bodyLimit: UPDATE_EVENTS_BODY_MAX }, async (req, reply) => {
    checkPublicClient(req, "AGENT");
    const ip = ipKey(req.ip);
    if (!takeBudget(u.limits.eventsReqIp, ip, UPDATE_LIMITS.eventsRequestsPerHourIp)) throw rateLimited(3600);
    const input = parseQuiet(updateEventsInputSchema, req.body);
    await recordPublicEvents(app, req, ip, input);
    return reply.code(204).send();
  });
}

async function serviceFile(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const u = app.updates;
  const count = (result: string) => u.metrics.inc("rs_agent_update_download_total", { component: "service", result });
  checkPublicClient(req, "AGENT");
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (req.url.includes("?") || !UPDATE_B64URL_32_PATTERN.test(token)) {
    count("not_found");
    throw new AppError("NOT_FOUND");
  }
  if (!takeBudget(u.limits.serviceFileIp, ipKey(req.ip), UPDATE_LIMITS.serviceFilePerMinIp)) {
    count("rate_limited");
    throw rateLimited(60);
  }
  const release = u.tokens.acquireStream();
  if (!release) {
    count("busy");
    throw new AppError("NOT_READY", { retryAfterSec: UPDATE_LIMITS.serviceFileRetryAfterSec });
  }
  try {
    const entry = u.tokens.take(token);
    if (!entry) {
      count("not_found");
      throw new AppError("NOT_FOUND");
    }
    const path = app.env.UNATTENDED_AGENT_PATH;
    if (!path || (await app.unattendedBinary.check()) !== "ok" || app.env.UNATTENDED_AGENT_SHA256 !== entry.sha256) {
      count("not_ready");
      throw new AppError("NOT_READY", { message: "Servis programı şu an indirilemiyor." });
    }
    const size = (await stat(path)).size;
    const stream = createReadStream(path);
    reply.raw.once("close", release);
    stream.once("error", release);
    count("ok");
    return reply.header("Content-Type", "application/octet-stream").header("Content-Length", String(size)).send(stream);
  } catch (err) {
    release();
    throw err;
  }
}

/** §4.5–4.7: IP olay bütçesi (30/sa) → kimlik çözümü (≤ 5, `last_used_at` değişmez) → metrik + kimlik başına (10/sa) audit. */
async function recordPublicEvents(app: FastifyInstance, req: FastifyRequest, ip: string, input: UpdateEventsInput): Promise<void> {
  const u = app.updates;
  const allowed = input.events.filter(() => takeBudget(u.limits.eventsIp, ip, UPDATE_LIMITS.eventsPerHourIp));
  const resolved = new Map<string, { bindingId: string; tenantId: string; keyHash: string }>();
  for (const key of new Set(input.bindingKeys ?? [])) {
    const b = await resolveUsable(app.requests, key);
    if (b) resolved.set(b.row.id, { bindingId: b.row.id, tenantId: b.row.tenantId, keyHash: b.keyHash });
  }
  const l = {
    platform: input.platform,
    component: input.component,
    source: resolved.size > 0 ? ("binding" as const) : ("anonymous" as const),
  };
  countRateLimited(u.metrics, l, input.events.length - allowed.length);
  if (allowed.length === 0) throw rateLimited(3600);
  const ctx = auditContext(req);
  for (const e of allowed) {
    countEvent(u.metrics, l, e);
    for (const b of resolved.values()) {
      // r2 T-5: kimlik aşımı sessiz (204; 429 geçerli anahtarı geçersizden ayırt ettirirdi) — yalnız metrik.
      if (!takeBudget(u.limits.eventsIdentity, b.keyHash, UPDATE_LIMITS.eventsPerHourIdentity)) countRateLimited(u.metrics, l);
      else await auditBindingEvent(app.db, ctx, b, e, l);
    }
  }
}
