import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: t("fp.title") };

/** /forgot-password — e-posta ile şifre sıfırlama bağlantısı isteği (AC-66). Oturumsuz; yanıt hesabın varlığını sızdırmaz. */
export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("fp.title")}</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">{t("fp.subtitle")}</p>
      <ForgotForm />
    </>
  );
}
