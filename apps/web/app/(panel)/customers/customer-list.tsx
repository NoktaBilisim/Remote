import { CUSTOMER_STATUS_LABELS } from "@remote/contracts/labels";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CopyLink } from "@/components/copy-link";
import type { CustomerListItem, CustomerStatus } from "@/lib/customers/contract";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";

/** Durum hapı (AC-166): renk tek başına anlam taşımaz — metin + nokta. */
export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  const cls = status === "ACTIVE" ? "bg-success-surface text-success" : "bg-surface-muted text-fg-muted";
  return (
    <span
      data-testid="customer-status"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {CUSTOMER_STATUS_LABELS[status]}
    </span>
  );
}

/** İndirme bağlantısı hücresi (AC-169): aktifte Kopyala + dosya adı; pasifte bağlantı gösterilmez. */
function LinkCell({ c }: { c: Pick<CustomerListItem, "name" | "downloadUrl" | "fileName" | "status"> }) {
  if (c.status === "PASSIVE" || !c.downloadUrl) {
    return (
      <span className="text-sm text-fg-muted" data-testid="customer-link-passive">
        {t("cu.linkPassive")}
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <CopyLink url={c.downloadUrl} srLabel={t("cu.copyFor", { name: c.name })} />
      {c.fileName && (
        <span className="max-w-64 truncate font-mono text-xs text-fg-muted" title={c.fileName}>
          {c.fileName}
        </span>
      )}
    </div>
  );
}

const lastRequest = (c: CustomerListItem) => (c.lastRequestAt ? formatDateTime(c.lastRequestAt) : <span className="text-fg-muted">—</span>);

/** Müşteri listesi (AC-166): ≥ md tablo (kendi kabında yatay kayar), dar ekranda kart. Satırın bağlantısı yalnız ad. */
export function CustomerList({ items }: { items: CustomerListItem[] }) {
  return (
    <>
      <div
        className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block"
        tabIndex={0}
        role="region"
        aria-label={t("cu.tableRegion")}
      >
        <table className="w-full text-left text-sm" data-testid="customers-table">
          <caption className="sr-only">{t("cu.title")}</caption>
          <thead className="bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("cu.col.name")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("cu.col.link")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("cu.col.created")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("cu.col.lastRequest")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                {t("cu.col.requests")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("cu.col.status")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((c) => (
              <tr key={c.id} data-testid="customer-row" className="align-top hover:bg-surface-muted">
                <td className="max-w-64 px-3 py-2">
                  <Link
                    href={`/customers/${c.id}`}
                    className="inline-flex min-h-11 max-w-full items-center font-medium text-primary hover:underline"
                  >
                    <span className="truncate" title={c.name}>
                      {c.name}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <LinkCell c={c} />
                </td>
                <td className="px-3 py-2 pt-4 whitespace-nowrap tabular-nums text-fg">{formatDateTime(c.createdAt)}</td>
                <td className="px-3 py-2 pt-4 whitespace-nowrap tabular-nums text-fg" data-testid="customer-last-request">
                  {lastRequest(c)}
                </td>
                <td className="px-3 py-2 pt-4 text-right tabular-nums text-fg" data-testid="customer-request-count">
                  {formatNumber(c.requestCount)}
                </td>
                <td className="px-3 py-2 pt-4">
                  <CustomerStatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden" data-testid="customers-cards">
        {items.map((c) => (
          <li key={c.id} data-testid="customer-card" className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/customers/${c.id}`}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-1 font-medium text-primary hover:underline"
              >
                <span className="truncate">{c.name}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0" />
              </Link>
              <div className="pt-3">
                <CustomerStatusBadge status={c.status} />
              </div>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-fg-muted">{t("cu.col.created")}</dt>
              <dd className="tabular-nums text-fg">{formatDateTime(c.createdAt)}</dd>
              <dt className="text-fg-muted">{t("cu.col.lastRequest")}</dt>
              <dd className="tabular-nums text-fg">{lastRequest(c)}</dd>
              <dt className="text-fg-muted">{t("cu.col.requests")}</dt>
              <dd className="tabular-nums text-fg">{formatNumber(c.requestCount)}</dd>
            </dl>
            <div className="mt-2 border-t border-border pt-2">
              <LinkCell c={c} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
