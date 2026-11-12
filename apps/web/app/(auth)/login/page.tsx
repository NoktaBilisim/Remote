import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { t } from "@/lib/i18n";
import { gateOf, getMe } from "@/lib/server-api";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: t("login.title") };

type Search = Promise<{ next?: string; reason?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const { next, reason } = await searchParams;
  // T-3: geçerli oturumla /login → panel. Yalnız /auth/me 200 ise; 401/hata → form (döngü yok)
  if ((await cookies()).has(SESSION_COOKIE)) {
    const state = await getMe();
    // P10: yarı oturum (2FA bekleniyor / zorunlu kurulum) → ilgili adım
    if (state.kind === "ok" || state.kind === "mfa") redirect(gateOf(state) ?? "/");
  }
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("login.title")}</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">{t("login.subtitle")}</p>
      {reason === "expired" && (
        <div className="mb-4">
          <Alert tone="warning">{t("login.sessionExpired")}</Alert>
        </div>
      )}
      {reason === "reset" && (
        <div className="mb-4">
          <Alert tone="success">{t("login.passwordReset")}</Alert>
        </div>
      )}
      {reason === "logout" && (
        <div className="mb-4">
          <Alert tone="success">{t("login.loggedOut")}</Alert>
        </div>
      )}
      <LoginForm next={next ?? null} />
    </>
  );
}
