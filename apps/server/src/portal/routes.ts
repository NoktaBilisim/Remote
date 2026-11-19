// /api/v1/portal/* (P21; mimari-p21 §4.2, ADR-0039). Portal oturumu (panel çerezi anlamsız). Sıra: bodyLimit 8 KB →
// requirePortal (çerez → oturum → CSRF → şifre kapısı) → zod → servis (`portalScope`). Giriş ucu `requirePortal` almaz:
// Origin + kovalar + zod. Tüm yanıtlar `Cache-Control: no-store`. Handler'lar yalnız doğrulama + servis çağrısı + yanıt.
import { passwordChangeInputSchema } from "@remote/contracts/api/auth";
import {
  PORTAL_SESSION_COOKIE,
  PORTAL_TENANT_COOKIE,
  portalListQuerySchema,
  portalLoginInputSchema,
  portalRequestInputSchema,
  portalThemeInputSchema,
  portalTotpDisableInputSchema,
  portalTotpEnableInputSchema,
  type PortalMe,
  type PortalPage,
  type PortalRequestFormInfo,
  type PortalRequestItem,
  type PortalSessionItem,
  type PortalTotpSetupResponse,
} from "@remote/contracts/api/portal";
import type { CreateRequestResponse } from "@remote/contracts/api/requests";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auditContext } from "../audit/service.ts";
import { checkOrigin } from "../auth/guards.ts";
import { setThemeCookie } from "../auth/routes.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import {
  portalChangePassword,
  portalLogin,
  portalLogout,
  portalSetTheme,
  portalTotpDisable,
  portalTotpEnable,
  portalTotpSetup,
  type PortalDeps,
} from "./auth.ts";
import {
  createPortalRequest,
  getPortalRequest,
  getPortalSession,
  listPortalRequests,
  listPortalSessions,
  portalMe,
  portalRequestForm,
} from "./data.ts";
import { clearPortalCookies, portalOf, portalScope, requirePortal, setPortalCookies } from "./guard.ts";

const BODY_LIMIT = 8 * 1024;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** `rs_portal_tenant` çerezi ömrü (gizli değil; oturum düşünce `/portal/login?tenant=<slug>` yönlendirmesi için). */
const TENANT_COOKIE_MAX_AGE_SEC = 365 * 86_400;
/** Gövdesiz POST uçları (logout, totp/setup): yalnız boş nesne/gövdesiz. */
const emptyBody = z.strictObject({});

function idParam(req: FastifyRequest): string {
  const { id } = req.params as { id?: string };
  if (!id || !ULID.test(id)) throw new AppError("NOT_FOUND");
  return id;
}

export function portalDepsOf(app: FastifyInstance): PortalDeps {
  return { db: app.db, secrets: app.secrets, limits: app.portalLimits, metrics: app.metrics, log: app.log };
}

/** r2 S-P21-3: girişteki firma kısa adı — `proxy.ts` oturum düşünce bununla yönlendirir (httpOnly değil; gizli değil). */
function setTenantCookie(reply: FastifyReply, slug: string): void {
  void reply.setCookie(PORTAL_TENANT_COOKIE, slug, {
    path: "/",
    sameSite: "lax",
    secure: reply.server.env.NODE_ENV === "production",
    httpOnly: false,
    maxAge: TENANT_COOKIE_MAX_AGE_SEC,
  });
}

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  app.decorateRequest("portal", null);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const d = portalDepsOf(app);
  authRoutes(app, d);
  accountRoutes(app, d);
  dataRoutes(app);
}

const pending = { config: { allowPasswordChangePending: true }, preHandler: requirePortal, bodyLimit: BODY_LIMIT };
const guarded = { preHandler: requirePortal, bodyLimit: BODY_LIMIT };

