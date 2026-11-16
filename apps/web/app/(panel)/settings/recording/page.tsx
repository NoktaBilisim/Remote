import type { RecordingSettingsView } from "@remote/contracts/api/recording";
import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { TenantSettingsPage } from "../tenant-settings-page";
import { RecordingForm } from "./recording-form";

export const metadata: Metadata = { title: t("rset.title") };

/**
 * /settings/recording — P28e (mimari-p28e §5, §9; AC-380, 447; S-P28e-4/8): "Oturum kaydı" anahtarı (açarken aydınlatma
 * kutusu), saklama 1–90 gün (firma oturum saklama süresini aşamaz; kısaltma geriye uygulanmaz), depolama kullanımı,
 * "Gözetimsiz bağlantıları da kaydet" (ana anahtar açıkken; çalışan bilgilendirme kutusu + step-up), tek yönetici uyarısı.
 * Veri GET /settings/recording (settings.view), kayıt PUT (settings.edit). Yükleniyor/boş/hata/yetkisiz ortak kabukta.
 */
export default function RecordingSettingsPage() {
  return (
    <TenantSettingsPage<RecordingSettingsView>
      title={t("rset.title")}
      subtitle={t("rset.subtitle")}
      path="/settings/recording"
      render={(data, canEdit) => <RecordingForm initial={data} canEdit={canEdit} />}
    />
  );
}
