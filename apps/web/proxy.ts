import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { PORTAL_SESSION_COOKIE, PORTAL_TENANT_COOKIE } from "@remote/contracts/api/portal";
import { tenantSlugSchema } from "@remote/contracts/api/tenants";
import { TENANT_HEADER } from "@/lib/branding/constants";
import { isPortalPath, PORTAL_AREA_HEADER, PORTAL_NEW_REQUEST, portalRedirect } from "@/lib/portal/paths";
import { NextResponse, type NextRequest } from "next/server";

/*
 * Next 16 "proxy" (eski adıyla middleware; mimari §6'daki middleware.ts).
 * 1) CSP nonce (mimari §5.4, G-19, AC-126) — 'unsafe-inline' yok.
 * 2) Oturum çerezi yoksa korumalı sayfadan /login'e yönlendirme. Çerezin
 *    geçerliliğini server doğrular (panel layout /auth/me); burası yalnız ön eleme.
 */
// Oturumsuz erişilen yollar (önek eşleşmesi). /session/ = müşteri karşılama sayfası (P4; o zamana dek 404)
// P10: /forgot-password, /reset-password (AC-66; token URL parçasında — sunucuya/loga gitmez)
// P19 (mimari-e11 §8c.2 m.8): /r/<ref> = herkese açık web talep formu (çerezsiz ziyaretçi /login'e yönlenmez)
// P21 (mimari-p21 §6): /portal = müşteri portalı — panel girişine yönlendirilmez; kendi ön elemesi `portalRedirect`
const PUBLIC_PATHS = ["/login", "/session/", "/forgot-password", "/reset-password", "/r/", "/portal"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * P28d (K-PD-1, D-PD-1): Permissions-Policy tek saf fonksiyondan. Politika belge yüklenirken sabitlenir ve konsola yumuşak geçilir
 * → tüm sayfalarda `microphone=(self)`; YALNIZ `/r` ve alt yolları (herkese açık talep formu) `microphone=()`. Girişsiz/herkese açık
 * yeni bir sayfa eklenirse bu listeye eklenir (birim testiyle birlikte). camera/geolocation kapalı, display-capture değişmez.
 */
// P21: /portal (müşteri portalı) da girişsiz dış kişi alanıdır → microphone=()
const MIC_DENY_PREFIXES = ["/r", "/portal"];
/**
 * P21 r2 S-P21-12: `/portal` altında `display-capture=()`. İSTİSNA `/portal/new-request`: P19 bekleme odası kabulde ekran
 * paylaşımını (`GuestSession` → `getDisplayMedia`) AYNI belgede başlatır; orada kapatmak paylaşımı kırar (implementation.md sapma).
 */
const underPrefix = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);
export function permissionsPolicyFor(pathname: string): string {
  const deny = MIC_DENY_PREFIXES.some((p) => underPrefix(pathname, p));
  const noCapture = isPortalPath(pathname) && !underPrefix(pathname, PORTAL_NEW_REQUEST);
  return `camera=(), microphone=${deny ? "()" : "(self)"}, geolocation=(), display-capture=${noCapture ? "()" : "(self)"}`;
}

export function buildCsp(nonce: string, host: string, isDev: boolean, https: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    // P28e (S-P28e-11): kayıt oynatıcısı MSE `blob:` adresi — YALNIZ media-src (default/script/worker-src'ye blob: girmez)
    "media-src 'self' blob:",
    `connect-src 'self' wss://${host}${isDev ? ` ws://${host}` : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    // Yalnız HTTPS arkasında (Caddy X-Forwarded-Proto); düz http yerel/e2e'de istekleri kırar
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = isPublicPath(pathname);

  // P21: portal oturum çerezi yoksa firmaya bağlı portal girişi (slug `rs_portal_tenant` çerezinden, doğrulanarak)
  const toPortalLogin = portalRedirect(pathname, req.cookies.has(PORTAL_SESSION_COOKIE), req.cookies.get(PORTAL_TENANT_COOKIE)?.value);
  if (toPortalLogin) return NextResponse.redirect(new URL(toPortalLogin, req.nextUrl));

  if (!isPublic && !req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // S1-4 / QA-3: next= yalnız yol (sorgu dizesi yok); /session/ yolları (token taşır) asla next'e yazılmaz
    url.search =
      pathname === "/" || pathname.startsWith("/session/") || pathname.startsWith("/r/") ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const https = req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";
  const csp = buildCsp(nonce, host, process.env.NODE_ENV === "development", https);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // P12 (AC-82): giriş ekranı logosu için firma kısa adı (?tenant=<slug>) sunucu layout'una iletilir (layout sorgu
  // dizesini göremez). Dışarıdan gelen aynı adlı başlık her zaman silinir; yalnız biçime uyan slug yazılır.
  requestHeaders.delete(TENANT_HEADER);
  const slug = req.nextUrl.searchParams.get("tenant");
  if (slug && tenantSlugSchema.safeParse(slug).success) requestHeaders.set(TENANT_HEADER, slug.trim());
  requestHeaders.set("Content-Security-Policy", csp);
  // P21: kök layout temayı portal oturumundan okusun diye alan işareti (dışarıdan gelen aynı adlı başlık her zaman silinir)
  requestHeaders.delete(PORTAL_AREA_HEADER);
  if (isPortalPath(pathname)) requestHeaders.set(PORTAL_AREA_HEADER, "1");

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", permissionsPolicyFor(pathname));
  return res;
}

export const config = {
  // Statik dosyalar ve /api (Caddy/rewrite → server) proxy'den geçmez
  matcher: ["/((?!api|ws/|_next/static|_next/image|img/|favicon.ico|favicon-32x32.png|apple-touch-icon.png).*)"],
};
