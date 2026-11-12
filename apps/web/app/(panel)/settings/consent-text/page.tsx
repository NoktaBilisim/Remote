import type { Metadata } from "next";
import type { ConsentTextSettings } from "@/lib/admin-settings/contract";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: t("ct.title") };

/** /settings/consent-text — firma aydınlatma metni: güncel sürüm, yeni sürüm kaydı, sürüm geçmişi (P11; AC-29, 127). */
export default function ConsentTextPage() {
  return (
    <TenantSettingsPage<ConsentTextSettings>
      title={t("ct.title")}
      subtitle={t("ct.subtitle")}
      path="/settings/consent-text"
      render={(data, canEdit) => <ConsentForm initial={data} canEdit={canEdit} />}
    />
  );
}
