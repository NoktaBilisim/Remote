// /api/v1/auth uçları (mimari-api.md "Auth"). Handler'lar yalnız doğrulama + servis çağrısı + yanıt.
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  loginInputSchema,
  passwordChangeInputSchema,
  type LoginResponse,
  type MeResponse,
} from "@remote/contracts/api/auth";
import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { parseInput } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { authOf, checkOrigin, requireAuth } from "./guards.ts";
import { changePassword, login, logout } from "./service.ts";

const baseCookie: CookieSerializeOptions = { path: "/", secure: true, sameSite: "strict" };
const pendingOk = { config: { allowPasswordChangePending: true }, preHandler: requireAuth };

function setSessionCookies(reply: FastifyReply, s: { token: string; csrfToken: string; expiresAt: Date }): void {
  void reply.setCookie(SESSION_COOKIE, s.token, { ...baseCookie, httpOnly: true, expires: s.expiresAt });
  void reply.setCookie(CSRF_COOKIE, s.csrfToken, { ...baseCookie, httpOnly: false, expires: s.expiresAt });
}

function clearSessionCookies(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { ...baseCookie, httpOnly: true });
  void reply.clearCookie(CSRF_COOKIE, { ...baseCookie, httpOnly: false });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (req, reply): Promise<LoginResponse> => {
    checkOrigin(req);
    const input = parseInput(loginInputSchema, req.body);
    const result = await login(app.db, app.authLimits, auditContext(req), req.log, input, req.cookies[SESSION_COOKIE]);
    setSessionCookies(reply, result);
    return { user: result.user, mfaRequired: false, mustChangePassword: result.user.mustChangePassword };
  });

  // Doğrulama/CSRF hatasında da çerezleri temizleyen yanıt döner; sunucu oturumu yalnız geçerli istekte iptal edilir (S1-10).
  const logoutGuard = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await requireAuth(req);
    } catch (err) {
      clearSessionCookies(reply);
      throw err;
    }
  };

  app.post("/logout", { ...pendingOk, preHandler: logoutGuard }, async (req, reply) => {
    await logout(app.db, auditContext(req), authOf(req));
    // G-E9-14: bu oturumun /ws/panel soketleri anında 4401 (commit sonrası).
    const token = req.cookies[SESSION_COOKIE];
    if (token) app.requestHub.closeByAuthToken(sha256Hex(token));
    clearSessionCookies(reply);
    return reply.status(204).send();
  });

  app.post("/password/change", pendingOk, async (req, reply) => {
    const input = parseInput(passwordChangeInputSchema, req.body);
    setSessionCookies(reply, await changePassword(app.db, app.authLimits, auditContext(req), authOf(req), input));
    app.requestHub.closeByUser(authOf(req).user.id); // G-E9-14: eski oturumların panel soketleri 4401 (yeni çerezle yeniden bağlanır)
    return reply.status(204).send();
  });

  app.get("/me", pendingOk, async (req): Promise<MeResponse> => {
    const auth = authOf(req);
    return {
      user: auth.user,
      permissions: [...auth.permissions],
      tenant: auth.tenant,
      actingTenant: auth.actingTenant,
    };
  });
}
