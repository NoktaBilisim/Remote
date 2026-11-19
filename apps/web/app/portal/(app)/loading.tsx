import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** Portal sayfaları yüklenirken iskelet (sunucu verisi gelene dek; düzen kayması olmasın diye kart/sekme/satır yerleri). */
export default function PortalLoading() {
  return (
    <div aria-busy="true" data-testid="portal-loading" className="flex flex-col gap-4">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-11 w-72" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
