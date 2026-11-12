import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /admin/tenants yüklenirken: başlık, filtre ve 6 satırlık liste iskeleti. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="tenants-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:justify-between">
        <Skeleton className="h-16 w-full max-w-md" />
        <Skeleton className="h-12 w-72" />
      </div>
      <div className="mt-4 flex flex-col gap-px overflow-hidden rounded-lg border border-border">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
