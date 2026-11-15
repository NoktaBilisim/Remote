import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Building2, SearchX } from "lucide-react";
import { LinkEmpty, ListFooter, ListNotice, ListPageHeader } from "@/components/list-page";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import type { CustomerListResponse, GeneralLinkResponse } from "@/lib/customers/contract";
import { customerPageCount, customersApiPath, customersHref, parseCustomerParams, type CustomerListParams } from "@/lib/customers/query";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { CustomerFilters } from "../customer-filters";
import { CustomerList } from "../customer-list";
import { CustomersActions, CustomersActionsProvider } from "../customers-actions";
import { GeneralLink } from "../general-link";

export const metadata: Metadata = { title: t("nav.customers") };

type SP = Record<string, string | string[] | undefined>;

const forbidden = (
  <Alert tone="warning" testId="customers-forbidden">
    {t("cu.forbidden")}
  </Alert>
);

/** Liste gövdesi: satırlar; yoksa sırayla sayfa dışı / arama eşleşmesi yok / pasif filtre boş / hiç müşteri yok. */
function customersBody(data: CustomerListResponse, params: CustomerListParams, canCreate: boolean): ReactNode {
  const { items, total } = data;
  if (items.length > 0) return <CustomerList items={items} />;
  if (total > 0)
    return (
      <LinkEmpty
        Icon={SearchX}
        title={t("cu.beyond", { pages: customerPageCount(total, data.pageSize) })}
        body={t("cu.beyondBody")}
        testId="customers-beyond"
        href={customersHref({ ...params, page: 1 })}
        label={t("h.firstPage")}
      />
    );
  if (params.q)
    return (
      <LinkEmpty
        Icon={SearchX}
        title={t("cu.noMatch")}
        body={t("cu.noMatchBody", { q: params.q })}
        testId="customers-no-match"
        href={customersHref({ status: params.status })}
        label={t("cu.clearSearch")}
      />
    );
  if (params.status === "passive")
    return <EmptyState Icon={Building2} title={t("cu.emptyPassive")} body={t("cu.emptyFilterBody")} testId="customers-empty-filter" />;
  // AC-223: `status=all` boşken de varsayılan boş durum ("Yeni müşteri" + yardım) — hiç müşteri yok demektir
  return (
    <EmptyState
      Icon={Building2}
      title={t("cu.emptyTitle")}
      body={t("cu.emptyBody")}
      testId="customers-empty"
      action={<CustomersActions canCreate={canCreate} layout="empty" />}
    />
  );
}

/** Erişim: görüntüleme, oluşturma ve P19 (AC-263, S-P19-14) dışa/içe aktarma; Super Admin firma seçmeli. */
function customerAccess(me: { permissions: readonly string[]; user: { role: string }; actingTenant?: unknown }) {
  const perms = me.permissions;
  const canCreate = perms.includes("customers.create");
  return {
    perms,
    canCreate,
    allowed: perms.includes("customers.view"),
    pickTenant: me.user.role === "SUPER_ADMIN" && !me.actingTenant,
    // dışa aktar view+export; içe aktar import+create+view BİRLİKTE yoksa gizli (sunucu da denetler)
    canExport: perms.includes("customers.export"),
    canImport: perms.includes("customers.import") && canCreate && perms.includes("customers.view"),
  };
}

/**
 * /customers — müşteri firmalar (P8c-1: AC-165..169, 174, 175). Veri sunucuda, filtre URL'de; yetki ve tenant
 * kapsamı arka uçta da denetlenir (tenantScope; Super Admin firma seçmeli — AC-172).
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const a = customerAccess({ ...me.me, permissions: me.me.permissions as readonly string[] });
  const params = parseCustomerParams(await searchParams);
  const header = (
    <ListPageHeader
      crumb={t("nav.customers")}
      title={t("cu.title")}
      subtitle={t("cu.subtitle")}
      actions={
        a.allowed &&
        !a.pickTenant && (
          <CustomersActions canCreate={a.canCreate} canExport={a.canExport} canImport={a.canImport} exportStatus={params.status} />
        )
      }
    />
  );
  if (!a.allowed)
    return (
      <>
        {header}
        <ListNotice>{forbidden}</ListNotice>
      </>
    );
  if (a.pickTenant)
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState Icon={Building2} title={t("rq.pickTenantTitle")} body={t("cu.pickTenantBody")} testId="customers-pick-tenant" />
        </div>
      </>
    );

  const [res, general] = await Promise.all([
    serverGet<CustomerListResponse>(customersApiPath(params)),
    serverGet<GeneralLinkResponse>("/customers/general-link"),
  ]);
  if ((res.kind === "error" && res.status === 401) || (general.kind === "error" && general.status === 401)) redirect(EXPIRED_LOGIN_PATH);

  const generalStrip = <GeneralLink data={general.kind === "ok" ? general.data : null} canSettings={a.perms.includes("settings.edit")} />;
  if (res.kind === "error")
    return (
      <CustomersActionsProvider>
        {header}
        {generalStrip}
        <ListNotice>{res.status === 403 ? forbidden : <LoadError />}</ListNotice>
      </CustomersActionsProvider>
    );

  const { total } = res.data;
  return (
    <CustomersActionsProvider>
      {header}
      {generalStrip}
      <div className="mt-6">
        <CustomerFilters params={params} />
      </div>
      <section className="mt-4" aria-label={t("cu.title")}>
        {customersBody(res.data, params, a.canCreate)}
        {total > 0 && (
          <ListFooter
            count={t("cu.count", { n: formatNumber(total) })}
            countTestId="customers-count"
            page={params.page}
            pages={customerPageCount(total, res.data.pageSize)}
            hrefFor={(page) => customersHref({ ...params, page })}
          />
        )}
      </section>
    </CustomersActionsProvider>
  );
}
