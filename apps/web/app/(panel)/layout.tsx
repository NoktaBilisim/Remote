import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { BrandLogo } from "@/components/brand-logo";
import { Avatar } from "@/components/ui/avatar";
import { LoadError } from "@/components/load-error";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe } from "@/lib/server-api";
import { LogoutButton } from "./logout-button";
import { SideNav } from "./side-nav";

/** Panel kabuğu (P1): üst menü (logo, kullanıcı, çıkış) + yalnız mevcut öğelerle kenar çubuğu. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const state = await getMe();
  if (state.kind === "unauthenticated") redirect(EXPIRED_LOGIN_PATH);
  if (state.kind === "error") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <LoadError />
      </main>
    );
  }
  const { user, tenant, permissions } = state.me;
  // AC-66: şifre değiştirilmeden panel açılmaz (sunucu guard'ı da uçları kapatır)
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        {t("panel.skip")}
      </a>
      <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
        <BrandLogo variant="mark" />
        <span className="truncate text-sm font-semibold text-fg sm:text-base">{t("app.name")}</span>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {/* TO-P2-3: avatar her genişlikte görünür; ad/rol/firma mobilde yalnız ekran okuyucuya (sr-only), sm+ görünür */}
          <div className="sr-only min-w-0 text-right sm:not-sr-only" data-testid="current-user">
            <p className="truncate text-sm font-medium text-fg">{user.fullName}</p>
            <p className="truncate text-xs text-fg-muted">
              {t(`role.${user.role}`)}
              {tenant ? ` · ${tenant.name}` : ""}
            </p>
          </div>
          <Avatar name={user.fullName} testId="current-user-avatar" />
          <LogoutButton userName={user.fullName} />
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-border bg-surface md:w-60 md:shrink-0 md:border-r md:border-b-0">
          <SideNav permissions={permissions} />
        </aside>
        <main id="icerik" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}
