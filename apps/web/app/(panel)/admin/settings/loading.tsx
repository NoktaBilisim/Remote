import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** Sistem ayarları sekmesi yüklenirken: iki bölüm kartı iskeleti. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="system-loading" className="flex max-w-3xl flex-col gap-6">
      <span className="sr-only">{t("panel.loading")}</span>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ))}
    </div>
  );
}
