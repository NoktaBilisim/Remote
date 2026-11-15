import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";

/** Liste sayfalarındaki metin bağlantısı (boş durum eylemi, sayfalama). */
export const LIST_LINK_CLS = "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline";

/** Liste sayfası başı: breadcrumb + başlık + açıklama + sağda eylemler (kullanıcılar, müşteriler, firmalar). */
export function ListPageHeader({
  title,
  subtitle,
  crumb,
  actions,
}: {
  title: string;
  subtitle: string;
  crumb: string;
  actions?: ReactNode;
}) {
  return (
    <>
      <Breadcrumb items={[{ label: crumb }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{subtitle}</p>
        </div>
        {actions}
      </div>
    </>
  );
}

/** Başlık altındaki dar uyarı / hata alanı (yetki yok, yükleme hatası). */
export function ListNotice({ children }: { children: ReactNode }) {
  return <div className="mt-6 max-w-xl">{children}</div>;
}

/** Bağlantı eylemli boş durum ("İlk sayfaya dön", "Filtreleri temizle" …). */
export function LinkEmpty({
  Icon,
  title,
  body,
  testId,
  href,
  label,
}: {
  Icon: LucideIcon;
  title: string;
  body: string;
  testId: string;
  href: string;
  label: string;
}) {
  const action = (
    <Link href={href} className={LIST_LINK_CLS}>
      {label}
    </Link>
  );
  return <EmptyState Icon={Icon} title={title} body={body} testId={testId} action={action} />;
}

/** Liste altı: toplam sayısı (`role=status`) + sayfa > 1 ise önceki / "Sayfa x / y" / sonraki bağlantıları. */
export function ListFooter({
  count,
  countTestId,
  page,
  pages,
  hrefFor,
}: {
  count: string;
  countTestId: string;
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-fg-muted tabular-nums" role="status" data-testid={countTestId}>
        {count}
      </p>
      {pages > 1 && (
        <nav aria-label={t("h.pager")} className="flex items-center gap-2 text-sm">
          {page > 1 && (
            <Link href={hrefFor(Math.min(page - 1, pages))} rel="prev" className={LIST_LINK_CLS}>
              <ChevronLeft aria-hidden className="size-4" />
              {t("h.prev")}
            </Link>
          )}
          <span className="px-1 tabular-nums text-fg" aria-current="page">
            {t("h.pageOf", { page: formatNumber(page), pages: formatNumber(pages) })}
          </span>
          {page < pages && (
            <Link href={hrefFor(page + 1)} rel="next" className={LIST_LINK_CLS}>
              {t("h.next")}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
