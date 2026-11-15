import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe } from "@/lib/server-api";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: t("cu.imp.title") };

/**
 * /customers/import — CSV'den müşteri içe aktarma (P19 AC-263; mimari-e11 §8c.5, §8c.8). Üç adım: dosya → önizleme →
 * sonuç. Yetki: `customers.import` + `create` + `view` birlikte (S-P19-14); "Güncelle" ayrıca `customers.edit`.
 */
export default async function CustomerImportPage() {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const allowed = ["customers.import", "customers.create", "customers.view"].every((p) => perms.includes(p));
  const header = (
    <>
      <Breadcrumb items={[{ label: t("nav.customers"), href: "/customers" }, { label: t("cu.imp.title") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("cu.imp.title")}</h1>
      <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("cu.imp.subtitle")}</p>
    </>
  );
  if (!allowed)
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl">
          <Alert tone="warning" testId="import-forbidden">
            {t("cu.imp.forbidden")}
          </Alert>
        </div>
      </>
    );
  if (me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant)
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("cu.pickTenantBody")} testId="import-pick-tenant" />
        </div>
      </>
    );
  return (
    <>
      {header}
      <ImportWizard canEdit={perms.includes("customers.edit")} />
    </>
  );
}
