import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { FilesForm } from "./files-form";

export const metadata: Metadata = { title: t("fset.title") };

/**
 * /settings/files — P28b (AC-354, 360, 362): "Dosyaları sunucu üzerinden aktar ve virüs tara" anahtarı, saklama süresi (1–7 gün),
 * açarken aydınlatma onayı, firma depolama kullanımı. Veri GET /settings/tenant (settings.view), kayıt PUT (settings.edit).
 */
export default function FilesSettingsPage() {
  return (
    <TenantSettingsPage
      title={t("fset.title")}
      subtitle={t("fset.subtitle")}
      render={(data, canEdit) => (
        <FilesForm
          initial={{
            fileServerMode: data.fileServerMode ?? false,
            fileRetentionDays: data.fileRetentionDays ?? 1,
            avReady: data.avReady ?? null,
            storage: data.storage ?? null,
          }}
          canEdit={canEdit}
        />
      )}
    />
  );
}
