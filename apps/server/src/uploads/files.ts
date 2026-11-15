// P12 dosya sunumu ve public marka ucu (prefix /api/v1; AC-81, 82, 84, T16).
//  - GET /files/logo/:tenantId/:file, /files/system-logo/:file → herkese açık (login, müşteri sayfası, e-posta):
//    CORP cross-origin (e-posta istemcileri yükler), kısa public önbellek + ETag.
//  - GET /files/avatar/:tenantId/:file → oturumlu; görüntüleyenin tenant'ı değilse 404 (Super Admin hepsi),
//    `private, no-cache` + ETag (her kullanımda yeniden doğrulama).
// Parametreler sıkı regex; dosya yalnız DB'de o anda kayıtlı yolsa sunulur (eski/başka türden dosya 404). Content-Type
// sunucudan, nosniff, inline, CSP default-src 'none'.
import { createHash } from "node:crypto";
import { SYSTEM_PREFIX, publicBrandingQuerySchema, type PublicBrandingResponse } from "@remote/contracts/api/branding";
import { tenantSlugSchema } from "@remote/contracts/api/tenants";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authOf, requireAuth } from "../auth/guards.ts";
import { AppError } from "../lib/errors.ts";
import { ipKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { techAvatarQuerySchema } from "@remote/contracts/api/sessions";
import { isFileName, isPrefix, isRelPath, type UploadStore } from "./store.ts";
import { verifyTechAvatarSig } from "./tech-avatar.ts";
import { canViewAvatar, effectiveLogoUrl, systemLogoPath, systemLogoUrl } from "./urls.ts";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
/** Public marka ucu: 60/dk/IP (61. → 429, 1 dk). */
const BRANDING_PER_MIN = 60;

function relOf(req: FastifyRequest, ext: string): string {
  const p = req.params as { tenantId?: string; file?: string };
  const prefix = p.tenantId ?? SYSTEM_PREFIX;
  const file = p.file ?? "";
  if (!isPrefix(prefix) || !isFileName(file) || !file.endsWith(`.${ext}`)) throw new AppError("NOT_FOUND");
  return `${prefix}/${file}`;
}

async function sendFile(
  store: UploadStore,
  req: FastifyRequest,
  reply: FastifyReply,
  rel: string,
  visibility: "public" | "private" | "signed",
): Promise<FastifyReply> {
  if (visibility === "signed") {
    // P15 (AC-236): imzalı tek seferlik URL — saklanmaz, ETag/304 yok (her istek imza + oturum durumu denetimi).
    const data = await store.read(rel);
    if (!data) throw new AppError("NOT_FOUND");
    const ext = rel.slice(rel.lastIndexOf(".") + 1);
    return reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox")
      .header("Content-Type", MIME[ext] ?? "application/octet-stream")
      .header("Content-Disposition", "inline")
      .send(data);
  }
  const etag = `"${createHash("sha256").update(rel).digest("base64url").slice(0, 27)}"`; // ad rastgele ve değişmez → içerik de
  // Avatar (B-P12-4): tarayıcı saklayabilir ama her kullanımda ETag ile yeniden doğrular → yetki/oturum/kaldırma
  // her seferinde sunucuda denetlenir (çıkış sonrası paylaşımlı bilgisayarda önbellekten gösterilmez).
  void reply.header("Cache-Control", visibility === "public" ? "public, max-age=300" : "private, no-cache");
  void reply.header("ETag", etag);
  void reply.header("X-Content-Type-Options", "nosniff");
  void reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  if (visibility === "public") void reply.header("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.headers["if-none-match"] === etag) return reply.status(304).send();
  const data = await store.read(rel);
  if (!data) throw new AppError("NOT_FOUND");
  const ext = rel.slice(rel.lastIndexOf(".") + 1);
  void reply.header("Content-Type", MIME[ext] ?? "application/octet-stream");
  void reply.header("Content-Disposition", "inline");
  return reply.send(data);
}

export async function fileRoutes(app: FastifyInstance, opts: { store: UploadStore }): Promise<void> {
  const { store } = opts;

  app.get("/files/logo/:tenantId/:file", async (req, reply) => {
    const rel = relOf(req, "png");
    const t = await app.db.tenant.findFirst({ where: { id: rel.split("/")[0] ?? "", deletedAt: null }, select: { logoPath: true } });
    if (t?.logoPath !== rel) throw new AppError("NOT_FOUND");
    return sendFile(store, req, reply, rel, "public");
  });

  app.get("/files/system-logo/:file", async (req, reply) => {
    const rel = relOf(req, "png");
    if ((await systemLogoPath(app.db)) !== rel) throw new AppError("NOT_FOUND");
    return sendFile(store, req, reply, rel, "public");
  });

  // P15 (AC-236): müşteri ekranı teknisyen avatarı — kimliksiz, imzalı (≤ 10 dk) + oturum PENDING(süresi dolmamış)/ACTIVE.
  // Geçersiz imza/süre veya bitmiş oturum → 403 (tek gövde); avatar yok/kaldırıldı → 404. 60/dk/IP.
  const avatarLimit = new FixedWindowCounter(BRANDING_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => avatarLimit.close());
  app.get("/public/sessions/:sessionId/tech-avatar", async (req, reply) => {
    const key = ipKey(req.ip);
    const wait = avatarLimit.blockedFor(key);
    if (wait > 0 || avatarLimit.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    const sessionId = (req.params as { sessionId?: string }).sessionId ?? "";
    const q = techAvatarQuerySchema.safeParse(req.query);
    const now = Date.now();
    if (
      !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(sessionId) ||
      !q.success ||
      !verifyTechAvatarSig(app.secrets, sessionId, q.data.exp, q.data.sig, now)
    )
      throw new AppError("FORBIDDEN");
    const s = await app.db.supportSession.findUnique({
      where: { id: sessionId },
      select: { status: true, expiresAt: true, technician: { select: { avatarPath: true, deletedAt: true } } },
    });
    const live = s && (s.status === "ACTIVE" || (s.status === "PENDING" && s.expiresAt.getTime() > now));
    if (!s || !live) throw new AppError("FORBIDDEN");
    const rel = s.technician.deletedAt === null ? s.technician.avatarPath : null;
    if (!rel || !isRelPath(rel)) throw new AppError("NOT_FOUND");
    return sendFile(store, req, reply, rel, "signed");
  });

  // Şifre değişimi / 2FA kurulumu bekleyen oturum da kendi üst menüsünü gösterebilir (veri sızıntısı yok).
  app.get(
    "/files/avatar/:tenantId/:file",
    { config: { allowPasswordChangePending: true, mfaSetupStage: true }, preHandler: requireAuth },
    async (req, reply) => {
      const rel = relOf(req, "webp");
      const auth = authOf(req);
      if (!canViewAvatar({ role: auth.user.role, tenantId: auth.user.tenantId }, rel.split("/")[0] ?? "")) throw new AppError("NOT_FOUND");
      const owner = await app.db.user.findFirst({ where: { avatarPath: rel, deletedAt: null }, select: { id: true } });
      if (!owner) throw new AppError("NOT_FOUND");
      return sendFile(store, req, reply, rel, "private");
    },
  );
}

/** GET /public/branding?tenant=<slug> — login/karşılama logosu (AC-82). Bilinmeyen/pasif slug → aynı biçimde sistem logosu. */
export async function publicBrandingRoutes(app: FastifyInstance): Promise<void> {
  const limit = new FixedWindowCounter(BRANDING_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => limit.close());
  app.get("/branding", async (req, reply): Promise<PublicBrandingResponse> => {
    const key = ipKey(req.ip);
    const wait = limit.blockedFor(key);
    if (wait > 0 || limit.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    void reply.header("Cache-Control", "no-store");
    const q = publicBrandingQuerySchema.safeParse(req.query);
    const slug = q.success && q.data.tenant ? tenantSlugSchema.safeParse(q.data.tenant) : null;
    const t = slug?.success
      ? await app.db.tenant.findFirst({
          where: { slug: slug.data, status: "ACTIVE", deletedAt: null },
          select: { name: true, logoPath: true },
        })
      : null;
    if (!t) return { name: null, logoUrl: await systemLogoUrl(app.db) };
    return { name: t.name, logoUrl: await effectiveLogoUrl(app.db, t.logoPath) };
  });
}
