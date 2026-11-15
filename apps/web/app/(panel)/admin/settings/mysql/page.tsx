import type { Metadata } from "next";
import type { MysqlSettingsView } from "@/lib/admin-settings/contract";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { settingsPageError } from "../page-error";
import { MysqlForm } from "./mysql-form";

export const metadata: Metadata = { title: `${t("sys.tab.mysql")} · ${t("sys.title")}` };

/** /admin/settings/mysql — MySQL bağlantı ayarı + "Bağlantıyı Test Et" (AC-77, 78; ortak standart §1.2; ADR-0003). */
export default async function MysqlSettingsPage() {
  const res = await serverGet<MysqlSettingsView>("/admin/settings/mysql");
  if (res.kind === "error") return settingsPageError(res.status);
  return <MysqlForm initial={res.data} />;
}
