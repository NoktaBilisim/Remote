import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { Avatar } from "@/components/ui/avatar";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe } from "@/lib/server-api";
import { AccountSecurity } from "./account-security";

export const metadata: Metadata = { title: t("acc.title") };

/**
 * /account — Hesap güvenliği (P10): profil özeti, şifre değiştir (AC-66), iki adımlı doğrulama + kurtarma kodlarını
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
          <Avatar name={user.fullName} size="lg" />
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-fg-muted">{t("us.f.fullName")}</dt>
              <dd className="font-medium break-words text-fg" data-testid="acc-name">{user.fullName}</dd>
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
        <AccountSecurity mfa={mfa ?? null} />
      </div>
    </>
  );
}
