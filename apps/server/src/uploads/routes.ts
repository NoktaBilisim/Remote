// P12 yükleme uçları (prefix /api/v1). multipart ayrıştırıcısı YALNIZ bu eklenti bağlamında kayıtlı: diğer uçlar
// multipart gövdeyi 415 → 400 ile reddeder. Sıra: requireAuth (CSRF) → yetki/kapsam → hedef (404/403) → hız sınırı →
// gövde okuma (2 MB) → servis. Gövde hedef/yetki doğrulanmadan okunmaz.
import multipart from "@fastify/multipart";
import {
  UPLOAD_MAX_BYTES,
  UPLOADS_PER_HOUR,
  type AvatarResponse,
  type LogoResponse,
  type SystemLogoResponse,
} from "@remote/contracts/api/branding";
import { userIdSchema } from "@remote/contracts/api/users";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, requireSuperAdmin, tenantScope } from "../auth/guards.ts";
import { AppError } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { manageableUser } from "../users/service.ts";
import { readUpload } from "./multipart.ts";
import {
  removeAvatar,
  removeSystemLogo,
  removeTenantLogo,
  uploadAvatar,
  uploadSystemLogo,
  uploadTenantLogo,
  type AvatarTarget,
  type BrandingDeps,
} from "./service.ts";

export async function uploadRoutes(app: FastifyInstance, opts: { deps: BrandingDeps }): Promise<void> {
  await app.register(multipart, { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 1 }, throwFileSizeLimit: true });
  const d = opts.deps;
  const limit = new FixedWindowCounter(UPLOADS_PER_HOUR + 1, 3_600_000, 3_600_000);
  app.addHook("onClose", async () => limit.close());
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });

  /** Kullanıcı başına 20/sa (tüm yükleme uçları ortak). */
  const consume = (req: FastifyRequest): void => {
    const key = authOf(req).user.id;
    const wait = limit.blockedFor(key);
    if (wait > 0 || limit.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 3600 });
  };
  const read = (req: FastifyRequest) => () => readUpload(req);

  // --- firma logosu (settings.edit; Super Admin seçili firmayla) ---
  const editSettings = { preHandler: requirePerm("settings.edit") };
  app.post("/settings/logo", editSettings, async (req): Promise<LogoResponse> => {
    const { tenantId } = tenantScope(req);
    consume(req);
    return uploadTenantLogo(d, auditContext(req), authOf(req), tenantId, read(req));
  });
  app.delete("/settings/logo", editSettings, async (req): Promise<LogoResponse> =>
    removeTenantLogo(d, auditContext(req), authOf(req), tenantScope(req).tenantId),
  );

  // --- avatar: `me`/kendi id'si serbest; başkası users.edit + kapsam + canManage ---
  const target = async (req: FastifyRequest): Promise<AvatarTarget> => {
    const auth = authOf(req);
    const raw = (req.params as { id?: string }).id;
    if (raw === "me" || raw === auth.user.id) return { id: auth.user.id, tenantId: auth.user.tenantId };
    const id = userIdSchema.safeParse(raw);
    if (!id.success) throw new AppError("NOT_FOUND");
    if (!auth.permissions.has("users.edit")) throw new AppError("FORBIDDEN");
    return manageableUser(app.db, auth, tenantScope(req).tenantId, id.data);
  };
  app.post("/users/:id/avatar", async (req): Promise<AvatarResponse> => {
    const t = await target(req);
    consume(req);
    return uploadAvatar(d, auditContext(req), authOf(req), t, read(req));
  });
  app.delete("/users/:id/avatar", async (req): Promise<AvatarResponse> =>
    removeAvatar(d, auditContext(req), authOf(req), await target(req)),
  );

  // --- sistem logosu (SUPER_ADMIN) ---
  app.post("/admin/settings/system-logo", { preHandler: requireSuperAdmin }, async (req): Promise<SystemLogoResponse> => {
    consume(req);
    return uploadSystemLogo(d, auditContext(req), authOf(req), read(req));
  });
  // P15 (AC-233): kaldırma → varsayılan Nokta logosu.
  app.delete("/admin/settings/system-logo", { preHandler: requireSuperAdmin }, async (req): Promise<SystemLogoResponse> =>
    removeSystemLogo(d, auditContext(req), authOf(req)),
  );
}
