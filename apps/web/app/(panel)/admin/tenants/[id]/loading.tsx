import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /admin/tenants/[id] yüklenirken: konum çubuğu, başlık ve kalıcı silme kartı iskeleti. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="tenant-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-48" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 flex max-w-3xl flex-col gap-3 rounded-lg border border-border p-4 sm:p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-36" />
      </div>
    </div>
  );
}
