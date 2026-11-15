// Ortak guard'lar (mimari §5.1, ADR-0008). Uç sırası: requireAuth → requirePerm → tenantScope → zod → servis.
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { PermissionKey } from "@remote/contracts/permissions";
import type { FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.ts";
import { safeEqual } from "../lib/ids.ts";
import { resolveSession, type AuthContext } from "./session.ts";

const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Durum değiştiren isteklerde Origin allowlist'te olmalı (login CSRF dahil). */
export function checkOrigin(req: FastifyRequest): void {
  const origin = req.headers.origin;
  if (!origin || !req.server.env.allowedOrigins.includes(origin)) throw new AppError("CSRF_INVALID");
}

export type PublicClientKind = "BROWSER" | "AGENT";

/**
 * Public istemci türü kuralı (ADR-0012, mimari-api "Public istemci türü"): Origin varsa allowlist + BROWSER;
 * yoksa yalnız AGENT ve `Sec-Fetch-Site`/`Sec-Fetch-Mode` yok. Upgrade isteğinde de aynı başlıklarla çağrılır.
 */
export function publicClientAllowed(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: readonly string[],
  kind: PublicClientKind,
): boolean {
  const origin = headers.origin;
  if (origin !== undefined) return kind === "BROWSER" && typeof origin === "string" && allowedOrigins.includes(origin);
  return kind === "AGENT" && headers["sec-fetch-site"] === undefined && headers["sec-fetch-mode"] === undefined;
}

export function checkPublicClient(req: FastifyRequest, kind: PublicClientKind): void {
  if (!publicClientAllowed(req.headers, req.server.env.allowedOrigins, kind)) throw new AppError("CSRF_INVALID");
}

function checkCsrf(req: FastifyRequest): void {
  checkOrigin(req);
  const header = req.headers[CSRF_HEADER];
  const cookie = req.cookies[CSRF_COOKIE];
  if (typeof header !== "string" || !cookie || !safeEqual(header, cookie)) throw new AppError("CSRF_INVALID");
}

/**
 * Oturum doğrulaması + (POST/PUT/PATCH/DELETE) CSRF double-submit + ilk giriş şifre değişimi kapısı.
 * `config.allowPasswordChangePending` yalnız /auth/me, /auth/logout, /auth/password/change'de true.
 */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  const auth = token
    ? await resolveSession(req.server.db, token, new Date(), { setupEnforced: req.server.mfaSetupEnforced, allowPartial: true })
    : null;
  if (!auth) throw new AppError("UNAUTHENTICATED");
  if (UNSAFE_METHODS.has(req.method)) checkCsrf(req);
  const cfg = req.routeOptions.config;
  // P10 (AC-67): 2FA aşaması önce (yarım oturum şifre değiştiremez), sonra ilk giriş şifre kapısı.
  if (auth.mfaStage === "verify" && !cfg.mfaVerifyStage) throw new AppError("MFA_REQUIRED");
  if (auth.mfaStage === "setup" && !cfg.mfaSetupStage) throw new AppError("MFA_SETUP_REQUIRED");
  if (auth.user.mustChangePassword && !cfg.allowPasswordChangePending) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED");
  }
  req.auth = auth;
}

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new Error("requireAuth bu uçta tanımlı değil");
  return req.auth;
}

/** Yetki anahtarı yoksa 403 (SUPER_ADMIN'in kümesi tüm anahtarları içerir). */
export function requirePerm(key: PermissionKey) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!authOf(req).permissions.has(key)) throw new AppError("FORBIDDEN");
  };
}

/** Anahtarlardan en az biri yoksa 403 (any-of; ör. GET /sessions: sessions.view VEYA session_history.view, P8). */
export function requireAnyPerm(...keys: readonly PermissionKey[]) {
  return async (req: FastifyRequest): Promise<void> => {
    const perms = authOf(req).permissions;
    if (!keys.some((k) => perms.has(k))) throw new AppError("FORBIDDEN");
  };
}

/** P9: sistem uçları (`/admin/*`) yalnız SUPER_ADMIN — rol kontrolü, toggle değil (mimari-api "Yetki anahtarları"). */
export async function requireSuperAdmin(req: FastifyRequest): Promise<void> {
  if (authOf(req).user.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN");
}

/**
 * Tenant verisine erişen her repository fonksiyonuna verilen zorunlu kapsam (AC-69).
 * Super Admin tenant seçmeden tenant verisine erişemez (geçiş: POST /admin/switch-tenant).
 */
export function tenantScope(req: FastifyRequest): { tenantId: string } {
  const { tenantId } = authOf(req);
  if (!tenantId) throw new AppError("FORBIDDEN", { message: "Önce bir firma seçin." });
  return { tenantId };
}
