import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Building, SearchX } from "lucide-react";
import { BeyondEmpty } from "@/components/beyond-empty";
import { LinkEmpty, ListFooter, ListNotice, ListPageHeader } from "@/components/list-page";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { TenantListResponse } from "@/lib/users/contract";
import { parseTenantParams, tenantsApiPath, tenantsHref, type TenantListParams } from "@/lib/users/tenant-query";
import { TenantFilters } from "./tenant-filters";
import { NewTenantButton, TenantList } from "./tenant-list";

export const metadata: Metadata = { title: t("nav.tenants") };

type SP = Record<string, string | string[] | undefined>;

/** Liste gövdesi: satırlar; yoksa sırayla sayfa dışı / filtre eşleşmesi yok / hiç firma yok. */
function tenantsBody(data: TenantListResponse, params: TenantListParams, pages: number, actingId: string | null): ReactNode {
  const { items, total } = data;
  const filtered = Boolean(params.q) || params.status !== "all";
  if (items.length > 0) return <TenantList items={items} actingId={actingId} />;
  if (total > 0) return <BeyondEmpty pages={pages} testId="tenants-beyond" href={tenantsHref({ ...params, page: 1 })} />;
  if (filtered)
    return (
      <LinkEmpty
        Icon={SearchX}
        title={t("tn.noMatch")}
        body={t("tn.noMatchBody")}
        testId="tenants-no-match"
        href={tenantsHref({})}
        label={t("tn.clear")}
      />
    );
  return (
    <EmptyState
      Icon={Building}
      title={t("tn.emptyTitle")}
      body={t("tn.emptyBody")}
      testId="tenants-empty"
      action={<NewTenantButton testId="tenant-new-empty" />}
    />
  );
}

/** /admin/tenants — Super Admin firma yönetimi (AC-70). Rol kontrolü arka uçta da (403). */
export default async function TenantsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const isSa = me.me.user.role === "SUPER_ADMIN";
  const header = (
    <ListPageHeader crumb={t("nav.tenants")} title={t("tn.title")} subtitle={t("tn.subtitle")} actions={isSa && <NewTenantButton />} />
  );
  const notice = (body: ReactNode) => (
    <>
      {header}
      <ListNotice>{body}</ListNotice>
    </>
  );
  const forbidden = notice(
    <Alert tone="warning" testId="tenants-forbidden">
      {t("tn.forbidden")}
    </Alert>,
  );
  if (!isSa) return forbidden;

  const params = parseTenantParams(await searchParams);
  const res = await serverGet<TenantListResponse>(tenantsApiPath(params));
  if (res.kind === "error") {
    if (res.status === 401) redirect(EXPIRED_LOGIN_PATH);
    if (res.status === 403) return forbidden;
    return notice(<LoadError />);
  }
  return tenantsLoaded(header, res.data, params, me.me.actingTenant?.id ?? null);
}

/** Başarılı yanıt: başlık + filtreler + gövde + (kayıt varsa) liste altı. */
function tenantsLoaded(header: ReactNode, data: TenantListResponse, params: TenantListParams, actingId: string | null) {
  const { total, pageSize } = data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      {header}
      <div className="mt-6">
        <TenantFilters params={params} />
      </div>
      <section className="mt-4" aria-label={t("tn.title")}>
        {tenantsBody(data, params, pages, actingId)}
        {total > 0 && (
          <ListFooter
            count={t("tn.count", { n: formatNumber(total) })}
            countTestId="tenants-count"
            page={params.page}
            pages={pages}
            hrefFor={(page) => tenantsHref({ ...params, page })}
          />
        )}
      </section>
    </>
  );
}
