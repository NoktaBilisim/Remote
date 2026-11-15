import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /request-blocks yüklenirken: başlık, filtre ve 3 satır iskeleti. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="blocks-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-6 h-12 w-64" />
      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
