import { History, SearchX } from "lucide-react";
import Link from "next/link";
import { Breadcrumb } from "@/components/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n";

/** Kapsam dışı ya da var olmayan oturum (sunucu 404; AC-61 — varlık sızdırılmaz). */
export default function HistoryNotFound() {
  return (
    <>
      <Breadcrumb items={[{ label: t("nav.history"), href: "/history" }, { label: t("h.d.notFoundTitle") }]} />
      <h1 className="sr-only">{t("h.d.notFoundTitle")}</h1>
      <EmptyState
        Icon={SearchX}
        title={t("h.d.notFoundTitle")}
        body={t("h.d.notFoundBody")}
        testId="history-not-found"
        action={
          <Link href="/history" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline">
            <History aria-hidden className="size-4" />
            {t("h.d.back")}
          </Link>
        }
      />
    </>
  );
}
