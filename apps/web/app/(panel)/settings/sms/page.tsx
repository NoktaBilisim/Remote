import type { SmsSettingsView } from "@remote/contracts/api/notify";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { SmsForm } from "./sms-form";

export const metadata: Metadata = { title: t("sms.title") };

/** /settings/sms — firma SMS (smsportal) ayarı + "Test SMS Gönder" (P19 AC-260; ortak standart §2.3; mimari-e11 §8c.4). */
export default function SmsSettingsPage() {
  return (
    <TenantSettingsPage<SmsSettingsView>
      title={t("sms.title")}
      subtitle={t("sms.subtitle")}
      path="/settings/sms"
      render={(data, canEdit) => <SmsForm initial={data} canEdit={canEdit} />}
    />
  );
}
