import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaSetup } from "@/components/account/mfa-setup";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { gateOf, getMe } from "@/lib/server-api";

export const metadata: Metadata = { title: t("mfa.s.title") };

/**
 * /2fa/setup — 2FA kurulumu (AC-67). Zorunluysa (Super Admin/Admin; teknisyen için firma ayarı) ve kurulmamışsa panel
 * kabuğu buraya yönlendirir (kapı); kullanıcı isterse Hesap güvenliği sayfasından da gelir. Etkinse hesap sayfasına döner.
 */
export default async function MfaSetupPage() {
  const state = await getMe();
  if (state.kind === "unauthenticated") redirect(EXPIRED_LOGIN_PATH);
  if (state.kind === "error") return <LoadError />;
  const gate = gateOf(state);
  if (gate === "/login/2fa" || gate === "/change-password") redirect(gate);
  if (state.kind === "ok" && state.me.mfa?.enabled && state.me.mfa.stage !== "verify") redirect("/account");
  const forced = gate === "/2fa/setup";
  const account = state.kind === "ok" ? state.me.user.email : "";
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("mfa.s.title")}</h1>
      <p className="mt-1 mb-4 text-sm text-fg-muted">{t("mfa.s.subtitle")}</p>
      {forced && (
        <div className="mb-4">
          <Alert tone="warning" testId="mfa-required">
            {t("mfa.s.required")}
          </Alert>
        </div>
      )}
      <MfaSetup gate={forced} account={account} doneHref={forced ? "/" : "/account"} />
    </>
  );
}
