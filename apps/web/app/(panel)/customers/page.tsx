import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronLeft, ChevronRight, Link2, SearchX, Settings } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { CopyLink } from "@/components/copy-link";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import type { CustomerListResponse, GeneralLinkResponse } from "@/lib/customers/contract";
import { customerPageCount, customersApiPath, customersHref, parseCustomerParams } from "@/lib/customers/query";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { CustomerFilters } from "./customer-filters";
import { CustomerList } from "./customer-list";
import { CustomersActions } from "./customers-actions";

export const metadata: Metadata = { title: t("nav.customers") };

type SP = Record<string, string | string[] | undefined>;
const linkCls = "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline";

/** Genel bağlantı şeridi (AC-175): salt okunur + Kopyala; yenileme yalnız Ayarlar'dan. Alınamazsa kısmi durum uyarısı. */
function GeneralLink({ data, canSettings }: { data: GeneralLinkResponse | null; canSettings: boolean }) {
  return (
    <section aria-labelledby="genel-baglanti" data-testid="general-link" className="mt-6 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <h2 id="genel-baglanti" className="flex items-center gap-2 text-base font-semibold text-fg">
            <Link2 aria-hidden className="size-5 text-primary" />
            {t("cu.general.title")}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{t("cu.general.body")}</p>
          {data && <p className="mt-1 truncate font-mono text-xs text-fg-muted" title={data.fileName} data-testid="general-file-name">{data.fileName}</p>}
          {canSettings && (
            <Link href="/settings/support-requests" className={linkCls}>
              <Settings aria-hidden className="size-4" />
              {t("cu.general.manage")}
            </Link>
          )}
        </div>
        {data ? (
          <CopyLink url={data.downloadUrl} srLabel={t("cu.general.copy")} testId="general-copy" />
        ) : (
          <div className="lg:max-w-sm"><Alert tone="warning" testId="general-link-error">{t("cu.general.error")}</Alert></div>
        )}
      </div>
    </section>
  );
}

/**
 * /customers — müşteri firmalar (P8c-1: AC-165..169, 174, 175). Veri sunucuda, filtre URL'de; yetki ve tenant
 * kapsamı arka uçta da denetlenir (tenantScope; Super Admin firma seçmeli — AC-172).
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const canCreate = perms.includes("customers.create");
  const allowed = perms.includes("customers.view");
  const pickTenant = me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant;

  const header = (
    <>
      <Breadcrumb items={[{ label: t("nav.customers") }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{t("cu.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("cu.subtitle")}</p>
        </div>
        {allowed && !pickTenant && <CustomersActions canCreate={canCreate} />}
      </div>
    </>
  );

  if (!allowed) {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl"><Alert tone="warning" testId="customers-forbidden">{t("cu.forbidden")}</Alert></div>
      </>
    );
  }
  if (pickTenant) {
    return (
      <>
        {header}
        <div className="mt-6"><EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("cu.pickTenantBody")} testId="customers-pick-tenant" /></div>
      </>
    );
  }

  const params = parseCustomerParams(await searchParams);
  const [res, general] = await Promise.all([
    serverGet<CustomerListResponse>(customersApiPath(params)),
    serverGet<GeneralLinkResponse>("/customers/general-link"),
  ]);
  if ((res.kind === "error" && res.status === 401) || (general.kind === "error" && general.status === 401)) redirect(EXPIRED_LOGIN_PATH);

  const generalStrip = <GeneralLink data={general.kind === "ok" ? general.data : null} canSettings={perms.includes("settings.edit")} />;
  if (res.kind === "error") {
    return (
      <>
        {header}
        {generalStrip}
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? <Alert tone="warning" testId="customers-forbidden">{t("cu.forbidden")}</Alert> : <LoadError />}
        </div>
      </>
    );
  }

  const { items, total } = res.data;
  const pages = customerPageCount(total, res.data.pageSize);
  const page = params.page;
  let body;
  if (items.length > 0) body = <CustomerList items={items} />;
  else if (total > 0)
    body = (
      <EmptyState
        Icon={SearchX}
        title={t("cu.beyond", { pages })}
        body={t("cu.beyondBody")}
        testId="customers-beyond"
        action={<Link href={customersHref({ ...params, page: 1 })} className={linkCls}>{t("h.firstPage")}</Link>}
      />
    );
  else if (params.q)
    body = (
      <EmptyState
        Icon={SearchX}
        title={t("cu.noMatch")}
        body={t("cu.noMatchBody", { q: params.q })}
        testId="customers-no-match"
        action={<Link href={customersHref({ status: params.status })} className={linkCls}>{t("cu.clearSearch")}</Link>}
      />
    );
  else if (params.status !== "active")
    body = <EmptyState Icon={Building2} title={params.status === "passive" ? t("cu.emptyPassive") : t("cu.emptyTitle")} body={t("cu.emptyFilterBody")} testId="customers-empty-filter" />;
  else
    body = (
      <EmptyState
        Icon={Building2}
        title={t("cu.emptyTitle")}
        body={t("cu.emptyBody")}
        testId="customers-empty"
        action={<CustomersActions canCreate={canCreate} layout="empty" />}
      />
    );

  return (
    <>
      {header}
      {generalStrip}
      <div className="mt-6"><CustomerFilters params={params} /></div>
      <section className="mt-4" aria-label={t("cu.title")}>
        {body}
        {total > 0 && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-fg-muted tabular-nums" role="status" data-testid="customers-count">{t("cu.count", { n: formatNumber(total) })}</p>
            {pages > 1 && (
              <nav aria-label={t("h.pager")} className="flex items-center gap-2 text-sm">
                {page > 1 ? (
                  <Link href={customersHref({ ...params, page: Math.min(page - 1, pages) })} rel="prev" className={linkCls}>
                    <ChevronLeft aria-hidden className="size-4" />
                    {t("h.prev")}
                  </Link>
                ) : null}
                <span className="px-1 tabular-nums text-fg" aria-current="page">{t("h.pageOf", { page: formatNumber(page), pages: formatNumber(pages) })}</span>
                {page < pages ? (
                  <Link href={customersHref({ ...params, page: page + 1 })} rel="next" className={linkCls}>
                    {t("h.next")}
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                ) : null}
              </nav>
            )}
          </div>
        )}
      </section>
    </>
  );
}
