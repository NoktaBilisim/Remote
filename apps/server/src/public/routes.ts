// /api/v1/public/agent — çerezsiz, kimliksiz, Origin istemez (GET, durum değiştirmez; ADR-0012 madde 4).
// /internal/agent-ready/{windows,macos} — Caddy forward_auth iç ucu (S6-2, S-P28f-3); /api dışında, dışarıya kapalı.
import {
  agentDownloadOsSchema,
  sessionStatusQuerySchema,
  type AgentAvailabilityResponse,
  type AgentDownloadOs,
} from "@remote/contracts/api/sessions";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContext } from "../audit/service.ts";
import { AppError } from "../lib/errors.ts";
import { cidrMatcher } from "../lib/ip.ts";
import type { AgentBinary } from "./agent-binary.ts";
import { agentAvailability, agentDownload, assertAgentReady } from "./agent.ts";

const osQuerySchema = z.object({ os: agentDownloadOsSchema });

export async function publicAgentRoutes(app: FastifyInstance): Promise<void> {
  const binaries = (): Record<AgentDownloadOs, AgentBinary> => ({ windows: app.agentBinary, macos: app.macAgentBinary });
  // AC-27: 302 → sabit konum (dosya adı kodu taşır). Hata yanıtları da önbelleğe alınmaz. P28f: `os` ayrı ayrıştırılır
  // (geçersiz → 400, ref kovası tüketilmez).
  app.get("/download", async (req, reply) => {
    void reply.header("Cache-Control", "no-store");
    const parsed = sessionStatusQuerySchema.safeParse(req.query); // aynı opak sessionRef biçimi
    const os = osQuerySchema.safeParse(req.query);
    const deps = { db: app.db, limits: app.publicLimits, refKey: app.sessionRefKey, binaries: binaries() };
    const out = await agentDownload(deps, auditContext(req), parsed.success ? parsed.data.ref : null, os.success ? os.data.os : null);
    app.metrics.inc("rs_agent_download_total", { os: out.os });
    return reply.redirect(out.location, 302);
  });

  // P28f (§4.1, AC-390): girdi/ref/çerez yok. Başarı 60 sn önbelleklenebilir; hata (429) önbelleğe alınmaz.
  app.get("/availability", async (req, reply): Promise<AgentAvailabilityResponse> => {
    void reply.header("Cache-Control", "no-store");
    const out = await agentAvailability(app.publicLimits, auditContext(req), binaries(), app.env.DEPLOY_ENV === "production");
    void reply.header("Cache-Control", "public, max-age=60");
    return out;
  });
}

const LOOPBACK = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/**
 * S6-2 / G-07: Caddy `/downloads/*` dosyasını sunmadan önce `forward_auth` ile bu uca sorar; 2xx değilse yanıtı
 * (503 NOT_READY) olduğu gibi istemciye döner — fail-closed asıl dağıtım yolunda da geçerli. Dışarıya kapalı:
 * Caddy yalnız /api ve /ws'i server'a yönlendirir ve /internal/*'ı ayrıca 404'ler; server da yalnız güvenilen
 * proxy adresinden (TRUSTED_PROXY_CIDR; tanımsızsa loopback) gelen, `X-Forwarded-Method` taşıyan (forward_auth)
 * GET'i kabul eder, aksi halde 404 (uç varlığı açığa çıkmaz). Soket adresi kullanılır, XFF değil.
 */
export async function internalAgentRoutes(app: FastifyInstance): Promise<void> {
  const isProxy = cidrMatcher(app.env.TRUSTED_PROXY_CIDR);
  const fromEdge = (req: FastifyRequest): boolean => {
    const peer = req.socket.remoteAddress ?? "";
    const allowedPeer = app.env.TRUSTED_PROXY_CIDR ? isProxy(peer) : LOOPBACK.test(peer);
    return allowedPeer && typeof req.headers["x-forwarded-method"] === "string";
  };
  // S-P28f-3: platform başına ayrı iç URI; her uç yalnız kendi kapısını uygular. Çıplak `/agent-ready` geçiş süresince
  // `/agent-ready/windows` takma adıdır. Bilinmeyen alt yol (ör. `/agent-ready/linux`) kayıtlı değil → 404 (varsayılan ret).
  const windowsReady = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    void reply.header("Cache-Control", "no-store");
    if (!fromEdge(req)) throw new AppError("NOT_FOUND");
    // P8b G-E9-11: firma yolu (`/downloads/NoktaDestek-<label>-<ref>.exe`) → ref aktif ve label güncel değilse 404
    // (aynı yol, oracle yok). `/downloads/Destek-*` (P6) yalnız ikili kapısı. URI/ref loglanmaz.
    const uri = req.headers["x-forwarded-uri"];
    if (typeof uri === "string" && /^\/downloads\/NoktaDestek-/i.test(uri) && !(await app.requests.firmPathValid(uri)))
      throw new AppError("NOT_FOUND");
    await assertAgentReady(app.agentBinary);
    return reply.code(204).send();
  };
  app.get("/agent-ready", windowsReady);
  app.get("/agent-ready/windows", windowsReady);
  // macOS: firma dosyası yolu yok (V52) → yalnız zip kapısı. X-Forwarded-Uri Caddy'de maskeli gelir, okunmaz.
  app.get("/agent-ready/macos", async (req, reply) => {
    void reply.header("Cache-Control", "no-store");
    if (!fromEdge(req)) throw new AppError("NOT_FOUND");
    await assertAgentReady(app.macAgentBinary);
    return reply.code(204).send();
  });
}
