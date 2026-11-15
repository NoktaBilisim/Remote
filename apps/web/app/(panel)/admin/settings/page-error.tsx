import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";

/**
 * Sistem ayarı sayfası yükleme hatası: 401 → giriş; 403 → yetki uyarısı (`system-forbidden`); diğer → `LoadError`.
 * Bileşen değil, sayfa işlevinin içinde çağrılır (yönlendirme sayfanın kendisinden atılır, eskisi gibi).
 */
export function settingsPageError(status: number) {
  if (status === 401) redirect(EXPIRED_LOGIN_PATH);
  return (
    <div className="max-w-xl">
      {status === 403 ? (
        <Alert tone="warning" testId="system-forbidden">
          {t("sys.forbidden")}
        </Alert>
      ) : (
        <LoadError />
      )}
    </div>
  );
}
