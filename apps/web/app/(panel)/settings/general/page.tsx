import type { Metadata } from "next";
import { ChatParagraphBanner } from "@/components/settings/chat-paragraph-banner";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { LimitsForm } from "./limits-form";

export const metadata: Metadata = { title: t("gen.title") };

/** /settings/general — firma oturum ve dosya sınırları (P14b AC-224; tenant `sessionTtlMin`, `maxActiveHours`, `maxOpenSessions`, `maxFileMb`). */
export default function GeneralSettingsPage() {
  return (
    <TenantSettingsPage
      title={t("gen.title")}
      subtitle={t("gen.subtitle")}
      banner={<ChatParagraphBanner />}
      render={(data, canEdit) => <LimitsForm initial={data} canEdit={canEdit} />}
    />
  );
}
