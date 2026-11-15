import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** Cihaz ayrıntısı yüklenirken: başlık, rozet, bilgi ve yetki iskeleti. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="un-detail-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-48" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-6 w-56" />
      <Skeleton className="mt-8 h-40 w-full max-w-3xl" />
      <Skeleton className="mt-6 h-56 w-full max-w-3xl" />
    </div>
  );
}
