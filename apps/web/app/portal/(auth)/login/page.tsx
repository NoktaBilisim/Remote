import { PORTAL_SESSION_COOKIE } from "@remote/contracts/api/portal";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { t } from "@/lib/i18n";
import { PORTAL_CHANGE_PASSWORD, PORTAL_HOME, validSlug } from "@/lib/portal/paths";
import { getPortalMe } from "@/lib/portal/server";
import { PortalLoginForm } from "./portal-login-form";

export const metadata: Metadata = { title: t("portal.login.title"), referrer: "no-referrer" };

type Search = Promise<{ tenant?: string; reason?: string }>;

/**
 * /portal/login?tenant=<slug> (AC-262; r2 S-P21-3): giriş firmaya bağlıdır. Slug yoksa/biçimsizse form yerine "bağlantıyı
 * isteyin" metni. Geçerli portal oturumuyla gelinirse portala (ya da zorunlu şifre değişimine) yönlenir.
 */
export default async function PortalLoginPage({ searchParams }: { searchParams: Search }) {
  const { tenant, reason } = await searchParams;
  if ((await cookies()).has(PORTAL_SESSION_COOKIE)) {
    const s = await getPortalMe();
    if (s.kind === "ok") redirect(s.me.user.mustChangePassword ? PORTAL_CHANGE_PASSWORD : PORTAL_HOME);
  }
  const slug = validSlug(tenant);
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("portal.login.title")}</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">{t("portal.login.subtitle")}</p>
      {reason === "expired" && (
        <div className="mb-4">
          <Alert tone="warning">{t("portal.login.expired")}</Alert>
        </div>
      )}
      {reason === "logout" && (
        <div className="mb-4">
          <Alert tone="success">{t("portal.login.loggedOut")}</Alert>
        </div>
      )}
      {slug ? (
        <PortalLoginForm tenantSlug={slug} />
      ) : (
        <Alert tone="warning" testId="portal-no-tenant">
          {t("portal.login.noTenant")}
        </Alert>
      )}
    </>
  );
}
