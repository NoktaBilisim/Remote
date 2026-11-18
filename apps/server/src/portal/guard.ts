// P21 portal guard'ı (ADR-0039, mimari-p21 §2, §5.1). Panel `requireAuth`'tan TAMAMEN ayrı: yalnız `PORTAL_SESSION_COOKIE`
// okunur, CSRF başlığı `PORTAL_CSRF_COOKIE` ile karşılaştırılır (panel `__Host-rs_csrf` kabul edilmez — çapraz kabul yok).
// Uç sırası: bodyLimit → requirePortal (çerez → oturum → CSRF → şifre kapısı) → zod → servis (`portalScope`).
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE } from "@remote/contracts/api/portal";
import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import { checkOrigin } from "../auth/guards.ts";
import { AppError } from "../lib/errors.ts";
import { safeEqual } from "../lib/ids.ts";
import type { PortalScope } from "./repo.ts";
import { resolvePortalSession, type PortalContext } from "./session.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** P21: portal oturumu (yalnız `/api/v1/portal/*` uçlarında `requirePortal` doldurur). */
    portal: PortalContext | null;
  }
}

const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const baseCookie: CookieSerializeOptions = { path: "/", secure: true, sameSite: "strict" };

export function setPortalCookies(reply: FastifyReply, s: { token: string; csrfToken: string; expiresAt: Date }): void {
  void reply.setCookie(PORTAL_SESSION_COOKIE, s.token, { ...baseCookie, httpOnly: true, expires: s.expiresAt });
  void reply.setCookie(PORTAL_CSRF_COOKIE, s.csrfToken, { ...baseCookie, httpOnly: false, expires: s.expiresAt });
}

export function clearPortalCookies(reply: FastifyReply): void {
  void reply.clearCookie(PORTAL_SESSION_COOKIE, { ...baseCookie, httpOnly: true });
  void reply.clearCookie(PORTAL_CSRF_COOKIE, { ...baseCookie, httpOnly: false });
}

function checkPortalCsrf(req: FastifyRequest): void {
  checkOrigin(req);
  const header = req.headers[CSRF_HEADER];
  const cookie = req.cookies[PORTAL_CSRF_COOKIE];
  if (typeof header !== "string" || !cookie || !safeEqual(header, cookie)) throw new AppError("CSRF_INVALID");
}

/**
 * Oturum doğrulaması + (POST/PUT/PATCH/DELETE) CSRF double-submit + ilk giriş şifre değişimi kapısı.
 * Geçersiz oturumda (K-P21-12 dahil) 401 ve portal çerezleri temizlenir. `config.allowPasswordChangePending` yalnız
 * `/portal/me` (GET), `/portal/auth/logout`, `/portal/account/password`'te true.
 */
export async function requirePortal(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[PORTAL_SESSION_COOKIE];
  const ctx = token ? await resolvePortalSession(req.server.db, token, new Date()) : null;
  if (!ctx) {
    if (token) clearPortalCookies(reply);
    throw new AppError("UNAUTHENTICATED");
  }
  if (UNSAFE_METHODS.has(req.method)) checkPortalCsrf(req);
  if (ctx.user.mustChangePassword && !req.routeOptions.config.allowPasswordChangePending)
    throw new AppError("PASSWORD_CHANGE_REQUIRED");
  req.portal = ctx;
}

export function portalOf(req: FastifyRequest): PortalContext {
  if (!req.portal) throw new Error("requirePortal bu uçta tanımlı değil");
  return req.portal;
}

/** §5.3: kapsam YALNIZ oturumdan (`portal_users.customer_id` — her istekte DB'den okunan satır). */
export function portalScope(req: FastifyRequest): PortalScope {
  return portalOf(req).scope;
}
