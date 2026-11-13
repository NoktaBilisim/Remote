import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { t } from "@/lib/i18n";
import { getMe } from "@/lib/server-api";
import { htmlThemeClass, resolveTheme, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: t("app.name"), template: `%s · ${t("app.name")}` },
  // AC-86: nokta-kucuk.png'den üretilen favicon seti (scripts/make-icons.mjs)
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // CSP nonce her istekte farklı → statik ön-derleme yok, her sayfa dinamik
  await connection();
  // AC-85: tema ilk HTML'de sınıf olarak gelir (satır içi betik yok → CSP bozulmaz, flaş yok). Oturum varsa DB tercihi
  // (getMe istek başına tek; panel layout'u aynı sonucu kullanır), yoksa tarayıcıdaki son tercih (çerez), o da yoksa sistem.
  const jar = await cookies();
  let userTheme: unknown;
  if (jar.has(SESSION_COOKIE)) {
    const me = await getMe();
    if (me.kind === "ok") userTheme = me.me.user.theme;
  }
  const theme = resolveTheme({ user: userTheme, cookie: jar.get(THEME_COOKIE)?.value });
  return (
    <html lang="tr" className={htmlThemeClass(theme)} data-theme={theme.toLowerCase()}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