function authRoutes(app: FastifyInstance, d: PortalDeps): void {
  app.post("/auth/login", { bodyLimit: BODY_LIMIT }, async (req, reply): Promise<PortalMe> => {
    checkOrigin(req);
    const input = parseInput(portalLoginInputSchema, req.body);
    const out = await portalLogin(d, auditContext(req), input, req.cookies[PORTAL_SESSION_COOKIE]);
    setPortalCookies(reply, out);
    setTenantCookie(reply, out.context.tenant.slug);
    setThemeCookie(reply, out.context.user.theme);
    return portalMe(app.db, app.env.PUBLIC_BASE_URL, out.context);
  });

  // Doğrulama/CSRF hatasında da çerezler temizlenir; sunucu oturumu yalnız geçerli istekte iptal edilir (S1-10 kalıbı).
  const logoutGuard = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await requirePortal(req, reply);
    } catch (err) {
      clearPortalCookies(reply);
      throw err;
    }
  };
  app.post("/auth/logout", { ...pending, preHandler: logoutGuard }, async (req, reply) => {
    parseInput(emptyBody, req.body);
    await portalLogout(d, auditContext(req), portalOf(req));
    clearPortalCookies(reply);
    return reply.status(204).send();
  });

  app.get("/me", pending, async (req, reply): Promise<PortalMe> => {
    const p = portalOf(req);
    setThemeCookie(reply, p.user.theme);
    return portalMe(app.db, app.env.PUBLIC_BASE_URL, p);
  });

  app.patch("/me", guarded, async (req, reply): Promise<PortalMe> => {
    const { theme } = parseInput(portalThemeInputSchema, req.body);
    const p = portalOf(req);
    await portalSetTheme(d, p, theme);
    setThemeCookie(reply, theme);
    return portalMe(app.db, app.env.PUBLIC_BASE_URL, { ...p, user: { ...p.user, theme } });
  });
}

function accountRoutes(app: FastifyInstance, d: PortalDeps): void {
  app.post("/account/password", pending, async (req, reply) => {
    const input = parseInput(passwordChangeInputSchema, req.body);
    setPortalCookies(reply, await portalChangePassword(d, auditContext(req), portalOf(req), input));
    return reply.status(204).send();
  });

  app.post("/account/totp/setup", guarded, async (req): Promise<PortalTotpSetupResponse> => {
    parseInput(emptyBody, req.body);
    return portalTotpSetup(d, portalOf(req));
  });

  app.post("/account/totp/enable", guarded, async (req, reply) => {
    const { code } = parseInput(portalTotpEnableInputSchema, req.body);
    await portalTotpEnable(d, auditContext(req), portalOf(req), code);
    return reply.status(204).send();
  });

  app.post("/account/totp/disable", guarded, async (req, reply) => {
    const input = parseInput(portalTotpDisableInputSchema, req.body);
    await portalTotpDisable(d, auditContext(req), portalOf(req), input);
    return reply.status(204).send();
  });
}

function dataRoutes(app: FastifyInstance): void {
  app.get("/request-form", guarded, async (req): Promise<PortalRequestFormInfo> => portalRequestForm(app.requests, portalOf(req)));

  app.post("/requests", guarded, async (req, reply): Promise<CreateRequestResponse> => {
    const input = parseInput(portalRequestInputSchema, req.body);
    const out = await createPortalRequest(app.requests, app.portalLimits, auditContext(req), portalOf(req), input);
    return reply.status(201).send(out);
  });

  app.get("/requests", guarded, async (req): Promise<PortalPage<PortalRequestItem>> =>
    listPortalRequests(app.db, portalScope(req), parseInput(portalListQuerySchema, req.query)),
  );
  app.get("/requests/:id", guarded, async (req): Promise<PortalRequestItem> => getPortalRequest(app.db, portalScope(req), idParam(req)));
  app.get("/sessions", guarded, async (req): Promise<PortalPage<PortalSessionItem>> =>
    listPortalSessions(app.db, portalScope(req), parseInput(portalListQuerySchema, req.query)),
  );
  app.get("/sessions/:id", guarded, async (req): Promise<PortalSessionItem> => getPortalSession(app.db, portalScope(req), idParam(req)));
}
