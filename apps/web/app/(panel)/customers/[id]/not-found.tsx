import { Building2, SearchX } from "lucide-react";
import Link from "next/link";
import { Breadcrumb } from "@/components/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n";

/** Yok ya da başka firmanın müşterisi (sunucu 404; AC-172 — varlık sızdırılmaz). */
export default function CustomerNotFound() {
  return (
    <>
      <Breadcrumb items={[{ label: t("nav.customers"), href: "/customers" }, { label: t("cu.notFoundTitle") }]} />
      <h1 className="sr-only">{t("cu.notFoundTitle")}</h1>
      <EmptyState
        Icon={SearchX}
        title={t("cu.notFoundTitle")}
        body={t("cu.notFoundBody")}
        testId="customer-not-found"
        action={
          <Link href="/customers" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline">
            <Building2 aria-hidden className="size-4" />
            {t("cu.back")}
          </Link>
        }
      />
    </>
  );
}
