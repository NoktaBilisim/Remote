import type { ClamavSettingsView } from "@remote/contracts/api/clamav";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { settingsPageError } from "../page-error";
import { ClamavForm } from "./clamav-form";

export const metadata: Metadata = { title: `${t("sys.tab.clamav")} · ${t("sys.title")}` };

/** /admin/settings/clamav — P28b (AC-353, 361): virüs tarama sunucusu, port, "Bağlantıyı Test Et", imza yaşı uyarısı. */
export default async function ClamavSettingsPage() {
  const res = await serverGet<ClamavSettingsView>("/admin/settings/clamav");
  if (res.kind === "error") return settingsPageError(res.status);
  return <ClamavForm initial={res.data} />;
}
