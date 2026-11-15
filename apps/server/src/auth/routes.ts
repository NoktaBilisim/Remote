// /api/v1/auth uçları (mimari-api.md "Auth"). Handler'lar yalnız doğrulama + servis çağrısı + yanıt.
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  loginInputSchema,
  logoutAllInputSchema,
  mfaEnableInputSchema,
  mfaSetupInputSchema,
  mfaVerifyInputSchema,
  passwordChangeInputSchema,
  passwordForgotInputSchema,
  passwordResetInputSchema,
  stepUpInputSchema,
  type LoginResponse,
  type LogoutAllResponse,
  type MeResponse,
  type MfaEnableResponse,
  type MfaSetupResponse,
  type MfaVerifyResponse,
  type StepUpResponse,
} from "@remote/contracts/api/auth";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_SEC,
  preferencesInputSchema,
  themeCookieValue,
  type PreferencesResponse,
  type ThemeValue,
} from "@remote/contracts/api/branding";
import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { parseInput } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { authOf, checkOrigin, requireAuth } from "./guards.ts";
import {
  forgotPassword,
  lockNotifier,
  logoutAll,
  mfaEnable,
  mfaSetup,
  mfaVerify,
  recoveryCodesLeft,
  resetPassword,
  stepUp,
} from "./account.ts";
import { changePassword, login, logout } from "./service.ts";
import { setTheme } from "../uploads/service.ts";
import { effectiveLogoUrl } from "../uploads/urls.ts";

const baseCookie: CookieSerializeOptions = { path: "/", secure: true, sameSite: "strict" };
// /auth/me ve /auth/logout her aşamada; şifre değişimi 2FA kurulum aşamasında da (doğrulama aşamasında değil).
const pendingOk = { config: { allowPasswordChangePending: true, mfaVerifyStage: true, mfaSetupStage: true }, preHandler: requireAuth };
const setupStage = { config: { mfaSetupStage: true }, preHandler: requireAuth };
const noStore = (reply: FastifyReply) => void reply.header("Cache-Control", "no-store");

function setSessionCookies(reply: FastifyReply, s: { token: string; csrfToken: string; expiresAt: Date }): void {
  void reply.setCookie(SESSION_COOKIE, s.token, { ...baseCookie, httpOnly: true, expires: s.expiresAt });
  void reply.setCookie(CSRF_COOKIE, s.csrfToken, { ...baseCookie, httpOnly: false, expires: s.expiresAt });
}

/**
 * P12 (AC-85): flaşsız tema çerezi — web kök layout'u sunucuda okur. HttpOnly değil (istemci de okur; gizli değil),
 * SameSite=Lax (dış bağlantıyla gelişte de tema doğru), production'da Secure. Çıkışta silinmez.
 */
function setThemeCookie(reply: FastifyReply, theme: ThemeValue): void {
  const secure = reply.server.env.NODE_ENV === "production";
  void reply.setCookie(THEME_COOKIE, themeCookieValue(theme), {
    path: "/",
    sameSite: "lax",
    secure,
    httpOnly: false,
    maxAge: THEME_COOKIE_MAX_AGE_SEC,
  });
}

