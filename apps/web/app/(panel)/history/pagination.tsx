"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SelectField } from "@/components/ui/select-field";
import { formatNumber } from "@/lib/format";
import { historyHref, PAGE_SIZES, pageCount, type HistoryFilters } from "@/lib/history/query";
import { t } from "@/lib/i18n";

const pagerBtn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-surface-muted";
const pagerOff = "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-fg-muted cursor-not-allowed";

/** Sayfa bilgisi + önceki/sonraki bağlantıları + sayfa boyutu (25 varsayılan, ≤ 100; AC-60). Hepsi URL'de. */
export function Pagination({ filters, total, shown }: { filters: HistoryFilters; total: number; shown: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const pages = pageCount(total, filters.pageSize);
  const first = (filters.page - 1) * filters.pageSize + 1;
  const sizes = PAGE_SIZES.includes(filters.pageSize as (typeof PAGE_SIZES)[number]) ? PAGE_SIZES : [...PAGE_SIZES, filters.pageSize].sort((a, b) => a - b);
  const prev = filters.page > 1 ? historyHref({ ...filters, page: Math.min(filters.page - 1, pages) }) : null;
  const next = filters.page < pages ? historyHref({ ...filters, page: filters.page + 1 }) : null;

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="pagination">
      <p className="text-sm text-fg-muted tabular-nums" role="status" data-testid="history-count">
        {shown === 0
          ? t("h.countZero")
          : t("h.count", { total: formatNumber(total), start: formatNumber(first), end: formatNumber(first + shown - 1) })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          label={t("h.pageSize")}
          hideLabel
          value={String(filters.pageSize)}
          disabled={pending}
          onChange={(e) => start(() => router.push(historyHref({ ...filters, page: 1, pageSize: Number(e.target.value) })))}
          options={sizes.map((n) => ({ value: String(n), label: t("h.rows", { n }) }))}
          data-testid="page-size"
        />
        <nav aria-label={t("h.pager")} className="flex items-center gap-2">
          {prev ? (
            <Link href={prev} className={pagerBtn} rel="prev">
              <ChevronLeft aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">{t("h.prev")}</span>
            </Link>
          ) : (
            <span className={pagerOff} aria-disabled="true">
              <ChevronLeft aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">{t("h.prev")}</span>
            </span>
          )}
          <span className="px-1 text-sm tabular-nums text-fg" aria-current="page" data-testid="page-of">
            {t("h.pageOf", { page: formatNumber(filters.page), pages: formatNumber(pages) })}
          </span>
          {next ? (
            <Link href={next} className={pagerBtn} rel="next">
              <span className="sr-only sm:not-sr-only">{t("h.next")}</span>
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <span className={pagerOff} aria-disabled="true">
              <span className="sr-only sm:not-sr-only">{t("h.next")}</span>
              <ChevronRight aria-hidden className="size-4" />
            </span>
          )}
        </nav>
      </div>
    </div>
  );
}
