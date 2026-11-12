import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { gateOf, getMe } from "@/lib/server-api";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: t("pw.title") };

/** AC-66: ilk girişte zorunlu şifre değişimi (P1). Oturum yoksa login'e döner. */
export default async function ChangePasswordPage() {
  const state = await getMe();
  if (state.kind === "unauthenticated") redirect(EXPIRED_LOGIN_PATH);
  if (state.kind === "error") return <LoadError />;
  // P10: 2FA kodu girilmeden şifre ekranı açılmaz (yarı oturum)
  if (state.kind === "mfa") redirect(gateOf(state) ?? "/login/2fa");
  if (gateOf(state) === "/login/2fa") redirect("/login/2fa");
  if (state.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);

  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("pw.title")}</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">
        {state.me.user.mustChangePassword ? t("pw.subtitle") : t("pw.nextHint")}
      </p>
      <ChangePasswordForm />
    </>
  );
}
