import type { PortalPage, PortalRequestItem, PortalSessionItem } from "@remote/contracts/api/portal";
import { ChevronRight, Inbox, LifeBuoy, MonitorSmartphone } from "lucide-react";
import Link from "next/link";
import { ListFooter, LIST_LINK_CLS } from "@/components/list-page";
import { LoadError } from "@/components/load-error";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { ServerResult } from "@/lib/server-api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { PORTAL_NEW_REQUEST } from "@/lib/portal/paths";
import { pagesOf, portalHref, requestFacts, sessionFacts, type PortalTab } from "@/lib/portal/view";
import { RequestStatusBadge } from "../../(panel)/requests/request-card";

const th = "px-3 py-2 text-left text-xs font-medium text-fg-muted";
const td = "px-3 py-2 align-middle text-sm text-fg";
const cardCls = "flex min-h-11 items-center gap-3 rounded-md border border-border bg-surface p-3 hover:bg-surface-muted";

type Res<T> = ServerResult<PortalPage<T>>;

/** Sekmeler: bağlantı (sorgu `?tab=`), `aria-current`; sayaç ya da "yüklenemedi" (kısmi durum görünür). */
export function PortalTabs({ tab, rq, ss }: { tab: PortalTab; rq: Res<PortalRequestItem>; ss: Res<PortalSessionItem> }) {
  const label = (r: Res<unknown>, bare: string, n: (x: number) => string) =>
    r.kind === "ok" ? n(r.data.total) : t("portal.tabs.failed", { tab: bare });
  const tabs = [
    {
      key: "requests" as const,
      Icon: Inbox,
      text: label(rq, t("portal.tabs.requestsBare"), (n) => t("portal.tabs.requests", { n: formatNumber(n) })),
    },
    {
      key: "sessions" as const,
      Icon: MonitorSmartphone,
      text: label(ss, t("portal.tabs.sessionsBare"), (n) => t("portal.tabs.sessions", { n: formatNumber(n) })),
    },
  ];
  return (
    <nav aria-label={t("portal.tabs.label")} className="mb-4 border-b border-border" data-testid="portal-tabs">
      <ul className="-mb-px flex gap-1">
        {tabs.map(({ key, Icon, text }) => (
          <li key={key} className="min-w-0">
            <Link
              href={portalHref(key)}
              aria-current={tab === key ? "page" : undefined}
              data-testid={`portal-tab-${key}`}
              className={`flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap ${
                tab === key ? "border-primary text-primary" : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Footer({ tab, data }: { tab: PortalTab; data: PortalPage<unknown> }) {
  return (
    <ListFooter
      count={t("portal.count", { n: formatNumber(data.total) })}
      countTestId={`portal-${tab}-count`}
      page={data.page}
      pages={pagesOf(data.total, data.pageSize)}
      hrefFor={(p) => portalHref(tab, p)}
    />
  );
}

export function RequestsPanel({ res }: { res: Res<PortalRequestItem> }) {
  if (res.kind === "error") return <LoadError />;
  const { items } = res.data;
  if (items.length === 0)
    return (
      <EmptyState
        Icon={Inbox}
        title={t("portal.rq.empty")}
        body={t("portal.rq.emptyBody")}
        testId="portal-requests-empty"
        action={
          // S-P21-12: düz <a> — tam yükleme (yeni talep sayfasında display-capture=(self))
          <a href={PORTAL_NEW_REQUEST} className={LIST_LINK_CLS}>
            <LifeBuoy aria-hidden className="size-4" />
            {t("portal.new.title")}
          </a>
        }
      />
    );
  return (
    <div data-testid="portal-requests">
      <table className="hidden w-full border-collapse overflow-hidden rounded-lg border border-border bg-surface md:table">
        <thead className="border-b border-border bg-surface-muted">
          <tr>
            <th className={th}>{t("portal.col.code")}</th>
            <th className={th}>{t("portal.col.created")}</th>
            <th className={th}>{t("portal.col.status")}</th>
            <th className={th}>{t("portal.col.source")}</th>
            <th className={th}>{t("portal.col.requester")}</th>
            <th className={th}>
              <span className="sr-only">{t("portal.rq.detail")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const f = requestFacts(r);
            return (
              <tr key={r.id} className="border-b border-border last:border-b-0" data-testid="portal-rq-row">
                <td className={`${td} font-mono`}>{r.requestCode}</td>
                <td className={td}>{f.created}</td>
                <td className={td}>
                  <RequestStatusBadge status={r.status} />
                </td>
                <td className={td}>{f.source}</td>
                <td className={`${td} wrap-anywhere`}>{f.requester}</td>
                <td className={`${td} text-right`}>
                  <Link href={`/portal/requests/${r.id}`} className={LIST_LINK_CLS} aria-label={t("portal.open", { label: r.requestCode })}>
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((r) => {
          const f = requestFacts(r);
          return (
            <li key={r.id}>
              <Link href={`/portal/requests/${r.id}`} className={cardCls} data-testid="portal-rq-card">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-fg">{r.requestCode}</span>
                    <RequestStatusBadge status={r.status} />
                  </span>
                  <span className="text-xs text-fg-muted">
                    {f.created} · {f.source}
                  </span>
                </div>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
      <Footer tab="requests" data={res.data} />
    </div>
  );
}

export function SessionsPanel({ res }: { res: Res<PortalSessionItem> }) {
  if (res.kind === "error") return <LoadError />;
  const { items } = res.data;
  if (items.length === 0)
    return (
      <EmptyState Icon={MonitorSmartphone} title={t("portal.ss.empty")} body={t("portal.ss.emptyBody")} testId="portal-sessions-empty" />
    );
  return (
    <div data-testid="portal-sessions">
      <table className="hidden w-full border-collapse overflow-hidden rounded-lg border border-border bg-surface md:table">
        <thead className="border-b border-border bg-surface-muted">
          <tr>
            <th className={th}>{t("portal.col.created")}</th>
            <th className={th}>{t("portal.col.status")}</th>
            <th className={th}>{t("portal.col.technician")}</th>
            <th className={th}>{t("portal.col.duration")}</th>
            <th className={th}>{t("portal.col.ticket")}</th>
            <th className={th}>
              <span className="sr-only">{t("portal.ss.detail")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const f = sessionFacts(s);
            return (
              <tr key={s.id} className="border-b border-border last:border-b-0" data-testid="portal-ss-row">
                <td className={td}>{f.created}</td>
                <td className={td}>
                  <StatusBadge status={s.status} />
                </td>
                <td className={`${td} wrap-anywhere`}>{f.technician}</td>
                <td className={td}>{f.duration}</td>
                <td className={`${td} font-mono`}>{f.ticket}</td>
                <td className={`${td} text-right`}>
                  <Link href={`/portal/sessions/${s.id}`} className={LIST_LINK_CLS} aria-label={t("portal.open", { label: f.created })}>
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((s) => {
          const f = sessionFacts(s);
          return (
            <li key={s.id}>
              <Link href={`/portal/sessions/${s.id}`} className={cardCls} data-testid="portal-ss-card">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-fg">{f.created}</span>
                    <StatusBadge status={s.status} />
                  </span>
                  <span className="text-xs text-fg-muted wrap-anywhere">
                    {f.technician} · {f.duration}
                  </span>
                </div>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
      <Footer tab="sessions" data={res.data} />
    </div>
  );
}
