import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { SecurityForm } from "./security-form";

export const metadata: Metadata = { title: t("sec.title") };

/** /settings/security — teknisyenler için 2FA zorunluluğu (AC-67; tenant `requireTech2fa`). */
export default function SecuritySettingsPage() {
  return <TenantSettingsPage title={t("sec.title")} subtitle={t("sec.subtitle")} render={(data, canEdit) => <SecurityForm initial={data.requireTech2fa} canEdit={canEdit} />} />;
}
