import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /history/[id] yüklenirken: başlık, özet + not, bölüm iskeletleri. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="history-detail-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-56" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-48" />
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="mt-8 h-40" />
      <Skeleton className="mt-8 h-56" />
    </div>
  );
}
