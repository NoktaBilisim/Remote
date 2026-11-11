import type { SessionListItem, SessionListResponse } from "@remote/contracts/api/sessions";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { History, MonitorSmartphone, SearchX } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { hasFilters, historyHref, listApiPath, pageCount, parseFilters, type SearchParams } from "@/lib/history/query";
import { t, type MessageKey } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { ExportButton } from "./export-button";
import { HistoryFiltersForm } from "./history-filters";
import { HistoryList } from "./history-list";
import { Pagination } from "./pagination";

export const metadata: Metadata = { title: t("nav.history") };

const FIELD_LABEL: Record<string, MessageKey> = {
  status: "h.f.status",
  mode: "h.f.mode",
  from: "h.f.from",
  to: "h.f.to",
  technicianId: "h.f.tech",
  tenantId: "h.f.tenant",
  customer: "h.f.customer",
  page: "h.f.page",
  pageSize: "h.pageSize",
};

/** Filtre seçenekleri: kullanıcı/firma listesi ucu P9'da; o zamana kadar bu sayfadaki kayıtlardan + seçili değer. */
function options(items: SessionListItem[], pick: (s: SessionListItem) => { id: string; name: string } | null, selected?: string) {
  const map = new Map<string, string>();
  for (const s of items) {
    const v = pick(s);
    if (v) map.set(v.id, v.name);
  }
  if (selected && !map.has(selected)) map.set(selected, t("h.f.selected", { id: selected.slice(-6) }));
  return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/** /history — oturum geçmişi (P8: AC-60, 61, 63). Veri sunucuda; filtre durumu URL'de. Rol kapsamı arka uçta (historyScope). */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const role = me.me.user.role;
  const allTenants = role === "SUPER_ADMIN" && !me.me.actingTenant;
  const header = (
    <>
      <Breadcrumb items={[{ label: t("nav.history") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("h.title")}</h1>
    </>
  );
  if (!perms.includes("session_history.view")) {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl"><Alert tone="warning" testId="history-forbidden">{t("h.forbidden")}</Alert></div>
      </>
    );
  }

  const { filters, ignored } = parseFilters(await searchParams);
  const res = await serverGet<SessionListResponse>(listApiPath(filters));
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error") {
    return (
      <>
        {header}
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? <Alert tone="warning" testId="history-forbidden">{t("h.forbidden")}</Alert> : <LoadError />}
        </div>
      </>
    );
  }

  const { items, total } = res.data;
  const pages = pageCount(total, filters.pageSize);
  const filtered = hasFilters(filters);
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {header}
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{allTenants ? t("h.subtitleAll") : t("h.subtitle")}</p>
        </div>
        {perms.includes("session_history.export") && total > 0 && <ExportButton filters={filters} />}
      </div>

      <div className="mt-6">
        <HistoryFiltersForm
          key={historyHref(filters)}
          filters={filters}
          technicians={role === "USER" ? null : options(items, (s) => s.technician, filters.technicianId)}
          tenants={allTenants ? options(items, (s) => s.tenant, filters.tenantId) : null}
        />
      </div>

      {ignored.length > 0 && (
        <div className="mt-4">
          <Alert tone="warning" testId="filters-ignored">
            {t("h.ignored", { fields: [...new Set(ignored)].map((f) => t(FIELD_LABEL[f] ?? "h.filters")).join(", ") })}
          </Alert>
        </div>
      )}

      <section className="mt-4" aria-label={t("h.title")}>
        {items.length === 0 ? (
          total > 0 ? (
            <EmptyState
              Icon={SearchX}
              title={t("h.beyond", { pages })}
              body={t("h.emptyFilterBody")}
              testId="history-beyond"
              action={<Link href={historyHref({ ...filters, page: 1 })} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">{t("h.firstPage")}</Link>}
            />
          ) : filtered ? (
            <EmptyState
              Icon={SearchX}
              title={t("h.emptyFilterTitle")}
              body={t("h.emptyFilterBody")}
              testId="history-empty-filter"
              action={<Link href={historyHref({ pageSize: filters.pageSize })} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">{t("h.f.clear")}</Link>}
            />
          ) : (
            <EmptyState
              Icon={History}
              title={t("h.emptyTitle")}
              body={t("h.emptyBody")}
              testId="history-empty"
              action={
                perms.includes("sessions.view") && (
                  <Link href="/sessions" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline">
                    <MonitorSmartphone aria-hidden className="size-4" />
                    {t("h.emptyAction")}
                  </Link>
                )
              }
            />
          )
        ) : (
          <HistoryList items={items} showTechnician={role !== "USER"} showTenant={allTenants} />
        )}
        {total > 0 && <Pagination filters={filters} total={total} shown={items.length} />}
      </section>
    </>
  );
}
