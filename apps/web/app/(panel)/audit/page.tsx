import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText, SearchX } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { CsvExportButton } from "@/components/csv-export-button";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import type { AuditListResponse } from "@/lib/audit/contract";
import { auditApiPath, auditExportPath, auditHref, hasAuditFilters, parseAuditParams, type AuditField } from "@/lib/audit/query";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { istanbulDay } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { TenantListResponse, UserListResponse } from "@/lib/users/contract";
import { AuditFiltersForm } from "./audit-filters";
import { AuditLog } from "./audit-log";

export const metadata: Metadata = { title: t("nav.audit") };

type SP = Record<string, string | string[] | undefined>;
type Opt = { value: string; label: string };
const linkCls = "inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline";
const FIELD_LABEL: Record<AuditField, MessageKey> = {
  from: "h.f.from",
  to: "h.f.to",
  tenantId: "h.f.tenant",
  userId: "au.f.user",
  action: "au.f.action",
  result: "au.f.result",
};

const sortOpts = (m: Map<string, string>, selected?: string): Opt[] => {
  if (selected && !m.has(selected)) m.set(selected, t("h.f.selected", { id: selected.slice(-6) }));
  return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "tr"));
};

/**
 * /audit — salt okunur audit log (P11: AC-76, 124; ortak standart §1.1). Veri sunucuda; filtreler URL'de; ilk 50 kayıt
 * SSR, sonrası "Daha fazla yükle" (keyset). Yetki `audit.view` (yoksa 403 durumu), CSV `audit.export`. Kapsam arka uçta.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const isSa = me.me.user.role === "SUPER_ADMIN";
  const allTenants = isSa && !me.me.actingTenant;
  const header = (
    <>
      <Breadcrumb items={[{ label: t("nav.audit") }]} />
      <h1 className="text-2xl font-semibold text-fg">{t("au.title")}</h1>
    </>
  );
  const forbidden = (
    <>
      {header}
      <div className="mt-6 max-w-xl"><Alert tone="warning" testId="audit-forbidden">{t("au.forbidden")}</Alert></div>
    </>
  );
  if (!perms.includes("audit.view")) return forbidden;

  const { filters, ignored } = parseAuditParams(await searchParams, { allowTenant: allTenants, today: istanbulDay() });
  const canListUsers = perms.includes("users.view") && (!isSa || Boolean(me.me.actingTenant));
  const [res, usersRes, tenantsRes] = await Promise.all([
    serverGet<AuditListResponse>(auditApiPath(filters)),
    canListUsers ? serverGet<UserListResponse>("/users?status=all&page=1&pageSize=100") : Promise.resolve(null),
    allTenants ? serverGet<TenantListResponse>("/admin/tenants?status=all&page=1&pageSize=100") : Promise.resolve(null),
  ]);
  if (res.kind === "error") {
    if (res.status === 401) redirect(EXPIRED_LOGIN_PATH);
    if (res.status === 403) return forbidden;
    return (
      <>
        {header}
        <div className="mt-6 flex max-w-xl flex-col gap-4">
          {res.status === 400 ? (
            <Alert tone="warning" testId="audit-bad-filter">
              {t("h.ignored", { fields: t("h.filters") })}{" "}
              <Link href={auditHref({})} className="font-medium underline">{t("h.f.clear")}</Link>
            </Alert>
          ) : (
            <LoadError />
          )}
        </div>
      </>
    );
  }
  const { items, nextCursor } = res.data;

  // Kullanıcı seçenekleri: /users (Admin ve firma seçmiş Super Admin); yoksa/başarısızsa sayfadaki kayıtlardan (kısmi)
  const userMap = new Map<string, string>();
  const usersOk = usersRes?.kind === "ok";
  if (usersRes?.kind === "ok") for (const u of usersRes.data.items) userMap.set(u.id, u.fullName);
  else for (const a of items) if (a.userId) userMap.set(a.userId, a.userFullName ?? a.username ?? a.userId);
  const usersHint = usersOk ? undefined : usersRes?.kind === "error" ? t("au.usersPartial") : t("h.f.optionsHint");
  let tenants: Opt[] | null = null;
  if (allTenants) {
    const tm = new Map<string, string>();
    if (tenantsRes?.kind === "ok") for (const x of tenantsRes.data.items) tm.set(x.id, x.name);
    else for (const a of items) if (a.tenantId && a.tenantName) tm.set(a.tenantId, a.tenantName);
    tenants = sortOpts(tm, filters.tenantId);
  }
  const filtered = hasAuditFilters(filters);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {header}
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{allTenants ? t("au.subtitleAll") : t("au.subtitle")}</p>
        </div>
        {perms.includes("audit.export") && items.length > 0 && (
          <CsvExportButton path={auditExportPath(filters)} label={t("au.export")} hint={t("au.exportHint")} fallbackName="audit-log.csv" testId="audit-export" errorTestId="audit-export-error" />
        )}
      </div>

      <div className="mt-6">
        <AuditFiltersForm key={auditHref(filters)} filters={filters} users={sortOpts(userMap, filters.userId)} usersHint={usersHint} tenants={tenants} />
      </div>

      {ignored.length > 0 && (
        <div className="mt-4">
          <Alert tone="warning" testId="filters-ignored">
            {t("h.ignored", { fields: [...new Set(ignored)].map((f) => t(FIELD_LABEL[f])).join(", ") })}
          </Alert>
        </div>
      )}

      <section className="mt-4" aria-label={t("au.title")}>
        {items.length === 0 ? (
          filtered ? (
            <EmptyState
              Icon={SearchX}
              title={t("au.emptyFilterTitle")}
              body={t("au.emptyFilterBody")}
              testId="audit-empty-filter"
              action={<Link href={auditHref({})} className={linkCls}>{t("h.f.clear")}</Link>}
            />
          ) : (
            <EmptyState Icon={ScrollText} title={t("au.emptyTitle")} body={t("au.emptyBody")} testId="audit-empty" />
          )
        ) : (
          <AuditLog key={auditHref(filters)} initial={{ items, nextCursor }} filters={filters} showTenant={allTenants} />
        )}
      </section>
    </>
  );
}
