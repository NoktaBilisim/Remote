/** Yükleniyor iskeleti (DESIGN.md §7): surface-muted + pulse. Boyut className ile verilir. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-muted ${className}`} />;
}
