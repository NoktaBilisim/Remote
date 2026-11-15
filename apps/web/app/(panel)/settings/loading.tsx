import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/**
 * Ayarlar sayfaları yüklenirken (alt menü layout'ta sabit kalır). P14b AC-220: genel `(panel)/loading.tsx` kaldırıldı
 * (404'ü 200'e çeviren Suspense sınırı); ayar sayfalarında `[id]` segmenti olmadığından iskelet burada güvenli.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="settings-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <div className="mt-6 flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
        <Skeleton className="h-5 w-40" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    </div>
  );
}
