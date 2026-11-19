"use client";

import type { Theme } from "@remote/contracts/api/auth";
import { PORTAL_TENANT_COOKIE, type PortalMe } from "@remote/contracts/api/portal";
import { LogOut, UserCog } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ThemePicker, ThemeProvider } from "@/components/branding/theme-provider";
import { Avatar } from "@/components/ui/avatar";
import { closeMenu, Menu } from "@/components/ui/menu";
import { ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { portalApi, portalExpiredPath } from "@/lib/portal/api";
import { PORTAL_ACCOUNT, portalLoginPath, tenantSlugFromCookieString } from "@/lib/portal/paths";

const savePortalTheme = (theme: Theme) => portalApi<PortalMe>("PATCH", "/portal/me", { theme });
const expired = () => portalExpiredPath();

/** Tema tercihi portal kullanıcısının kaydında (`PATCH /portal/me`; std. §1.6); panel `ThemeProvider` kaydetme ucuyla. */
export function PortalThemeProvider({ initial, children }: { initial: Theme; children: ReactNode }) {
  return (
    <ThemeProvider initial={initial} save={savePortalTheme} expiredPath={expired}>
      {children}
    </ThemeProvider>
  );
}

/** Portal çıkışı: `POST /portal/auth/logout` → firmanın giriş adresi (`reason=logout`). 401 de çıkış sayılır. */
function usePortalLogout() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const logout = async () => {
    setPending(true);
    setFailed(false);
    const slug = tenantSlugFromCookieString(document.cookie, PORTAL_TENANT_COOKIE);
    try {
      await portalApi<void>("POST", "/portal/auth/logout", {});
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        setPending(false);
        setFailed(true);
        return;
      }
    }
    window.location.assign(portalLoginPath(slug, "logout"));
  };
  return { logout, pending, failed };
}

const itemCls =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60";

/** Portal hesap menüsü: baş harf rozeti (avatar yüklemesi yok, K-P21-10), Hesabım (`UserCog`), Tema, Çıkış (`LogOut`). */
export function PortalUserMenu({ name, email }: { name: string; email: string }) {
  const { logout, pending, failed } = usePortalLogout();
  return (
    <Menu
      variant="avatar"
      align="end"
      testId="portal-user-menu"
      label={t("portal.menu", { name })}
      ariaLabel={t("portal.menu", { name })}
      panelLabel={t("portal.menuPanel")}
      icon={<Avatar name={name} testId="portal-avatar" />}
    >
      <div className="flex min-w-0 items-center gap-3 px-3 pt-2 pb-3">
        <Avatar name={name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{name}</p>
          <p className="truncate text-xs text-fg-muted">{email}</p>
        </div>
      </div>
      <div className="border-t border-border pt-1">
        <Link href={PORTAL_ACCOUNT} className={itemCls} onClick={(e) => closeMenu(e.currentTarget)} data-testid="portal-account-link">
          <UserCog aria-hidden className="size-4" />
          {t("portal.account")}
        </Link>
      </div>
      <div className="mt-1 border-t border-border px-2 pt-2 pb-2">
        <p className="pb-1 text-xs font-medium text-fg-muted">{t("theme.label")}</p>
        <ThemePicker compact testId="portal-menu-theme" />
      </div>
      <div className="border-t border-border pt-1">
        {failed && (
          <p role="alert" className="px-3 py-1 text-xs font-medium text-danger">
            {t("portal.logoutFailed")}
          </p>
        )}
        <button
          type="button"
          className={itemCls}
          onClick={() => void logout()}
          disabled={pending}
          aria-busy={pending || undefined}
          data-testid="portal-logout"
        >
          <LogOut aria-hidden className="size-4" />
          {pending ? t("portal.loggingOut") : t("portal.logout")}
        </button>
      </div>
    </Menu>
  );
}
