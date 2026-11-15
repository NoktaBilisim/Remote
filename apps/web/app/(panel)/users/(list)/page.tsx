import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building, ChevronLeft, ChevronRight, SearchX, Users } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { UserListResponse } from "@/lib/users/contract";
import { parseUserParams, userPageCount, usersApiPath, usersHref } from "@/lib/users/query";
import { UserFilters } from "../user-filters";
import { UserList } from "../user-list";
import { UsersActions } from "../users-actions";

export const metadata: Metadata = { title: t("nav.users") };

type SP = Record<string, string | string[] | undefined>;
const linkCls = "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline";

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
    <>
      <Breadcrumb items={[{ label: t("nav.users") }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{t("us.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t("us.subtitle")}</p>
        </div>
        {allowed && canCreate && !pickTenant && <UsersActions actor={actor} />}
      </div>
    </>
  );

  if (!allowed) {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl">
          <Alert tone="warning" testId="users-forbidden">
            {t("us.forbidden")}
          </Alert>
        </div>
      </>
    );
  }
  if (pickTenant) {
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState Icon={Building} title={t("us.pickTenantTitle")} body={t("us.pickTenantBody")} testId="users-pick-tenant" />
        </div>
      </>
    );
  }

  const params = parseUserParams(await searchParams);
  const res = await serverGet<UserListResponse>(usersApiPath(params));
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error") {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? (
            <Alert tone="warning" testId="users-forbidden">
              {t("us.forbidden")}
            </Alert>
          ) : (
            <LoadError />
          )}
        </div>
      </>
    );
  }

  const { items, total } = res.data;
  const pages = userPageCount(total, res.data.pageSize);
  const page = params.page;
  const filtered = params.role !== "all" || params.status !== "active";
  let body;
  if (items.length > 0) body = <UserList items={items} selfId={me.me.user.id} />;
  else if (total > 0)
    body = (
      <EmptyState
        Icon={SearchX}
        title={t("us.beyond", { pages })}
        body={t("us.beyondBody")}
        testId="users-beyond"
        action={
          <Link href={usersHref({ ...params, page: 1 })} className={linkCls}>
            {t("h.firstPage")}
          </Link>
        }
      />
    );
  else if (params.q)
    body = (
      <EmptyState
        Icon={SearchX}
        title={t("us.noMatch")}
        body={t("us.noMatchBody", { q: params.q })}
        testId="users-no-match"
        action={
          <Link href={usersHref({})} className={linkCls}>
            {t("us.clear")}
          </Link>
        }
      />
    );
  else if (filtered)
    body = (
      <EmptyState
        Icon={Users}
        title={t("us.emptyFilter")}
        body={t("us.emptyFilterBody")}
        testId="users-empty-filter"
        action={
          <Link href={usersHref({})} className={linkCls}>
            {t("us.clear")}
          </Link>
        }
      />
    );
  else
    body = (
      <EmptyState
        Icon={Users}
        title={t("us.emptyTitle")}
        body={t("us.emptyBody")}
        testId="users-empty"
        action={canCreate ? <UsersActions actor={actor} layout="empty" /> : undefined}
      />
    );

  return (
    <>
      {header}
      <div className="mt-6">
        <UserFilters params={params} />
      </div>
      <section className="mt-4" aria-label={t("us.title")}>
        {body}
        {total > 0 && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-fg-muted tabular-nums" role="status" data-testid="users-count">
              {t("us.count", { n: formatNumber(total) })}
            </p>
            {pages > 1 && (
              <nav aria-label={t("h.pager")} className="flex items-center gap-2 text-sm">
                {page > 1 ? (
                  <Link href={usersHref({ ...params, page: Math.min(page - 1, pages) })} rel="prev" className={linkCls}>
                    <ChevronLeft aria-hidden className="size-4" />
                    {t("h.prev")}
                  </Link>
                ) : null}
                <span className="px-1 tabular-nums text-fg" aria-current="page">
                  {t("h.pageOf", { page: formatNumber(page), pages: formatNumber(pages) })}
                </span>
                {page < pages ? (
                  <Link href={usersHref({ ...params, page: page + 1 })} rel="next" className={linkCls}>
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
