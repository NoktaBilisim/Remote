import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { RetentionForm } from "./retention-form";
import { SecurityForm } from "./security-form";

export const metadata: Metadata = { title: t("sec.title") };

/** /settings/security — teknisyenler için 2FA zorunluluğu (AC-67; tenant `requireTech2fa`) + P27a 2FA cihaz hatırlama (AC-331; `mfaRememberDevice`) + P13a veri saklama süresi (AC-197; `retentionDays`). */
export default function SecuritySettingsPage() {
  return (
    <TenantSettingsPage
      title={t("sec.title")}
      subtitle={t("sec.subtitle")}
      render={(data, canEdit) => (
        <div className="mt-6 flex flex-col gap-6">
          <SecurityForm
            initial={{ requireTech2fa: data.requireTech2fa, mfaRememberDevice: data.mfaRememberDevice ?? true }}
            canEdit={canEdit}
          />
          <RetentionForm initial={data.retentionDays} canEdit={canEdit} />
        </div>
      )}
    />
  );
}
