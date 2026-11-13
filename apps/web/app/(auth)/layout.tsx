import type { PublicBrandingResponse } from "@remote/contracts/api/branding";
import { headers } from "next/headers";
import { BrandLogo, LogoImage } from "@/components/brand-logo";
import { TENANT_HEADER } from "@/lib/branding/constants";
import { t } from "@/lib/i18n";
import { publicGet } from "@/lib/server-api";

/**
 * Giriş ve şifre ekranları için ortak, ortalanmış kabuk. AC-82: logo her zaman görünür — `?tenant=<slug>` ile gelinmişse
 * (proxy doğrular, başlıkla iletir) o firmanın logosu, değilse Super Admin'in sistem logosu, o da yoksa / API'ye
 * ulaşılamazsa Nokta logosu. Sunucuda çözülür → logo sonradan değişmez (flaş yok). İstemci IP'si iletilir (B-P12-1):
 * server'ın 60/dk/IP limiti ziyaretçi başına işler, bir kişinin isteği başkasının logosunu düşürmez.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const slug = (await headers()).get(TENANT_HEADER);
  const res = await publicGet<PublicBrandingResponse>(`/public/branding${slug ? `?tenant=${encodeURIComponent(slug)}` : ""}`);
  const brand = res.kind === "ok" ? res.data : null;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {brand ? (
            <LogoImage variant="full" url={brand.logoUrl} alt={brand.name ? t("lg.alt", { name: brand.name }) : t("app.systemLogoAlt")} testId="login-logo" />
          ) : (
            <span data-testid="login-logo" data-logo="system" className="inline-flex">
              <BrandLogo variant="full" />
            </span>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-md sm:p-8">{children}</div>
      </div>
    </main>
  );
}
