import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronLeft, ChevronRight, History, Inbox } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { labelOf, REQUEST_STATUS_LABELS } from "@remote/contracts/labels";
import { t } from "@/lib/i18n";
import { CLOSED_STATUSES, type RequestStatus, type SupportRequestList } from "@/lib/requests/contract";
import { getMe, serverGet } from "@/lib/server-api";
import { RequestCard } from "./request-card";
import { RequestQueue } from "./request-queue";
import { SoundToggle } from "./sound-toggle";

export const metadata: Metadata = { title: t("nav.requests") };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAGE_SIZE = 25;

function href(tab: "pending" | "history", status?: string, page = 1) {
  const q = new URLSearchParams();
  if (tab === "history") q.set("tab", "history");
  if (status) q.set("status", status);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/requests?${s}` : "/requests";
}

const tabCls = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm font-medium ${
    active ? "bg-primary-surface text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
  }`;

/**
 * /requests — müşteri destek talepleri (P8b-1: AC-146..149, 153, 157). Bekleyenler canlı (istemci + /ws/panel),
 * Geçmiş (son 30 gün, durum filtresi) sunucuda çizilir. Kapsam ve yetki arka uçta da denetlenir (tenantScope).
 */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const sp = await searchParams;
  const tab = one(sp.tab) === "history" ? "history" : "pending";
  const rawStatus = one(sp.status);
  const status = (CLOSED_STATUSES as readonly string[]).includes(rawStatus ?? "") ? (rawStatus as RequestStatus) : undefined;
  const pageRaw = Number(one(sp.page));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1;

  const header = (
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

  if (!perms.includes("support_requests.view")) {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl"><Alert tone="warning" testId="requests-forbidden">{t("rq.forbidden")}</Alert></div>
      </>
    );
  }
  if (me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant) {
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("rq.pickTenantBody")} testId="requests-pick-tenant" />
        </div>
      </>
    );
  }

  const path =
    tab === "pending"
      ? "/support-requests?tab=pending"
      : `/support-requests?tab=history${status ? `&status=${status}` : ""}&page=${page}&pageSize=${PAGE_SIZE}`;
  const res = await serverGet<SupportRequestList>(path);
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);

  const tabs = (
    <nav aria-label={t("rq.tabs")} className="mt-6 inline-flex rounded-md border border-border bg-surface p-1 shadow-sm">
      <Link href={href("pending")} aria-current={tab === "pending" ? "page" : undefined} className={tabCls(tab === "pending")}>
        <Inbox aria-hidden className="size-4" />
        {t("rq.tab.pending")}
      </Link>
      <Link href={href("history")} aria-current={tab === "history" ? "page" : undefined} className={tabCls(tab === "history")}>
        <History aria-hidden className="size-4" />
        {t("rq.tab.history")}
      </Link>
    </nav>
  );

  if (res.kind === "error") {
    return (
      <>
        {header}
        {tabs}
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? <Alert tone="warning" testId="requests-forbidden">{t("rq.forbidden")}</Alert> : <LoadError />}
        </div>
      </>
    );
  }

  if (tab === "pending") {
    return (
      <>
        {header}
        {tabs}
        <section className="mt-6" aria-label={t("rq.tab.pending")}>
          <RequestQueue initial={res.data.items} canAccept={perms.includes("support_requests.accept")} canSettings={perms.includes("settings.edit")} />
        </section>
      </>
    );
  }

  const { items, total } = res.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <>
      {header}
      {tabs}
      <section className="mt-6" aria-label={t("rq.tab.history")}>
        <nav aria-label={t("rq.h.filter")} className="flex flex-wrap gap-1" data-testid="history-status-filter">
          {[undefined, ...CLOSED_STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={href("history", s)}
              aria-current={status === s ? "page" : undefined}
              className={`${tabCls(status === s)} border border-border`}
            >
              {s ? labelOf(REQUEST_STATUS_LABELS, s) : t("rq.h.all")}
            </Link>
          ))}
        </nav>
        <div className="mt-4">
          {items.length === 0 ? (
            <EmptyState
              Icon={History}
              title={status ? t("rq.h.emptyFilterTitle") : t("rq.h.emptyTitle")}
              body={t("rq.h.emptyBody")}
              testId="requests-history-empty"
              action={
                status && (
                  <Link href={href("history")} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
                    {t("rq.h.all")}
                  </Link>
                )
              }
            />
          ) : (
            <ol className="flex flex-col gap-4" aria-label={t("rq.tab.history")}>
              {items.map((it) => (
                <li key={it.id}>
                  <RequestCard item={it} />
                </li>
              ))}
            </ol>
          )}
        </div>
        {total > PAGE_SIZE && (
          <nav aria-label={t("rq.h.pages")} className="mt-4 flex items-center justify-between gap-2 text-sm text-fg-muted">
            {page > 1 ? (
              <Link href={href("history", status, page - 1)} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary">
                <ChevronLeft aria-hidden className="size-4" />
                {t("h.prev")}
              </Link>
            ) : <span />}
            <span className="tabular-nums">{t("rq.h.page", { page, pages })}</span>
            {page < pages ? (
              <Link href={href("history", status, page + 1)} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary">
                {t("h.next")}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : <span />}
          </nav>
        )}
      </section>
    </>
  );
}
