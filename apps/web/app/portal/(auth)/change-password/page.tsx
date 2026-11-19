import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { t } from "@/lib/i18n";
import { PORTAL_HOME } from "@/lib/portal/paths";
import { getPortalMe, portalExpiredLogin } from "@/lib/portal/server";
import { PortalPasswordForm } from "../../portal-password-form";

export const metadata: Metadata = { title: t("portal.pw.title") };

/** /portal/change-password — ilk girişte / Admin sıfırlamasından sonra zorunlu şifre değişimi (AC-262). */
export default async function PortalChangePasswordPage() {
  const s = await getPortalMe();
  if (s.kind === "unauthenticated") redirect(await portalExpiredLogin());
  if (s.kind === "error") return <LoadError />;
  if (!s.me.user.mustChangePassword) redirect(PORTAL_HOME);
  return (
    <>
      <h1 className="text-xl font-semibold text-fg">{t("portal.pw.title")}</h1>
      <p className="mt-1 mb-6 text-sm text-fg-muted">{t("portal.pw.subtitle")}</p>
      <PortalPasswordForm />
    </>
  );
}
