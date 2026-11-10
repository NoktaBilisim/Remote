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
