import { ListPageSkeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /unattended ve /unattended/codes yüklenirken liste iskeleti. */
export default function Loading() {
  return <ListPageSkeleton testId="un-loading" label={t("panel.loading")} />;
}
