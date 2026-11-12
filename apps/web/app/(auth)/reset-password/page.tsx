import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: t("rp.title") };

/**
 * /reset-password#token=… — e-postadaki bağlantıyla yeni şifre (AC-66; 30 dk, tek kullanımlık). Token URL parçasında
 * (#) gelir: sunucuya/Caddy loguna/Referer'a gitmez; sayfa okuyunca adres çubuğundan siler.
 */
export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("rp.title")}</h1>
      <ResetForm />
    </>
  );
}
