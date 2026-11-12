import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { SupportRequestSettings } from "@/lib/requests/contract";
import { getMe, serverGet } from "@/lib/server-api";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: t("srs.title") };

/** /settings/support-requests — firma talep ayarları (P8b-1: AC-129, 131, 142, 150, 152). Tenant ayar ekranının ilk sayfası. */
export default async function SupportRequestSettingsPage() {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const header = (
    <>
      <Breadcrumb items={[{ label: t("nav.settings") }, { label: t("srs.title") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("srs.title")}</h1>
      <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("srs.subtitle")}</p>
    </>
  );
  if (!perms.includes("settings.edit")) {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl"><Alert tone="warning" testId="settings-forbidden">{t("srs.forbidden")}</Alert></div>
      </>
    );
  }
  if (me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant) {
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("srs.pickTenantBody")} testId="settings-pick-tenant" />
        </div>
      </>
    );
  }
  const res = await serverGet<SupportRequestSettings>("/settings/support-requests");
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error") {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? <Alert tone="warning" testId="settings-forbidden">{t("srs.forbidden")}</Alert> : <LoadError />}
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <SettingsForm initial={res.data} />
    </>
  );
}
