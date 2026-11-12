import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /users/[id] yüklenirken: profil kartı + yetki matrisi iskeleti (taslak 07 "Yükleniyor"). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="user-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="mb-4 h-4 w-56" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 grid gap-6 xl:grid-cols-[20rem_1fr]">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      </div>
    </div>
  );
}
