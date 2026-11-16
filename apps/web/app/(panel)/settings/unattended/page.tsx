import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import type { UnattendedPolicyView } from "@/lib/unattended/contract";
import { TenantSettingsPage } from "../tenant-settings-page";
import { PolicyForm } from "./policy-form";

export const metadata: Metadata = { title: t("un.policy.title") };

/**
 * /settings/unattended — P28u (§5.2, §10; AC-436): "İzin istemeden bağlanmaya izin ver" firma politikası. Veri
 * GET /unattended/policy (`unattended.manage` ∧ `settings.view`; yoksa 403 → yetki uyarısı), kayıt PUT (`settings.edit`; açarken
 * aydınlatma kutusu + step-up). Super Admin firma seçmemişse boş durum (ortak kabuk).
 */
export default function UnattendedPolicyPage() {
  return (
    <TenantSettingsPage<UnattendedPolicyView>
      title={t("un.policy.title")}
      subtitle={t("un.policy.subtitle")}
      path="/unattended/policy"
      render={(data, canEdit) => <PolicyForm initial={data} canEdit={canEdit} />}
    />
  );
}
