import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe } from "@/lib/server-api";
import { SystemTabs } from "./system-tabs";

/**
 * /admin/settings/* — Super Admin sistem ayarları (P11: AC-77, 78; ADR-0003). Rol kontrolü burada ve arka uçta (403);
 * Super Admin değilse alt sayfalar hiç çizilmez (veri istenmez).
 */
export default async function SystemSettingsLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const header = (
    <>
      <Breadcrumb items={[{ label: t("sys.title") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("sys.title")}</h1>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-fg-muted">{t("sys.subtitle")}</p>
    </>
  );
  if (me.me.user.role !== "SUPER_ADMIN") {
    return (
      <>
        {header}
        <div className="max-w-xl">
          <Alert tone="warning" testId="system-forbidden">
            {t("sys.forbidden")}
          </Alert>
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <SystemTabs />
      {children}
    </>
  );
}
