import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /customers/[id] yüklenirken: başlık, bağlantı ve bilgi bölümleri iskeleti. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="customer-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-56" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-6 h-24 w-full max-w-3xl" />
      <Skeleton className="mt-6 h-40 w-full max-w-3xl" />
      <Skeleton className="mt-8 h-12 w-64" />
    </div>
  );
}
