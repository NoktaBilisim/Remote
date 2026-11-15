// P27a profil uçları (mimari-p27a §4.2; AC-329): GET/DELETE /api/v1/auth/trusted-devices[/:id]. Yalnız kendi cihazları
// (`user_id = oturum kullanıcısı`; başkasının id'si 404, T8). Tam oturum (`requireAuth`; DELETE'te CSRF). Belirteç ve
// özeti hiçbir yanıtta yok (AC-333). Super Admin'de satır olamaz → boş liste.
import { trustedDeviceParamsSchema, type TrustedDeviceListResponse, type TrustedDeviceRevokeResponse } from "@remote/contracts/api/auth";
import { AUTH_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { authOf, requireAuth } from "./guards.ts";
import type { AuthContext } from "./session.ts";
import { deleteForUser, listForUser } from "./trusted-device-repo.ts";
import { clearTrustedDeviceCookie, currentTrustedDeviceId, readTrustedDeviceCookies } from "./trusted-device.ts";

const noStore = (reply: FastifyReply) => void reply.header("Cache-Control", "no-store");
const cookiesOf = (req: FastifyRequest) => readTrustedDeviceCookies(req.headers.cookie);

async function listOwn(db: Db, auth: AuthContext, cookies: readonly string[]): Promise<TrustedDeviceListResponse> {
  const now = new Date();
  const [rows, current] = await Promise.all([listForUser(db, auth.user.id, now), currentTrustedDeviceId(db, auth.user, cookies, now)]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      uaSummary: r.uaSummary,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      current: r.id === current,
    })),
  };
}

/** Tek (`id`) ya da tümü; aynı TX'te silme + audit `revoked {reason:"user", count}`. Tekilde 0 satır → 404. */
async function revokeOwn(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  cookies: readonly string[],
  id?: string,
): Promise<TrustedDeviceRevokeResponse> {
  const current = await currentTrustedDeviceId(db, auth.user, cookies);
  const revoked = await db.$transaction(async (tx) => {
    const count = await deleteForUser(tx, auth.user.id, id);
    if (id !== undefined && count === 0) throw new AppError("NOT_FOUND");
    await writeAudit(tx, ctx, {
      tenantId: auth.user.tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: AUTH_AUDIT.TRUSTED_DEVICE_REVOKED,
      entity: "users",
      entityId: auth.user.id,
      result: "success",
      newValue: { reason: "user", count },
    });
    return count;
  });
  const currentCleared = current !== null && (id === undefined || id === current);
  return { revoked, currentCleared };
}

export function trustedDeviceRoutes(app: FastifyInstance): void {
  app.get("/trusted-devices", { preHandler: requireAuth }, async (req, reply): Promise<TrustedDeviceListResponse> => {
    noStore(reply);
    return listOwn(app.db, authOf(req), cookiesOf(req));
  });

  app.delete("/trusted-devices/:id", { preHandler: requireAuth }, async (req, reply): Promise<TrustedDeviceRevokeResponse> => {
    const { id } = parseInput(trustedDeviceParamsSchema, req.params);
    const out = await revokeOwn(app.db, auditContext(req), authOf(req), cookiesOf(req), id);
    if (out.currentCleared) clearTrustedDeviceCookie(reply);
    noStore(reply);
    return out;
  });

  app.delete("/trusted-devices", { preHandler: requireAuth }, async (req, reply): Promise<TrustedDeviceRevokeResponse> => {
    const out = await revokeOwn(app.db, auditContext(req), authOf(req), cookiesOf(req));
    if (out.currentCleared) clearTrustedDeviceCookie(reply);
    noStore(reply);
    return out;
  });
}
