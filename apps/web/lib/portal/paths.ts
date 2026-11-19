/*
 * P21 müşteri portalı (AC-262; mimari-p21 §6, r2 S-P21-3): portal yolları ve giriş adresi — saf, testli.
 * proxy.ts (sunucu kenarı), lib/portal/server.ts ve lib/portal/api.ts aynı yardımcıyı kullanır.
 * Giriş adresi firmaya bağlıdır: `/portal/login?tenant=<slug>`; slug yalnız `tenantSlugSchema`'ya uyan değerdir
 * (`rs_portal_tenant` çerezinden), yoksa `?tenant`'sız → giriş sayfası "bağlantıyı isteyin" metnini gösterir.
 */
import { tenantSlugSchema } from "@remote/contracts/api/tenants";

export const PORTAL_HOME = "/portal";
export const PORTAL_LOGIN = "/portal/login";
export const PORTAL_CHANGE_PASSWORD = "/portal/change-password";
export const PORTAL_NEW_REQUEST = "/portal/new-request";
export const PORTAL_ACCOUNT = "/portal/account";

/** `/portal` ve alt yolları. */
export const isPortalPath = (pathname: string): boolean => pathname === PORTAL_HOME || pathname.startsWith(`${PORTAL_HOME}/`);

/** Geçerli firma kısa adı ya da null (çerez/sorgu değeri doğrulanmadan kullanılmaz). */
export function validSlug(v: string | null | undefined): string | null {
  if (!v) return null;
  const r = tenantSlugSchema.safeParse(v);
  return r.success ? r.data : null;
}

export type PortalLoginReason = "expired" | "logout";

/** Portal giriş adresi: geçerli slug varsa `?tenant=`, isteğe bağlı `reason`. Sonrası sabit hedef (`/portal`) — `next` yok. */
export function portalLoginPath(slug: string | null | undefined, reason?: PortalLoginReason): string {
  const q = new URLSearchParams();
  const s = validSlug(slug);
  if (s) q.set("tenant", s);
  if (reason) q.set("reason", reason);
  const qs = q.toString();
  return qs ? `${PORTAL_LOGIN}?${qs}` : PORTAL_LOGIN;
}

/**
 * Proxy ön elemesi: portal yolunda (giriş sayfası hariç) portal oturum çerezi yoksa giriş adresi; değilse null.
 * Çerezin geçerliliğini sunucu doğrular (`GET /portal/me`); burası yalnız ön eleme.
 */
export function portalRedirect(pathname: string, hasSession: boolean, tenantCookie: string | null | undefined): string | null {
  if (!isPortalPath(pathname) || pathname === PORTAL_LOGIN || hasSession) return null;
  return portalLoginPath(tenantCookie);
}

/** Yalnız istemci: `rs_portal_tenant` çerezini okur (gizli değil, JS'e açık). */
export function tenantSlugFromCookieString(cookie: string, name: string): string | null {
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return validSlug(decodeURIComponent(v.join("=")));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Proxy → kök layout: istek portal alanında (tema `portal_users.theme`'den). Yalnız proxy yazar; gelen değer silinir. */
export const PORTAL_AREA_HEADER = "x-rs-portal";
