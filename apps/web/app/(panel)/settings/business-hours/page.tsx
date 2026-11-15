import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { istanbulDay } from "@/lib/format";
import type { BusinessHoursView } from "@/lib/requests/business-hours";
import { TenantSettingsPage } from "../tenant-settings-page";
import { BusinessHoursForm } from "./business-hours-form";
import { HolidaysSection } from "./holidays-section";

export const metadata: Metadata = { title: t("bh.title") };

/**
 * /settings/business-hours — mesai saatleri ve tatiller (P18, AC-258; mimari-e11 §8b.8). GET `settings.view`, yazma
 * `settings.edit` (yoksa salt okunur). Haftalık takvim sunucuda çekilir; tatiller yıl seçimiyle istemcide.
 */
export default function BusinessHoursPage() {
  return (
    <TenantSettingsPage<BusinessHoursView>
      title={t("bh.title")}
      subtitle={t("bh.subtitle")}
      path="/settings/business-hours"
      render={(data, canEdit) => (
        <div className="mt-6 flex max-w-3xl flex-col gap-6">
          <BusinessHoursForm initial={data} canEdit={canEdit} />
          <HolidaysSection initialYear={Number(istanbulDay().slice(0, 4))} canEdit={canEdit} />
        </div>
      )}
    />
  );
}
