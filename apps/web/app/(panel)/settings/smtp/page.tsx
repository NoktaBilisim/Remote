import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { SmtpForm } from "./smtp-form";

export const metadata: Metadata = { title: t("smtp.title") };

/** /settings/smtp — firma SMTP ayarları + "Test Maili Gönder" (AC-79, 80, 122; ortak standart §2.1). */
export default function SmtpSettingsPage() {
  return (
    <TenantSettingsPage
      title={t("smtp.title")}
      subtitle={t("smtp.subtitle")}
      render={(data, canEdit) => <SmtpForm initial={data.smtp} canEdit={canEdit} />}
    />
  );
}
