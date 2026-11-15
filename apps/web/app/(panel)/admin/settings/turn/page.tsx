import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import type { TurnSettingsView } from "@/lib/admin-settings/contract";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { TurnForm } from "./turn-form";

export const metadata: Metadata = { title: `${t("sys.tab.turn")} · ${t("sys.title")}` };

/** /admin/settings/turn — TURN adresleri + paylaşılan gizli anahtar; "Ortam değerlerine dön" (AC-78, G-13, ADR-0007). */
export default async function TurnSettingsPage() {
  const res = await serverGet<TurnSettingsView>("/admin/settings/turn");
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
  return <TurnForm initial={res.data} />;
}
