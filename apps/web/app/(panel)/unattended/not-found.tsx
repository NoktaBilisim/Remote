import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { Breadcrumb } from "@/components/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { t } from "@/lib/i18n";

/**
 * K12 (AC-220 deseni): `[id]` sayfasının notFound()'u buraya düşer; iskelet yalnız `(list)` grubunu sardığı için belge
 * yanıtı gerçek 404. Yok / başka tenant / grant'sız cihaz için varlığı sızdırmayan tek mesaj.
 */
export default function UnattendedNotFound() {
  return (
    <>
      <Breadcrumb items={[{ label: t("nav.unattended"), href: "/unattended" }, { label: t("un.nf.title") }]} />
      <EmptyState
        Icon={SearchX}
        headingLevel={1}
        title={t("un.nf.title")}
        body={t("un.nf.body")}
        testId="un-not-found"
        action={
          <Link href="/unattended" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <ArrowLeft aria-hidden className="size-4" />
            {t("un.nf.back")}
          </Link>
        }
      />
    </>
  );
}
