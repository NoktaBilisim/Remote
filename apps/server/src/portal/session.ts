// P21 portal oturumu (ADR-0039, mimari-p21 §5.1; panel ADR-0008 kalıbı): opak 32 bayt token çerezde, DB'de yalnız SHA-256
// (`portal_sessions.token_hash`); mutlak 8 sa, boşta 30 dk, `last_seen_at` 60 sn'de bir. Hash YALNIZ `portal_sessions`'ta
// aranır (K-P21-1) — panel token'ı burada, portal token'ı panelde yapısal olarak çözülemez.
// K-P21-12: hesap ACTIVE, müşteri ACTIVE ve anonim değil, firma ACTIVE ve silinmemiş — her istekte.
import type { Theme } from "@remote/contracts/api/auth";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { findPortalSessionByHash, touchPortalSession, type PortalScope, type PortalUserRow } from "./repo.ts";

const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface PortalContext {
  sessionId: string;
  /** Mutlak bitiş; şifre değişiminde yenilenen oturum bu süreyi uzatmaz. */
  expiresAt: Date;
  scope: PortalScope;
  user: { id: string; email: string; fullName: string; theme: Theme; mustChangePassword: boolean; totpEnabled: boolean };
  customer: { name: string; fileLabel: string; requestRef: string };
  tenant: { name: string; slug: string; logoPath: string | null };
}

/** K-P21-12: hesap + müşteri + firma birlikte etkin mi (giriş ve her istek aynı kural). */
export function portalActive(u: Pick<PortalUserRow, "status" | "customer" | "tenant">): boolean {
  return (
    u.status === "ACTIVE" &&
    u.customer.status === "ACTIVE" &&
    u.customer.anonymizedAt === null &&
    u.tenant.status === "ACTIVE" &&
    u.tenant.deletedAt === null
  );
}

export function portalContextOf(u: PortalUserRow, sessionId: string, expiresAt: Date): PortalContext {
  return {
    sessionId,
    expiresAt,
    scope: { tenantId: u.tenantId, customerId: u.customerId, portalUserId: u.id },
    user: {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      theme: u.theme as Theme,
      mustChangePassword: u.mustChangePassword,
      totpEnabled: u.totpEnabled,
    },
    customer: { name: u.customer.name, fileLabel: u.customer.fileLabel, requestRef: u.customer.requestRef },
    tenant: { name: u.tenant.name, slug: u.tenant.slug, logoPath: u.tenant.logoPath },
  };
}

export interface OpenedPortalSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  sessionId: string;
}

export async function openPortalSession(
  tx: Prisma.TransactionClient,
  u: { id: string; tenantId: string },
  meta: { ip: string; userAgent: string },
  now: Date,
  expiresAt: Date = new Date(now.getTime() + SESSION_ABSOLUTE_MS),
): Promise<OpenedPortalSession> {
  const id = newId();
  const token = newSecretToken();
  await tx.portalSession.create({
    data: {
      id,
      portalUserId: u.id,
      tenantId: u.tenantId,
      tokenHash: sha256Hex(token),
      ip: meta.ip.slice(0, 45),
      userAgent: meta.userAgent.slice(0, 300),
      lastSeenAt: now,
      expiresAt,
      createdAt: now,
    },
    select: { id: true },
  });
  return { token, csrfToken: newSecretToken(), expiresAt, sessionId: id };
}

/** Geçersiz / iptal / mutlak ya da boşta süresi dolmuş / etkin olmayan hesap-müşteri-firma → null. */
export async function resolvePortalSession(db: Db, token: string, now: Date): Promise<PortalContext | null> {
  const s = await findPortalSessionByHash(db, sha256Hex(token));
  if (!s || s.revokedAt !== null || s.expiresAt <= now) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > SESSION_IDLE_MS) return null;
  if (!portalActive(s.portalUser)) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) await touchPortalSession(db, s.id, now);
  return portalContextOf(s.portalUser, s.id, s.expiresAt);
}
