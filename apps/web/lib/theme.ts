/*
 * Tema tercihi (P12, AC-85; ortak std. §1.6). Kaynak DB (`users.theme`, /auth/me); tarayıcıda aynı değer `rs_theme`
 * çerezinde (HttpOnly değil; sunucu giriş/tercih değişiminde yazar, istemci iyimser güncellemede yazar). Kök layout
 * ilk HTML'de `<html class="light|dark">` basar → flaş yok, satır içi betik yok (CSP). `SYSTEM` → sınıf yok,
 * `prefers-color-scheme` CSS yolu. Çerez yoksa (ör. ilk ziyaret) sistem.
 */
import type { Theme } from "@remote/contracts/api/auth";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE_SEC, THEMES, themeCookieValue } from "@remote/contracts/api/branding";

export type { Theme };
export { THEME_COOKIE, THEMES };

export const themeToCookie = themeCookieValue;

/** Çerez değeri → tema; bilinmeyen/boş → null (sistem varsayılır). */
export function cookieToTheme(v: string | null | undefined): Theme | null {
  switch (v?.trim().toLowerCase()) {
    case "light":
      return "LIGHT";
    case "dark":
      return "DARK";
    case "system":
      return "SYSTEM";
    default:
      return null;
  }
}

export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

/**
 * İlk boyamadaki tema: oturum varsa DB değeri (başka cihazda da aynı gelir), yoksa tarayıcıdaki son tercih (çerez),
 * o da yoksa sistem.
 */
export function resolveTheme({ user, cookie }: { user?: unknown; cookie?: string | null }): Theme {
  if (isTheme(user)) return user;
  return cookieToTheme(cookie) ?? "SYSTEM";
}

/** `<html>` sınıfı: açık/koyu açık tercih; sistemde sınıf yok (CSS medya sorgusu karar verir). */
export function htmlThemeClass(t: Theme): "light" | "dark" | undefined {
  return t === "LIGHT" ? "light" : t === "DARK" ? "dark" : undefined;
}

/** `document.cookie` için tam çerez dizesi. HTTPS'te `Secure` (sunucunun Secure çereziyle aynı adı ezebilsin). */
export function themeCookieString(t: Theme, https: boolean): string {
  return `${THEME_COOKIE}=${themeToCookie(t)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SEC}; SameSite=Lax${https ? "; Secure" : ""}`;
}

/** Tarayıcıda temayı anında uygular (sınıf + çerez). Yalnız istemci. */
export function applyThemeToDocument(t: Theme, doc: Document = document): void {
  const root = doc.documentElement;
  root.classList.remove("light", "dark");
  const cls = htmlThemeClass(t);
  if (cls) root.classList.add(cls);
  root.dataset.theme = t.toLowerCase();
  doc.cookie = themeCookieString(t, doc.location?.protocol === "https:");
}
