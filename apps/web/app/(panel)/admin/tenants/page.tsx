import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building, ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { TenantListResponse } from "@/lib/users/contract";
import { parseTenantParams, tenantsApiPath, tenantsHref } from "@/lib/users/tenant-query";
import { TenantFilters } from "./tenant-filters";
import { NewTenantButton, TenantList } from "./tenant-list";

export const metadata: Metadata = { title: t("nav.tenants") };

type SP = Record<string, string | string[] | undefined>;
const linkCls = "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline";

/** /admin/tenants — Super Admin firma yönetimi (AC-70). Rol kontrolü arka uçta da (403). */
export default async function TenantsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const isSa = me.me.user.role === "SUPER_ADMIN";
  const header = (
    <>
      <Breadcrumb items={[{ label: t("nav.tenants") }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{t("tn.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("tn.subtitle")}</p>
        </div>
        {isSa && <NewTenantButton />}
      </div>
    </>
  );
  const forbidden = (
    <>
      {header}
      <div className="mt-6 max-w-xl"><Alert tone="warning" testId="tenants-forbidden">{t("tn.forbidden")}</Alert></div>
    </>
  );
  if (!isSa) return forbidden;

  const params = parseTenantParams(await searchParams);
  const res = await serverGet<TenantListResponse>(tenantsApiPath(params));
  if (res.kind === "error") {
    if (res.status === 401) redirect(EXPIRED_LOGIN_PATH);
    if (res.status === 403) return forbidden;
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl"><LoadError /></div>
      </>
    );
  }
  const { items, total, pageSize } = res.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = params.page;
  const filtered = Boolean(params.q) || params.status !== "all";
  let body;
  if (items.length > 0) body = <TenantList items={items} actingId={me.me.actingTenant?.id ?? null} />;
  else if (total > 0)
    body = <EmptyState Icon={SearchX} title={t("us.beyond", { pages })} body={t("us.beyondBody")} testId="tenants-beyond" action={<Link href={tenantsHref({ ...params, page: 1 })} className={linkCls}>{t("h.firstPage")}</Link>} />;
  else if (filtered)
    body = <EmptyState Icon={SearchX} title={t("tn.noMatch")} body={t("tn.noMatchBody")} testId="tenants-no-match" action={<Link href={tenantsHref({})} className={linkCls}>{t("tn.clear")}</Link>} />;
  else body = <EmptyState Icon={Building} title={t("tn.emptyTitle")} body={t("tn.emptyBody")} testId="tenants-empty" action={<NewTenantButton testId="tenant-new-empty" />} />;

  return (
    <>
      {header}
      <div className="mt-6"><TenantFilters params={params} /></div>
      <section className="mt-4" aria-label={t("tn.title")}>
        {body}
        {total > 0 && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-fg-muted tabular-nums" role="status" data-testid="tenants-count">{t("tn.count", { n: formatNumber(total) })}</p>
            {pages > 1 && (
              <nav aria-label={t("h.pager")} className="flex items-center gap-2 text-sm">
                {page > 1 && (
                  <Link href={tenantsHref({ ...params, page: Math.min(page - 1, pages) })} rel="prev" className={linkCls}>
                    <ChevronLeft aria-hidden className="size-4" />
                    {t("h.prev")}
                  </Link>
                )}
                <span className="px-1 tabular-nums text-fg" aria-current="page">{t("h.pageOf", { page: formatNumber(page), pages: formatNumber(pages) })}</span>
                {page < pages && (
                  <Link href={tenantsHref({ ...params, page: page + 1 })} rel="next" className={linkCls}>
                    {t("h.next")}
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                )}
              </nav>
            )}
          </div>
        )}
      </section>
    </>
  );
}
