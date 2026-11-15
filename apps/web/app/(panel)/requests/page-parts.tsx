import Link from "next/link";
import { ChevronLeft, ChevronRight, Globe, History, Inbox, Layers, Monitor, UserCheck, UserRoundX, type LucideIcon } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { labelOf, REQUEST_SOURCE_LABELS, REQUEST_STATUS_LABELS } from "@remote/contracts/labels";
import { t } from "@/lib/i18n";
import { CLOSED_STATUSES, type SupportRequestItem } from "@/lib/requests/contract";
import { RequestCustomerFilter } from "./customer-filter";
import { RequestHistory } from "./request-history";
import { RequestQueue } from "./request-queue";
import { href, linkFor, PAGE_SIZE, type RequestsQuery } from "./query";
import { SoundToggle } from "./sound-toggle";

/* /requests sunucu çizim parçaları: başlık, sekmeler + filtreler, hata bandı, Geçmiş bölümü (page.tsx). */

const tabCls = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm font-medium ${
    active ? "bg-primary-surface text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
  }`;

export function RequestsHeader() {
  return (
    <>
      <Breadcrumb items={[{ label: t("nav.requests") }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{t("rq.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("rq.subtitle")}</p>
        </div>
        <SoundToggle />
      </div>
    </>
  );
}

/** Yetki yok (`requests-forbidden`) bandı; sayfa girişi ve 403 yanıtı. */
export function Forbidden() {
  return (
    <Alert tone="warning" testId="requests-forbidden">
      {t("rq.forbidden")}
    </Alert>
  );
}

export function ListError({ status }: { status: number }) {
  return <div className="mt-6 max-w-xl">{status === 403 ? <Forbidden /> : <LoadError />}</div>;
}

function Tabs({ q }: { q: RequestsQuery }) {
  const link = linkFor(q);
  return (
    <nav aria-label={t("rq.tabs")} className="mt-6 inline-flex rounded-md border border-border bg-surface p-1 shadow-sm">
      <Link
        href={link("pending", undefined, 1, q.customer)}
        aria-current={q.tab === "pending" ? "page" : undefined}
        className={tabCls(q.tab === "pending")}
      >
        <Inbox aria-hidden className="size-4" />
        {t("rq.tab.pending")}
      </Link>
      <Link
        href={link("history", undefined, 1, q.customer)}
        aria-current={q.tab === "history" ? "page" : undefined}
        className={tabCls(q.tab === "history")}
      >
        <History aria-hidden className="size-4" />
        {t("rq.tab.history")}
      </Link>
    </nav>
  );
}

type Opt<V> = readonly [V | undefined, string, LucideIcon];

/** Seçenek bağlantıları (kaynak / atama filtresi); seçili olan `aria-current="page"`. */
function OptionNav<V extends string>({
  label,
  testId,
  options,
  current,
  hrefOf,
}: {
  label: string;
  testId: string;
  options: readonly Opt<V>[];
  current: V | undefined;
  hrefOf: (v: V | undefined) => string;
}) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap gap-1" data-testid={testId}>
      {options.map(([v, text, Icon]) => (
        <Link
          key={v ?? "all"}
          href={hrefOf(v)}
          aria-current={current === v ? "page" : undefined}
          className={`${tabCls(current === v)} border border-border`}
        >
          <Icon aria-hidden className="size-4" />
          {text}
        </Link>
      ))}
    </nav>
  );
}

/** Sekmeler, müşteri filtresi, kaynak filtresi ve (yalnız bekleyenlerde) atama filtresi. */
export function RequestFilters({ q, selectedName }: { q: RequestsQuery; selectedName?: string }) {
  const link = linkFor(q);
  const st = q.tab === "history" ? q.status : undefined;
  return (
    <>
      <Tabs q={q} />
      <div className="mt-4">
        <RequestCustomerFilter value={q.customer} selectedName={selectedName} basePath={link(q.tab, st, 1, undefined, q.assigned)} />
      </div>
      <OptionNav
        label={t("rq.src.filter")}
        testId="source-filter"
        options={[
          [undefined, t("rq.src.all"), Layers],
          ["AGENT", REQUEST_SOURCE_LABELS.AGENT, Monitor],
          ["WEB", REQUEST_SOURCE_LABELS.WEB, Globe],
        ]}
        current={q.source}
        hrefOf={(v) => href(q.tab, st, 1, q.customer, q.assigned, v)}
      />
      {q.tab === "pending" && (
        <OptionNav
          label={t("rq.as.filter")}
          testId="assigned-filter"
          options={[
            [undefined, t("rq.as.fAll"), Inbox],
            ["me", t("rq.as.fMe"), UserCheck],
            ["none", t("rq.as.fNone"), UserRoundX],
          ]}
          current={q.assigned}
          hrefOf={(v) => link("pending", undefined, 1, q.customer, v)}
        />
      )}
    </>
  );
}

function StatusNav({ q }: { q: RequestsQuery }) {
  const link = linkFor(q);
  return (
    <nav aria-label={t("rq.h.filter")} className="flex flex-wrap gap-1" data-testid="history-status-filter">
      {[undefined, ...CLOSED_STATUSES].map((s) => (
        <Link
          key={s ?? "all"}
          href={link("history", s, 1, q.customer)}
          aria-current={q.status === s ? "page" : undefined}
          className={`${tabCls(q.status === s)} border border-border`}
        >
          {s ? labelOf(REQUEST_STATUS_LABELS, s) : t("rq.h.all")}
        </Link>
      ))}
    </nav>
  );
}

function HistoryEmpty({ q }: { q: RequestsQuery }) {
  const filtered = q.status || q.customer || q.source;
  return (
    <EmptyState
      Icon={History}
      title={filtered ? t("rq.h.emptyFilterTitle") : t("rq.h.emptyTitle")}
      body={t("rq.h.emptyBody")}
      testId="requests-history-empty"
      action={
        filtered && (
          <Link href={linkFor(q)("history")} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
            {t("rq.h.all")}
          </Link>
        )
      }
    />
  );
}

const pagerLinkCls = "inline-flex min-h-11 items-center gap-1 font-medium text-primary";

function HistoryPager({ q, pages }: { q: RequestsQuery; pages: number }) {
  const link = linkFor(q);
  return (
    <nav aria-label={t("rq.h.pages")} className="mt-4 flex items-center justify-between gap-2 text-sm text-fg-muted">
      {q.page > 1 ? (
        <Link href={link("history", q.status, q.page - 1, q.customer)} className={pagerLinkCls}>
          <ChevronLeft aria-hidden className="size-4" />
          {t("h.prev")}
        </Link>
      ) : (
        <span />
      )}
      <span className="tabular-nums">{t("rq.h.page", { page: q.page, pages })}</span>
      {q.page < pages ? (
        <Link href={link("history", q.status, q.page + 1, q.customer)} className={pagerLinkCls}>
          {t("h.next")}
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Geçmiş sekmesi (son 30 gün): durum filtresi, liste / boş durum, sayfalama. */
export function HistorySection({
  q,
  items,
  total,
  canRevoke,
  canBlock,
}: {
  q: RequestsQuery;
  items: SupportRequestItem[];
  total: number;
  canRevoke: boolean;
  canBlock: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <section className="mt-6" aria-label={t("rq.tab.history")}>
      <StatusNav q={q} />
      <div className="mt-4">
        {items.length === 0 ? <HistoryEmpty q={q} /> : <RequestHistory items={items} canRevoke={canRevoke} canBlock={canBlock} />}
      </div>
      {total > PAGE_SIZE && <HistoryPager q={q} pages={pages} />}
    </section>
  );
}

interface PendingSectionProps {
  q: RequestsQuery;
  items: SupportRequestItem[];
  perms: readonly string[];
  meId: string;
  canRevoke: boolean;
  canBlock: boolean;
}

/** Bekleyenler sekmesi: canlı kuyruk; filtre değişince (`key`) yeniden kurulur. */
export function PendingSection({ q, items, perms, meId, canRevoke, canBlock }: PendingSectionProps) {
  return (
    <section className="mt-6" aria-label={t("rq.tab.pending")}>
      <RequestQueue
        key={`${q.customer ?? "all"}:${q.assigned ?? "all"}:${q.source ?? "all"}`}
        initial={items}
        canAccept={perms.includes("support_requests.accept")}
        canSettings={perms.includes("settings.edit")}
        canRevoke={canRevoke}
        canBlock={canBlock}
        customer={q.customer}
        meId={meId}
        assigned={q.assigned}
        source={q.source}
        canAssign={perms.includes("support_requests.assign")}
        canMessage={perms.includes("support_requests.message")}
      />
    </section>
  );
}
