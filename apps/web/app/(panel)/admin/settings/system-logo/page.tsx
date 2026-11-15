import type { PublicBrandingResponse } from "@remote/contracts/api/branding";
import { Image as ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoUploader } from "@/components/branding/logo-uploader";
import { LoadError } from "@/components/load-error";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import { Section } from "../section";

export const metadata: Metadata = { title: `${t("sys.tab.logo")} · ${t("sys.title")}` };

/**
 * /admin/settings/system-logo — Super Admin sistem logosu (AC-82). Geçerli logo herkese açık uçtan okunur. P15 (AC-233):
 * "Logoyu kaldır" (onaylı) → DELETE → login/PDF varsayılan Nokta logosuna döner.
 */
export default async function SystemLogoPage() {
  const res = await serverGet<PublicBrandingResponse>("/public/branding");
  if (res.kind === "error") {
    if (res.status === 401) redirect(EXPIRED_LOGIN_PATH);
    return (
      <div className="max-w-xl">
        <LoadError />
      </div>
    );
  }
  return (
    <div className="max-w-3xl">
      <Section id="sl" title={t("sl.title")} Icon={ImageIcon}>
        <p className="text-sm text-fg-muted">{t("sl.subtitle")}</p>
        <LogoUploader
          endpoint="/admin/settings/system-logo"
          logoUrl={res.data.logoUrl}
          alt={t("sl.alt")}
          canEdit
          removable
          savedMessage={t("sl.saved")}
          texts={{ none: t("sl.none"), removeTitle: t("sl.removeTitle"), removeBody: t("sl.removeBody"), removed: t("sl.removed") }}
          testId="system-logo-uploader"
        />
      </Section>
    </div>
  );
}
