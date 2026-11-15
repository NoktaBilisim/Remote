import type { Metadata } from "next";
import type { WhatsappServiceView } from "@/lib/admin-settings/whatsapp";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { settingsPageError } from "../page-error";
import { WhatsappForm } from "./whatsapp-form";

export const metadata: Metadata = { title: `${t("sys.tab.whatsapp")} · ${t("sys.title")}` };

/** /admin/settings/whatsapp — sistem düzeyi WhatsApp bildirim servisi adresi + "Test Mesajı Gönder" (AC-196, §2.2). */
export default async function WhatsappSettingsPage() {
  const res = await serverGet<WhatsappServiceView>("/admin/settings/whatsapp");
  if (res.kind === "error") return settingsPageError(res.status);
  return <WhatsappForm initial={res.data} />;
}
