import type { Metadata } from "next";
import { LogoUploader } from "@/components/branding/logo-uploader";
import { Alert } from "@/components/ui/alert";
import { t } from "@/lib/i18n";
import { getMe } from "@/lib/server-api";
import { TenantSettingsPage } from "../tenant-settings-page";

export const metadata: Metadata = { title: t("lg.title") };

/** /settings/logo — firma logosu yükle (önizlemeli) / değiştir / kaldır (AC-81, 84; settings.edit). */
export default async function LogoSettingsPage() {
  const me = await getMe();
  const owner = me.kind === "ok" ? (me.me.actingTenant ?? me.me.tenant) : null;
  return (
    <TenantSettingsPage
      title={t("lg.title")}
      subtitle={t("lg.subtitle")}
      render={(data, canEdit) => (
        <section aria-label={t("lg.title")} className="mt-6 flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
          {!canEdit && <Alert tone="warning" testId="settings-readonly">{t("set.readonly")}</Alert>}
          <LogoUploader
            endpoint="/settings/logo"
            logoUrl={data.logoUrl ?? null}
            alt={t("lg.alt", { name: owner?.name ?? "" })}
            canEdit={canEdit}
            removable
            savedMessage={t("lg.saved")}
          />
        </section>
      )}
    />
  );
}
