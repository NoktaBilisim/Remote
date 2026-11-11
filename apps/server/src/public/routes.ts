// /api/v1/public/agent — çerezsiz, kimliksiz, Origin istemez (GET, durum değiştirmez; ADR-0012 madde 4).
// /internal/agent-ready — Caddy forward_auth iç ucu (S6-2); /api dışında, dışarıya kapalı.
import { sessionStatusQuerySchema } from "@remote/contracts/api/sessions";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { AppError } from "../lib/errors.ts";
import { cidrMatcher } from "../lib/ip.ts";
import { agentDownload, assertAgentReady } from "./agent.ts";

export async function publicAgentRoutes(app: FastifyInstance): Promise<void> {
  // AC-27: 302 → sabit konum (dosya adı kodu taşır). Hata yanıtları da önbelleğe alınmaz.
  app.get("/download", async (req, reply) => {
    void reply.header("Cache-Control", "no-store");
    const parsed = sessionStatusQuerySchema.safeParse(req.query); // aynı opak sessionRef biçimi
    const deps = { db: app.db, limits: app.publicLimits, refKey: app.sessionRefKey, binary: app.agentBinary };
    const location = await agentDownload(deps, auditContext(req), parsed.success ? parsed.data.ref : null);
    return reply.redirect(location, 302);
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
  app.get("/agent-ready", async (req, reply) => {
    void reply.header("Cache-Control", "no-store");
    if (!fromEdge(req)) throw new AppError("NOT_FOUND");
    await assertAgentReady(app.agentBinary);
    return reply.code(204).send();
  });
}
