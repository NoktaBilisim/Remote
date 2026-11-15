import { ListPageSkeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /unattended ve /unattended/codes yüklenirken liste iskeleti. `(list)` grubunda: `[id]` sarılmaz → notFound() gerçek 404 (K12, AC-220 deseni). */
export default function Loading() {
  return <ListPageSkeleton testId="un-loading" label={t("panel.loading")} />;
}
