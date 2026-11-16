import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { tenantSlugSchema } from "@remote/contracts/api/tenants";
import { TENANT_HEADER } from "@/lib/branding/constants";
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
const PUBLIC_PATHS = ["/login", "/session/", "/forgot-password", "/reset-password", "/r/"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
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

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), display-capture=(self)");
  return res;
}

export const config = {
  // Statik dosyalar ve /api (Caddy/rewrite → server) proxy'den geçmez
  matcher: ["/((?!api|ws/|_next/static|_next/image|img/|favicon.ico|favicon-32x32.png|apple-touch-icon.png).*)"],
};
