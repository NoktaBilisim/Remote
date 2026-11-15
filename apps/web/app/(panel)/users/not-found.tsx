import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { Breadcrumb } from "@/components/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n";

/** AC-220: `[id]` sayfasının notFound()'u buraya düşer; loading sınırı olmadığı için belge yanıtı gerçek 404. Başka tenant'ın veya olmayan kullanıcı id'si (sunucu 404) — varlığı sızdırmayan tek mesaj. */
export default function UserNotFound() {
  return (
    <>
      <Breadcrumb items={[{ label: t("nav.users"), href: "/users" }, { label: t("us.nf.title") }]} />
      <EmptyState
        Icon={SearchX}
        headingLevel={1}
        title={t("us.nf.title")}
        body={t("us.nf.body")}
        testId="user-not-found"
        action={
          <Link href="/users" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <ArrowLeft aria-hidden className="size-4" />
            {t("us.nf.back")}
          </Link>
        }
      />
    </>
  );
}
