// P15 (AC-232): /api/v1/admin/superadmins — Super Admin'in başka bir Super Admin'in şifresini panelden sıfırlaması.
// Sıra: requireAuth → requireSuperAdmin → (yazmada) hız sınırı → step-up (AC-215) → id → kendi id'si 403 → servis
// (P13b `resetSuperadminById` çekirdeği; kopya yok) → commit sonrası canlı odalar + panel soketleri biter.
import {
  SUPERADMIN_LIST_MAX,
  superadminResetInputSchema,
  userIdSchema,
  type SuperadminListResponse,
  type SuperadminResetResponse,
} from "@remote/contracts/api/users";
import type { FastifyInstance } from "fastify";
import { auditContext } from "../audit/service.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { authOf, requireAuth, requireStepUp, requireSuperAdmin } from "./guards.ts";
import { resetSuperadminById } from "./superadmin-reset.ts";

/** Panel sıfırlama: kullanıcı başına dakikada 5 (geçici parola üretimi + argon2). */
export const SUPERADMIN_RESETS_PER_MIN = 5;

export async function superadminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireSuperAdmin);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const limit = new FixedWindowCounter(SUPERADMIN_RESETS_PER_MIN + 1, 60_000, 60_000);
  app.addHook("onClose", async () => limit.close());

  app.get("", async (req): Promise<SuperadminListResponse> => {
    const me = authOf(req).user.id;
    const rows = await app.db.user.findMany({
      where: { role: "SUPER_ADMIN", deletedAt: null },
      select: { id: true, fullName: true, email: true, status: true, totpEnabled: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: SUPERADMIN_LIST_MAX,
    });
    return { items: rows.map((r) => ({ ...r, status: r.status as "ACTIVE" | "PASSIVE", self: r.id === me })) };
  });

  app.post(
    "/:id/reset-password",
    {
      preHandler: [
        async (req) => {
          const key = authOf(req).user.id;
          const wait = limit.blockedFor(key);
          if (wait > 0 || limit.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: limit.blockedFor(key) || 60 });
        },
        requireStepUp(),
      ],
    },
    async (req): Promise<SuperadminResetResponse> => {
      const id = userIdSchema.safeParse((req.params as { id?: string }).id);
      if (!id.success) throw new AppError("NOT_FOUND");
      const auth = authOf(req);
      if (id.data === auth.user.id)
        throw new AppError("FORBIDDEN", { message: "Kendi şifrenizi bu yolla sıfırlayamazsınız; şifre değiştirme ekranını kullanın." });
      parseInput(superadminResetInputSchema, req.body ?? {});
      const r = await resetSuperadminById(
        app.db,
        auditContext(req),
        { userId: auth.user.id, username: auth.user.email, via: "panel" },
        id.data,
        false,
      );
      if (r.kind === "not_found") throw new AppError("NOT_FOUND");
      try {
        await app.account.endLive(id.data);
      } catch (err) {
        req.log.error({ err, alarm: "user_live_effect" }, "şifre sıfırlama canlı oturuma yansıtılamadı");
      }
      return { temporaryPassword: r.tempPassword, revokedSessions: r.revokedSessions };
    },
  );
}
