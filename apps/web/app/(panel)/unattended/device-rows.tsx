import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { DeviceListItem } from "@/lib/unattended/contract";
import { ConnectButton } from "./connect-button";
import { DeviceBadges } from "./device-badges";

type RowProps = { items: DeviceListItem[]; available: boolean; busyId: string | null; onConnect: (id: string) => void };

const when = (iso: string | null) => (iso ? formatDateTime(iso) : <span className="text-fg-muted">{t("un.never")}</span>);
const th = "px-3 py-3 font-medium";
const td = "px-3 py-2 pt-4 whitespace-nowrap tabular-nums text-fg";

function NameLink({ d, className = "" }: { d: DeviceListItem; className?: string }) {
  return (
    <Link
      href={`/unattended/${d.id}`}
      className={`inline-flex min-h-11 max-w-full items-center gap-1 font-medium text-primary hover:underline ${className}`}
    >
      <span className="truncate" title={d.name}>
        {d.name}
      </span>
    </Link>
  );
}

type RowItemProps = { d: DeviceListItem; available: boolean; busy: boolean; onConnect: (id: string) => void };

function DeviceTableRow({ d, available, busy, onConnect }: RowItemProps) {
  return (
    <tr data-testid="un-row" data-id={d.id} className="align-top hover:bg-surface-muted">
      <td className="max-w-72 px-3 py-2">
        <NameLink d={d} />
        <DeviceBadges device={d} />
      </td>
      <td className="max-w-56 truncate px-3 py-2 pt-4 text-fg" title={d.customerName}>
        {d.customerName}
      </td>
      <td className={td}>{when(d.lastSeenAt)}</td>
      <td className={td}>{when(d.lastSessionAt)}</td>
      <td className={`${td} text-right`}>{formatNumber(d.grantCount)}</td>
      <td className="px-3 py-2">
        <ConnectButton device={d} available={available} busy={busy} onConnect={onConnect} />
      </td>
    </tr>
  );
}

function TableHead() {
  return (
    <thead className="bg-surface-muted text-xs text-fg-muted">
      <tr>
        <th scope="col" className={th}>
          {t("un.col.name")}
        </th>
        <th scope="col" className={th}>
          {t("un.col.customer")}
        </th>
        <th scope="col" className={th}>
          {t("un.col.lastSeen")}
        </th>
        <th scope="col" className={th}>
          {t("un.col.lastSession")}
        </th>
        <th scope="col" className={`${th} text-right`}>
          {t("un.col.grants")}
        </th>
        <th scope="col" className={th}>
          <span className="sr-only">{t("un.col.action")}</span>
        </th>
      </tr>
    </thead>
  );
}

/** ≥ lg tablo (kendi kabında yatay kayar). Satırın bağlantısı yalnız ad. */
function DeviceTable({ items, available, busyId, onConnect }: RowProps) {
  return (
    <div
      className="hidden overflow-x-auto rounded-lg border border-border bg-surface lg:block"
      tabIndex={0}
      role="region"
      aria-label={t("un.tableRegion")}
    >
      <table className="w-full text-left text-sm" data-testid="un-table">
        <caption className="sr-only">{t("un.tab.devices")}</caption>
        <TableHead />
        <tbody className="divide-y divide-border">
          {items.map((d) => (
            <DeviceTableRow key={d.id} d={d} available={available} busy={busyId === d.id} onConnect={onConnect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** < lg kart listesi (390 px'te taşma yok). */
function DeviceCards({ items, available, busyId, onConnect }: RowProps) {
  return (
    <ul className="flex flex-col gap-2 lg:hidden" data-testid="un-cards">
      {items.map((d) => (
        <li key={d.id} data-testid="un-card" data-id={d.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex min-w-0 items-center gap-1">
            <NameLink d={d} className="min-w-0 flex-1" />
            <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
          </div>
          <DeviceBadges device={d} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-fg-muted">{t("un.col.customer")}</dt>
            <dd className="min-w-0 truncate text-fg">{d.customerName}</dd>
            <dt className="text-fg-muted">{t("un.col.lastSeen")}</dt>
            <dd className="tabular-nums text-fg">{when(d.lastSeenAt)}</dd>
            <dt className="text-fg-muted">{t("un.col.lastSession")}</dt>
            <dd className="tabular-nums text-fg">{when(d.lastSessionAt)}</dd>
            <dt className="text-fg-muted">{t("un.col.grants")}</dt>
            <dd className="tabular-nums text-fg">{formatNumber(d.grantCount)}</dd>
          </dl>
          <div className="border-t border-border pt-2">
            <ConnectButton device={d} available={available} busy={busyId === d.id} onConnect={onConnect} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DeviceRows(p: RowProps) {
  return (
    <>
      <DeviceTable {...p} />
      <DeviceCards {...p} />
    </>
  );
}
