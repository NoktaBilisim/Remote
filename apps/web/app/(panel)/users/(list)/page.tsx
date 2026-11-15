import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Building, SearchX, Users } from "lucide-react";
import { LinkEmpty, ListFooter, ListNotice, ListPageHeader } from "@/components/list-page";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { UserListResponse } from "@/lib/users/contract";
import { parseUserParams, userPageCount, usersApiPath, usersHref, type UserListParams } from "@/lib/users/query";
import { UserFilters } from "../user-filters";
import { UserList } from "../user-list";
import { UsersActions } from "../users-actions";

export const metadata: Metadata = { title: t("nav.users") };

type SP = Record<string, string | string[] | undefined>;
type Actor = { role: string; permissions: readonly string[] };

const forbidden = (
  <Alert tone="warning" testId="users-forbidden">
    {t("us.forbidden")}
  </Alert>
);

/** Liste gövdesi: satırlar; yoksa sırayla sayfa dışı / arama eşleşmesi yok / filtre boş / hiç kullanıcı yok. */
function usersBody(data: UserListResponse, params: UserListParams, ctx: { selfId: string; canCreate: boolean; actor: Actor }): ReactNode {
  const { items, total } = data;
  const filtered = params.role !== "all" || params.status !== "active";
  if (items.length > 0) return <UserList items={items} selfId={ctx.selfId} />;
  if (total > 0) {
    const pages = userPageCount(total, data.pageSize);
    return (
      <LinkEmpty
        Icon={SearchX}
        title={t("us.beyond", { pages })}
        body={t("us.beyondBody")}
        testId="users-beyond"
        href={usersHref({ ...params, page: 1 })}
        label={t("h.firstPage")}
      />
    );
  }
  if (params.q)
    return (
      <LinkEmpty
        Icon={SearchX}
        title={t("us.noMatch")}
        body={t("us.noMatchBody", { q: params.q })}
        testId="users-no-match"
        href={usersHref({})}
        label={t("us.clear")}
      />
    );
  if (filtered)
    return (
      <LinkEmpty
        Icon={Users}
        title={t("us.emptyFilter")}
        body={t("us.emptyFilterBody")}
        testId="users-empty-filter"
        href={usersHref({})}
        label={t("us.clear")}
      />
    );
  return (
    <EmptyState
      Icon={Users}
      title={t("us.emptyTitle")}
      body={t("us.emptyBody")}
      testId="users-empty"
      action={ctx.canCreate ? <UsersActions actor={ctx.actor} layout="empty" /> : undefined}
    />
  );
}

/**
 * /users — kullanıcı listesi (P9: AC-71, 73). Veri sunucuda, filtre URL'de; `users.view` ve tenant kapsamı arka uçta
 * da denetlenir. Super Admin önce üst menüden firma seçer (firma bağlamı olmadan liste yok).
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const allowed = perms.includes("users.view");
  const canCreate = perms.includes("users.create");
  const pickTenant = me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant;
  const actor = { role: me.me.user.role, permissions: perms };
  const header = (
    <ListPageHeader
      crumb={t("nav.users")}
      title={t("us.title")}
      subtitle={t("us.subtitle")}
      actions={allowed && canCreate && !pickTenant && <UsersActions actor={actor} />}
    />
  );
  if (!allowed) return withHeader(header, <ListNotice>{forbidden}</ListNotice>);
  if (pickTenant)
    return withHeader(
      header,
      <div className="mt-6">
        <EmptyState Icon={Building} title={t("us.pickTenantTitle")} body={t("us.pickTenantBody")} testId="users-pick-tenant" />
      </div>,
    );

  const params = parseUserParams(await searchParams);
  const res = await serverGet<UserListResponse>(usersApiPath(params));
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error") return withHeader(header, <ListNotice>{res.status === 403 ? forbidden : <LoadError />}</ListNotice>);

  const { total } = res.data;
  return (
    <>
      {header}
      <div className="mt-6">
        <UserFilters params={params} />
      </div>
      <section className="mt-4" aria-label={t("us.title")}>
        {usersBody(res.data, params, { selfId: me.me.user.id, canCreate, actor })}
        {total > 0 && (
          <ListFooter
            count={t("us.count", { n: formatNumber(total) })}
            countTestId="users-count"
            page={params.page}
            pages={userPageCount(total, res.data.pageSize)}
            hrefFor={(page) => usersHref({ ...params, page })}
          />
        )}
      </section>
    </>
  );
}

function withHeader(header: ReactNode, body: ReactNode) {
  return (
    <>
      {header}
      {body}
    </>
  );
}
