import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /sessions yüklenirken: başlık, filtre ve 4 satırlık tablo iskeleti. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="sessions-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-full max-w-lg" />
      <Skeleton className="mt-6 h-11 w-64" />
      <div className="mt-4 flex flex-col gap-px overflow-hidden rounded-lg border border-border">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-none" />
        ))}
      </div>
    </div>
  );
}
