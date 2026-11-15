import type { RequestBlockListResponse } from "@remote/contracts/api/request-blocks";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { AddBlockButton, BlockList, BlocksEmpty } from "./block-list";

export const metadata: Metadata = { title: t("bl.title") };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAGE_SIZE = 25;

function href(expired: boolean, page = 1) {
  const q = new URLSearchParams();
  if (expired) q.set("expired", "1");
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/request-blocks?${s}` : "/request-blocks";
}
const tabCls = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm font-medium ${
    active ? "bg-primary-surface text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
  }`;

/**
 * /request-blocks — Engellenenler (P15, AC-235): IP/önek veya bilgisayar engelleri; listele, ekle, kaldır. Yetki
 * `support_requests.block` (arka uç da denetler). Engelli kaynaktan gelen talep kuyruğa düşmez.
 */
export default async function RequestBlocksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const sp = await searchParams;
  const expired = one(sp.expired) === "1";
  const pageRaw = Number(one(sp.page));
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1;
  const can = perms.includes("support_requests.block");

  const header = (action?: React.ReactNode) => (
    <>
      <Breadcrumb items={[{ label: t("nav.requests"), href: "/requests" }, { label: t("bl.title") }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{t("bl.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("bl.subtitle")}</p>
        </div>
        {action}
      </div>
    </>
  );

  if (!can)
    return (
      <>
        {header()}
        <div className="mt-6 max-w-xl">
          <Alert tone="warning" testId="blocks-forbidden">
            {t("bl.forbidden")}
          </Alert>
        </div>
      </>
    );
  if (me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant)
    return (
      <>
        {header()}
        <div className="mt-6">
          <EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("bl.pickTenantBody")} testId="blocks-pick-tenant" />
        </div>
      </>
    );

  const res = await serverGet<RequestBlockListResponse>(
    `/request-blocks?includeExpired=${expired ? "true" : "false"}&page=${page}&pageSize=${PAGE_SIZE}`,
  );
  if (res.kind === "error") {
    if (res.status === 401) redirect(EXPIRED_LOGIN_PATH);
    return (
      <>
        {header()}
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? (
            <Alert tone="warning" testId="blocks-forbidden">
              {t("bl.forbidden")}
            </Alert>
          ) : (
            <LoadError />
          )}
        </div>
      </>
    );
  }
  const { items, total, used, max } = res.data;
  const full = used >= max;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      {header(<AddBlockButton disabled={full} />)}
      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label={t("bl.filter")} className="inline-flex self-start rounded-md border border-border bg-surface p-1 shadow-sm">
            <Link href={href(false)} aria-current={!expired ? "page" : undefined} className={tabCls(!expired)}>
              {t("bl.active")}
            </Link>
            <Link href={href(true)} aria-current={expired ? "page" : undefined} className={tabCls(expired)}>
              {t("bl.all")}
            </Link>
          </nav>
          <p className="text-sm text-fg-muted tabular-nums" data-testid="blocks-usage">
            {t("bl.usage", { used: formatNumber(used), max: formatNumber(max) })}
          </p>
        </div>
        {full && (
          <Alert tone="warning" testId="blocks-full">
            {t("bl.full", { max: formatNumber(max) })}
          </Alert>
        )}
        <p className="text-sm text-fg-muted">{t("bl.deviceNote")}</p>
        {items.length === 0 ? <BlocksEmpty expired={expired} canAdd={!full} /> : <BlockList items={items} />}
        {total > PAGE_SIZE && (
          <nav aria-label={t("rq.h.pages")} className="flex items-center justify-between gap-2 text-sm text-fg-muted">
            {page > 1 ? (
              <Link href={href(expired, page - 1)} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary">
                <ChevronLeft aria-hidden className="size-4" />
                {t("h.prev")}
              </Link>
            ) : (
              <span />
            )}
            <span className="tabular-nums">{t("rq.h.page", { page, pages })}</span>
            {page < pages ? (
              <Link href={href(expired, page + 1)} className="inline-flex min-h-11 items-center gap-1 font-medium text-primary">
                {t("h.next")}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </>
  );
}
