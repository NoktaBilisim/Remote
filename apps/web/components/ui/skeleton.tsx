/** Yükleniyor iskeleti (DESIGN.md §7): surface-muted + pulse. Boyut className ile verilir. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-muted ${className}`} />;
}

/**
 * Liste sayfası yüklenirken (kullanıcılar, firmalar): konum + başlık + açıklama, filtre satırı ve 6 satırlık liste
 * iskeleti. Ekran okuyucu metni çağıranın `label`'ıdır (`t("panel.loading")`).
 */
export function ListPageSkeleton({ testId, label }: { testId: string; label: string }) {
  return (
    <div aria-busy="true" aria-live="polite" data-testid={testId}>
      <span className="sr-only">{label}</span>
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
