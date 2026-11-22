import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoImage } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/branding/theme-provider";
import { LoadError } from "@/components/load-error";
import { ToastProvider } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import { PORTAL_CHANGE_PASSWORD, PORTAL_HOME } from "@/lib/portal/paths";
import { getPortalMe, portalExpiredLogin } from "@/lib/portal/server";
import { resolveTheme } from "@/lib/theme";
import { PortalThemeProvider, PortalUserMenu } from "./portal-shell";

/**
 * Portal kabuğu (mimari-p21 §6): panel `(panel)` kabuğu ve `/auth/me` KULLANILMAZ. Üst çubuk: sağlayıcı (tenant) logosu +
 * müşteri adı + hesap menüsü (Hesabım, Tema, Çıkış). Oturum yok → firmanın giriş adresi; zorunlu şifre değişimi bekleyen
 * hesap portal sayfalarını açamaz (sunucu da 403 `PASSWORD_CHANGE_REQUIRED` verir).
 */
export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const s = await getPortalMe();
  if (s.kind === "unauthenticated") redirect(await portalExpiredLogin());
  if (s.kind === "error") {
    return (
      <main id="icerik" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <LoadError />
      </main>
    );
  }
  const { user, customer, provider } = s.me;
  if (user.mustChangePassword) redirect(PORTAL_CHANGE_PASSWORD);
  return (
    <ToastProvider>
      <PortalThemeProvider initial={resolveTheme({ user: user.theme })}>
        <div className="flex min-h-dvh flex-col">
          <a
            href="#icerik"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
          >
            {t("portal.skip")}
          </a>
          <header className="sticky top-0 z-40 border-b border-border bg-surface">
            <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
              <Link href={PORTAL_HOME} className="shrink-0 rounded-md" aria-label={t("portal.home.title")}>
                <LogoImage variant="mark" url={provider.logoUrl} alt={t("lg.alt", { name: provider.name })} testId="portal-logo" />
              </Link>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg" data-testid="portal-customer">
                  {customer.name}
                </p>
                <p className="hidden truncate text-xs text-fg-muted sm:block">{t("portal.name")}</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle testId="portal-theme-toggle" />
                <PortalUserMenu name={user.fullName} email={user.email} />
              </div>
            </div>
          </header>
          <main id="icerik" tabIndex={-1} className="mx-auto w-full max-w-5xl min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6">
            {children}
          </main>
        </div>
      </PortalThemeProvider>
    </ToastProvider>
  );
}
