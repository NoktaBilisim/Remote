/*
 * P21 portal tarayıcı API yardımcısı (mimari-p21 §6). Panel `lib/api.ts` `api()` KULLANILMAZ: o panel CSRF çerezini okur ve
 * 403 `MFA_REQUIRED`'da panelin `/login/2fa` ekranına yönlendirir (portal girişi aynı kodu döner). Hata zarfı ve sınıflar
 * (`ApiError`, `NetworkError`) panelle aynı → `toUiError` ve `submitFailure` olduğu gibi çalışır.
 * CSRF: `PORTAL_CSRF_COOKIE` (`__Host-rs_portal_csrf`) → `x-csrf-token` (ADR-0039; çapraz kabul yok).
 */
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { PORTAL_CSRF_COOKIE, PORTAL_TENANT_COOKIE } from "@remote/contracts/api/portal";
import { API_BASE, ApiError, NetworkError, readCookie } from "@/lib/api";
import { PORTAL_CHANGE_PASSWORD, portalLoginPath, tenantSlugFromCookieString } from "./paths";

type Method = "GET" | "POST" | "PATCH";
export type PortalDeps = { fetch: typeof fetch; cookie: () => string };

const browserDeps = (): PortalDeps => ({ fetch: (...a) => fetch(...a), cookie: () => document.cookie });

export async function portalApi<T>(method: Method, path: string, body?: unknown, deps: PortalDeps = browserDeps()): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    const csrf = readCookie(PORTAL_CSRF_COOKIE, deps.cookie());
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
  let res: Response;
  try {
    res = await deps.fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new NetworkError();
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const err = (data as { error?: Partial<Record<string, unknown>> } | null)?.error ?? {};
  const retry = Number(res.headers.get("Retry-After"));
  throw new ApiError(
    res.status,
    typeof err.code === "string" ? err.code : "INTERNAL",
    typeof err.message === "string" ? err.message : "",
    (err.fields as Record<string, string> | undefined) ?? undefined,
    typeof err.requestId === "string" ? err.requestId : undefined,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

/** Oturum düşmüş portal kullanıcısının gideceği giriş adresi (son firma kısa adıyla). Yalnız istemci. */
export function portalExpiredPath(cookie: string = typeof document === "undefined" ? "" : document.cookie): string {
  return portalLoginPath(tenantSlugFromCookieString(cookie, PORTAL_TENANT_COOKIE), "expired");
}

/**
 * Oturum kapısı hataları: 401 → portal girişi (`reason=expired`), 403 `PASSWORD_CHANGE_REQUIRED` → zorunlu şifre değişimi.
 * Yönlendirme yapıldıysa hedef döner (çağıran başka bir şey göstermez); değilse null.
 */
export function portalGateTarget(e: unknown, cookie?: string): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.status === 401) return portalExpiredPath(cookie);
  if (e.status === 403 && e.code === "PASSWORD_CHANGE_REQUIRED") return PORTAL_CHANGE_PASSWORD;
  return null;
}
