"use client";

import { KeyRound, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { ThemePicker } from "@/components/branding/theme-provider";
import { Avatar } from "@/components/ui/avatar";
import { closeMenu, Menu } from "@/components/ui/menu";
import { t } from "@/lib/i18n";
import { useLogout } from "./logout-button";

const itemCls =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Hesap menüsü (P12, AC-85; ortak std. §1.6): avatar tetikleyici → ad/e-posta, Hesabım, Şifre değiştir (T-2), Tema
 * (Açık/Koyu/Sistem — seçince menü açık kalır, etki anında görünür), Çıkış. Anında açılır (sık kullanılan menü).
 */
export function UserMenu({ name, email, avatarUrl }: { name: string; email: string; avatarUrl: string | null }) {
  const { logout, pending, failed } = useLogout();
  return (
    <Menu
      variant="avatar"
      align="end"
      testId="user-menu"
      label={t("um.trigger", { name })}
      ariaLabel={t("um.trigger", { name })}
      panelLabel={t("um.panel")}
      icon={<Avatar name={name} src={avatarUrl} testId="current-user-avatar" />}
    >
      <div className="flex min-w-0 items-center gap-3 px-3 pt-2 pb-3">
        <Avatar name={name} src={avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{name}</p>
          <p className="truncate text-xs text-fg-muted">{email}</p>
        </div>
      </div>
      <div className="border-t border-border pt-1">
        <Link href="/account" className={itemCls} onClick={(e) => closeMenu(e.currentTarget)} data-testid="account-link">
          <UserRound aria-hidden className="size-4" />
          {t("um.account")}
        </Link>
        <Link href="/account#pw-h" className={itemCls} onClick={(e) => closeMenu(e.currentTarget)} data-testid="user-menu-password">
          <KeyRound aria-hidden className="size-4" />
          {t("um.password")}
        </Link>
      </div>
      <div className="mt-1 border-t border-border px-2 pt-2 pb-2">
        <p className="pb-1 text-xs font-medium text-fg-muted">{t("theme.label")}</p>
        <ThemePicker compact testId="user-menu-theme" />
      </div>
      <div className="border-t border-border pt-1">
        {failed && <p role="alert" className="px-3 py-1 text-xs font-medium text-danger">{t("panel.logoutFailed")}</p>}
        <button type="button" className={itemCls} onClick={() => void logout()} disabled={pending} aria-busy={pending || undefined} data-testid="user-menu-logout">
          <LogOut aria-hidden className="size-4" />
          {pending ? t("panel.loggingOut") : t("panel.logout")}
        </button>
      </div>
    </Menu>
  );
}
