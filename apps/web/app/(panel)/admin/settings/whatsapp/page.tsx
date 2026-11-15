import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import type { WhatsappServiceView } from "@/lib/admin-settings/whatsapp";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { WhatsappForm } from "./whatsapp-form";

export const metadata: Metadata = { title: `${t("sys.tab.whatsapp")} · ${t("sys.title")}` };

/** /admin/settings/whatsapp — sistem düzeyi WhatsApp bildirim servisi adresi + "Test Mesajı Gönder" (AC-196, §2.2). */
export default async function WhatsappSettingsPage() {
  const res = await serverGet<WhatsappServiceView>("/admin/settings/whatsapp");
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
  return <WhatsappForm initial={res.data} />;
}