function clearSessionCookies(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { ...baseCookie, httpOnly: true });
  void reply.clearCookie(CSRF_COOKIE, { ...baseCookie, httpOnly: false });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (req, reply): Promise<LoginResponse> => {
    checkOrigin(req);
    const input = parseInput(loginInputSchema, req.body);
    const ctx = auditContext(req);
    const result = await login(
      app.db,
      app.authLimits,
      ctx,
      req.log,
      input,
      app.mfaSetupEnforced,
      req.cookies[SESSION_COOKIE],
      lockNotifier(app.account, ctx),
    );
    setSessionCookies(reply, result);
    setThemeCookie(reply, result.user.theme);
    return {
      user: result.user,
      mfaRequired: result.mfaStage === "verify",
      mfaSetupRequired: result.mfaStage === "setup",
      mustChangePassword: result.user.mustChangePassword,
    };
  });

  // --- P10: 2FA (AC-67) ---
  app.post(
    "/mfa/verify",
    { config: { allowPasswordChangePending: true, mfaVerifyStage: true }, preHandler: requireAuth },
    async (req, reply): Promise<MfaVerifyResponse> => {
      const input = parseInput(mfaVerifyInputSchema, req.body);
      const out = await mfaVerify(app.account, auditContext(req), authOf(req), input);
      setSessionCookies(reply, out.session);
      noStore(reply);
      return { user: out.user, recoveryCodesLeft: out.recoveryCodesLeft };
    },
  );

  app.post("/mfa/setup", setupStage, async (req, reply): Promise<MfaSetupResponse> => {
    parseInput(mfaSetupInputSchema, req.body);
    noStore(reply);
    return mfaSetup(app.account, auditContext(req), authOf(req));
  });

  app.post("/mfa/enable", setupStage, async (req, reply): Promise<MfaEnableResponse> => {
    const { code } = parseInput(mfaEnableInputSchema, req.body);
    noStore(reply);
    const out = await mfaEnable(app.account, auditContext(req), authOf(req), code);
    app.requestHub.closeByUser(authOf(req).user.id); // diğer oturumların panel soketleri (iptal edildi)
    return out;
  });

  // --- P14a: step-up 2FA (AC-215, ADR-0022) — tam oturum (2FA aşaması ok) ister ---
  app.post("/step-up", { preHandler: requireAuth }, async (req, reply): Promise<StepUpResponse> => {
    const input = parseInput(stepUpInputSchema, req.body);
    noStore(reply);
    return stepUp(app.account, auditContext(req), authOf(req), input);
  });

  // --- P10: tüm cihazlardan çıkış (AC-68, 115) ---
  app.post("/logout-all", { preHandler: requireAuth }, async (req): Promise<LogoutAllResponse> => {
    parseInput(logoutAllInputSchema, req.body);
    return { revokedSessions: await logoutAll(app.account, auditContext(req), authOf(req)) };
  });

  // --- P10: e-posta ile şifre sıfırlama (AC-66) — public, Origin zorunlu, CSRF çerezi yok ---
  app.post("/password/forgot", async (req, reply) => {
    checkOrigin(req);
    const { email } = parseInput(passwordForgotInputSchema, req.body);
    forgotPassword(app.account, auditContext(req), email);
    return reply.status(202).send();
  });

  app.post("/password/reset", async (req, reply) => {
    checkOrigin(req);
    const input = parseInput(passwordResetInputSchema, req.body);
    await resetPassword(app.account, auditContext(req), input);
    return reply.status(204).send();
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

  app.post(
    "/password/change",
    { config: { allowPasswordChangePending: true, mfaSetupStage: true }, preHandler: requireAuth },
    async (req, reply) => {
      const input = parseInput(passwordChangeInputSchema, req.body);
      setSessionCookies(reply, await changePassword(app.db, app.authLimits, auditContext(req), authOf(req), input));
      app.requestHub.closeByUser(authOf(req).user.id); // G-E9-14: eski oturumların panel soketleri 4401 (yeni çerezle yeniden bağlanır)
      return reply.status(204).send();
    },
  );

  // P12 (AC-85): tema tercihi; şifre değişimi / 2FA kurulumu bekleyen oturumda da (doğrulama aşamasında değil).
  app.patch(
    "/me/preferences",
    { config: { allowPasswordChangePending: true, mfaSetupStage: true }, preHandler: requireAuth },
    async (req, reply): Promise<PreferencesResponse> => {
      const { theme } = parseInput(preferencesInputSchema, req.body);
      await setTheme(app.db, auditContext(req), authOf(req), theme);
      setThemeCookie(reply, theme);
      noStore(reply);
      return { theme };
    },
  );

  app.get("/me", pendingOk, async (req, reply): Promise<MeResponse> => {
    const auth = authOf(req);
    const ok = auth.mfaStage === "ok";
    setThemeCookie(reply, auth.user.theme);
    return {
      user: auth.user,
      // Yarım (2FA bekleyen) oturumda yetki/tenant bilgisi verilmez.
      permissions: ok ? [...auth.permissions] : [],
      tenant: auth.tenant,
      actingTenant: ok ? auth.actingTenant : null,
      mfa: {
        enabled: auth.totpEnabled,
        required: auth.mfaRequired,
        stage: auth.mfaStage,
        recoveryCodesLeft: auth.totpEnabled && ok ? await recoveryCodesLeft(app.db, auth.user.id) : 0,
      },
      // Yarım oturumda seçili firma bilgisi verilmez → kullanıcının kendi firması / sistem logosu.
      logoUrl: await effectiveLogoUrl(app.db, ok || auth.tenant ? auth.logoPath : null),
    };
  });
}
