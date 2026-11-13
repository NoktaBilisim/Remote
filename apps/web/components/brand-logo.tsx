import { DEFAULT_LOGO_URL } from "@remote/contracts/api/branding";
import { t } from "@/lib/i18n";

/*
 * Nokta Bilişim sistem logosu (NOKTA_LOGO'dan kopya, std. §1.5).
 * Logodaki siyah "nokta" yazısı koyu temada okunmaz → her zaman açık zeminli kartta.
 */
export function BrandLogo({ variant }: { variant: "full" | "mark" }) {
  if (variant === "mark") {
    return (
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-logo-surface p-1">
        <img src="/img/nokta-kucuk.png" alt={t("app.systemLogoAlt")} width={284} height={259} className="h-auto w-full" />
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-lg bg-logo-surface px-3 py-2">
      <img src="/img/logo.png" alt={t("app.systemLogoAlt")} width={1100} height={400} className="h-16 w-auto" />
    </span>
  );
}

/**
 * P12 (AC-81, 82): yüklenmiş logo (firma veya Super Admin'in sistem logosu) — açık zeminli kartta (koyu temada da
 * okunur, std. §1.5). Varsayılan logo URL'sinde ya da logo yokken Nokta logosu (`BrandLogo`). Boyut sabit kutu +
 * `object-contain` (oran korunur, CSP: satır içi stil yok).
 */
export function LogoImage({ url, alt, variant, testId }: { url: string | null | undefined; alt: string; variant: "full" | "mark"; testId?: string }) {
  if (!url || url === DEFAULT_LOGO_URL) {
    return (
      <span data-testid={testId} data-logo="system" className="inline-flex">
        <BrandLogo variant={variant} />
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      data-logo="custom"
      className={`inline-flex shrink-0 items-center justify-center bg-logo-surface ${variant === "mark" ? "h-9 max-w-32 rounded-md px-1.5 py-1" : "h-20 max-w-full rounded-lg px-3 py-2"}`}
    >
      <img src={url} alt={alt} className={`w-auto object-contain ${variant === "mark" ? "h-7 max-w-28" : "h-16 max-w-64"}`} />
    </span>
  );
}
