import { ListPageSkeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /users yüklenirken: başlık, filtre ve 6 satırlık liste iskeleti. */
export default function Loading() {
  return <ListPageSkeleton testId="users-loading" label={t("panel.loading")} />;
}
