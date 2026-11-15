import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import type { MysqlSettingsView } from "@/lib/admin-settings/contract";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { MysqlForm } from "./mysql-form";

export const metadata: Metadata = { title: `${t("sys.tab.mysql")} · ${t("sys.title")}` };

/** /admin/settings/mysql — MySQL bağlantı ayarı + "Bağlantıyı Test Et" (AC-77, 78; ortak standart §1.2; ADR-0003). */
export default async function MysqlSettingsPage() {
  const res = await serverGet<MysqlSettingsView>("/admin/settings/mysql");
  if (res.kind === "error") {
    if (res.status === 401) redirect(EXPIRED_LOGIN_PATH);
    return (
      <div className="max-w-xl">
        {res.status === 403 ? (
          <Alert tone="warning" testId="system-forbidden">
            {t("sys.forbidden")}
          </Alert>
        ) : (
          <LoadError />
        )}
      </div>
    );
  }
  return <MysqlForm initial={res.data} />;
}
