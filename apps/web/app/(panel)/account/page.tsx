import type { Metadata } from "next";
import { Palette, UserRound } from "lucide-react";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { AvatarUploader } from "@/components/branding/avatar-uploader";
import { ThemePicker } from "@/components/branding/theme-provider";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe } from "@/lib/server-api";
import { AccountSecurity } from "./account-security";

export const metadata: Metadata = { title: t("acc.title") };

/**
 * /account — Hesabım: hesap güvenliği (P10) + profil resmi ve tema (P12, AC-83/85): profil özeti, şifre değiştir (AC-66), iki adımlı doğrulama + kurtarma kodlarını
 * yenile (AC-67), tüm cihazlardan çıkış (AC-68, 115). Her oturumlu kullanıcı kendi hesabı için açar (yetki anahtarı yok).
 */
export default async function AccountPage() {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const { user, tenant, mfa } = me.me;
  return (
    <>
      <Breadcrumb items={[{ label: t("acc.title") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("acc.title")}</h1>
      <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("acc.subtitle")}</p>
      <div className="mt-6 grid max-w-5xl items-start gap-6 lg:grid-cols-[18rem_1fr]">
        <section aria-labelledby="acc-prof" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
          <h2 id="acc-prof" className="flex items-center gap-2 text-base font-semibold text-fg">
            <UserRound aria-hidden className="size-5 text-fg-muted" />
            {t("acc.profile")}
          </h2>
          {/* P12 (AC-83): kendi profil resmi — yükle (kare kırp), değiştir, kaldır */}
          <AvatarUploader userId="me" name={user.fullName} avatarUrl={user.avatarUrl ?? null} canEdit />
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-fg-muted">{t("us.f.fullName")}</dt>
              <dd className="font-medium break-words text-fg" data-testid="acc-name">
                {user.fullName}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("us.f.email")}</dt>
              <dd className="break-all text-fg">{user.email}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("us.f.role")}</dt>
              <dd className="text-fg">
                {t(`role.${user.role}`)}
                {tenant ? ` · ${tenant.name}` : ""}
              </dd>
            </div>
          </dl>
        </section>
        <div className="flex min-w-0 flex-col gap-6">
          {/* P12 (AC-85): tema tercihi — üst menüdeki seçimle aynı kaynak (ThemeProvider), anında uygulanır */}
          <section
            aria-labelledby="acc-app-h"
            className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
            data-testid="acc-appearance"
          >
            <h2 id="acc-app-h" className="flex items-center gap-2 text-base font-semibold text-fg">
              <Palette aria-hidden className="size-5 text-fg-muted" />
              {t("acc.appearance")}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">{t("acc.appearanceBody")}</p>
            <div className="mt-4">
              <ThemePicker testId="acc-theme" />
            </div>
          </section>
          {/* P27a (AC-329, K-P27a-2): hatırlanan cihazlar yalnız firma kullanıcılarında */}
          <AccountSecurity mfa={mfa ?? null} account={user.email} trustedDevices={user.role !== "SUPER_ADMIN"} />
        </div>
      </div>
    </>
  );
}
