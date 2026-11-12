import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="settings-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-56" />
      <Skeleton className="h-8 w-64" />
      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
