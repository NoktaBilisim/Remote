import type { ClientUpdateSettings } from "@remote/contracts/api/update";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { ClientUpdateForm } from "./client-update-form";

export const metadata: Metadata = { title: t("upd.set.title") };

/**
 * /settings/clients — P29 (mimari-p29 §4.8, §6; AC-485): tek anahtar "İstemcileri otomatik güncelle" (varsayılan Açık).
 * GET /settings/client-update (settings.view), PUT (settings.edit, step-up yok). Yükleniyor/hata/yetkisiz/firma seçilmedi
 * ortak kabukta (boş/kısmi bu ekranda uygulanmaz).
 */
export default function ClientUpdateSettingsPage() {
  return (
    <TenantSettingsPage<ClientUpdateSettings>
      title={t("upd.set.title")}
      subtitle={t("upd.set.subtitle")}
      path="/settings/client-update"
      render={(data, canEdit) => <ClientUpdateForm initial={data} canEdit={canEdit} />}
    />
  );
}
