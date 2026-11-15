import { redirect } from "next/navigation";
import { ThemeProvider } from "@/components/branding/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { LogoImage } from "@/components/brand-logo";
import { LoadError } from "@/components/load-error";
import { LobbyNotifier } from "@/components/lobby-notifier";
import { RequestNotifier } from "@/components/request-notifier";
import { TabTitle } from "@/components/tab-title";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { gateOf, getMe } from "@/lib/server-api";
import { resolveTheme } from "@/lib/theme";
import { LogoutButton } from "./logout-button";
import { SessionWatch } from "./session-watch";
import { SideNav } from "./side-nav";
import { TenantSwitcher } from "./tenant-switcher";
import { UserMenu } from "./user-menu";

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
  // AC-66/67: 2FA kodu, zorunlu şifre değişimi ve zorunlu 2FA kurulumu tamamlanmadan panel açılmaz (sunucu da uçları kapatır)
  const gate = gateOf(state);
  if (gate) redirect(gate);
  if (state.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const { user, tenant, permissions, actingTenant, logoUrl } = state.me;
  const logoOwner = actingTenant ?? tenant;
  // P8b-1: /ws/panel yalnız `support_requests.view` + tenant bağlamı varken (Super Admin firma seçmeli; sunucu da 403)
  const isSa = user.role === "SUPER_ADMIN";
  const notify = (permissions as readonly string[]).includes("support_requests.view") && (!isSa || Boolean(actingTenant));
  // P13b-L (AC-306, 310): lobi göstergesi yalnız `sessions.view`'e bağlı (talep yetkisinden bağımsız); firma seçmemiş
  // Super Admin'de çalışmaz (uç da 403). scopeKey değişirse (firma geçişi) temel çizgi yeniden alınır.
  const lobby = (permissions as readonly string[]).includes("sessions.view") && (!isSa || Boolean(actingTenant));

  return (
    // P9: sağlayıcı tüm kabuğu sarar (üst menüdeki firma geçişi de toast gösterir)
    <ToastProvider>
      <ThemeProvider initial={resolveTheme({ user: user.theme })}>
        <div className="flex min-h-dvh flex-col">
          <a
            href="#icerik"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
          >
            {t("panel.skip")}
          </a>
          <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
            {/* P12 (AC-81): etkin firmanın logosu, yoksa sistem logosu (sunucu çözer, `me.logoUrl` her zaman dolu) */}
            <LogoImage
              variant="mark"
              url={logoUrl}
              alt={logoOwner ? t("lg.alt", { name: logoOwner.name }) : t("app.systemLogoAlt")}
              testId="header-logo"
            />
            {/* TO-P9-1: Super Admin'de dar ekranda yer etkin firma adına ayrılır (uygulama adı sm+); sağ grupta yalnız seçici
            daralır (ad kısaltılır), avatar ve çıkış sabit genişlikte kalır → 375 px'te taşma yok */}
            <span className={`truncate text-sm font-semibold text-fg sm:inline sm:text-base ${isSa ? "hidden" : ""}`}>{t("app.name")}</span>
            <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
              {/* P9 (AC-70): Super Admin firma geçişi + etkin firma göstergesi */}
              {isSa && <TenantSwitcher acting={actingTenant} />}
              {/* TO-P2-3: avatar her genişlikte görünür; ad/rol/firma mobilde yalnız ekran okuyucuya (sr-only), sm+ görünür */}
              <div className="sr-only min-w-0 text-right sm:not-sr-only" data-testid="current-user">
                <p className="truncate text-sm font-medium text-fg">{user.fullName}</p>
                <p className="truncate text-xs text-fg-muted">
                  {t(`role.${user.role}`)}
                  {tenant ? ` · ${tenant.name}` : ""}
                </p>
              </div>
              {/* P12: avatar → hesap menüsü (Hesabım, Şifre değiştir, Tema, Çıkış); tek dokunuşla çıkış düğmesi yanında kalır */}
              <UserMenu name={user.fullName} email={user.email} avatarUrl={user.avatarUrl ?? null} />
              <LogoutButton userName={user.fullName} />
            </div>
          </header>
          <div className="flex flex-1 flex-col md:flex-row">
            <aside className="border-b border-border bg-surface md:w-60 md:shrink-0 md:border-r md:border-b-0">
              <SideNav permissions={permissions} role={user.role} />
            </aside>
            <main id="icerik" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
              {notify && <RequestNotifier enabled />}
              {lobby && <LobbyNotifier enabled scopeKey={`${user.id}:${(actingTenant ?? tenant)?.id ?? ""}`} />}
              <TabTitle />
              <SessionWatch />
              {children}
            </main>
          </div>
        </div>
      </ThemeProvider>
    </ToastProvider>
  );
}
