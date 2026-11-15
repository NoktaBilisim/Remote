import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import type { TenantSettingsView } from "@/lib/account/contract";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";

/**
 * /settings/smtp, /settings/security ve /settings/consent-text ortak sunucu kabuğu: GET `path` (settings.view). Yetki yok → uyarı;
 * Super Admin firma seçmemiş → boş durum; hata → Tekrar dene. `render(data, canEdit)` başarı durumunu çizer.
 */
export async function TenantSettingsPage<T = TenantSettingsView>({
  title,
  subtitle,
  render,
  path = "/settings/tenant",
}: {
  title: string;
  subtitle: string;
  render: (data: T, canEdit: boolean) => ReactNode;
  /** P11: veri ucu (vars. GET /settings/tenant; aydınlatma metni GET /settings/consent-text). */
  path?: string;
}) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const header = (
    <>
      <Breadcrumb items={[{ label: t("nav.settings"), href: "/settings/support-requests" }, { label: title }]} />
      <h1 className="text-2xl font-semibold text-fg">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-fg-muted">{subtitle}</p>
    </>
  );
  const forbidden = (
    <div className="mt-6 max-w-xl">
      <Alert tone="warning" testId="settings-forbidden">
        {t("srs.forbidden")}
      </Alert>
    </div>
  );
  if (!perms.includes("settings.view") && !perms.includes("settings.edit"))
    return (
      <>
        {header}
        {forbidden}
      </>
    );
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
  const res = await serverGet<T>(path);
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error") {
    return (
      <>
        {header}
        {res.status === 403 ? (
          forbidden
        ) : (
          <div className="mt-6 max-w-xl">
            <LoadError />
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {header}
      {render(res.data, perms.includes("settings.edit"))}
    </>
  );
}
