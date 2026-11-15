import { ListPageSkeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** /admin/tenants yüklenirken: başlık, filtre ve 6 satırlık liste iskeleti. */
export default function Loading() {
  return <ListPageSkeleton testId="tenants-loading" label={t("panel.loading")} />;
}
