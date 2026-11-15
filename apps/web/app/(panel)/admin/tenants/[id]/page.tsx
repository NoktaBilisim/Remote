import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deletedTenantLabel } from "@remote/contracts/audit";
import { Breadcrumb } from "@/components/breadcrumb";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { PURGE_AUDIT_RETAIN_DAYS, type TenantPurgeStatus } from "@/lib/tenants/purge";
import type { TenantItem } from "@/lib/users/contract";
import { StatusPill } from "../../../users/user-list";
import { PurgePanel } from "./purge-panel";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!ULID.test(id)) return { title: t("nav.tenants") };
  const r = await serverGet<TenantItem>(`/admin/tenants/${id}`);
  return { title: r.kind === "ok" ? `${r.data.name} · ${t("nav.tenants")}` : t("nav.tenants") };
}

/**
 * /admin/tenants/[id] — firma ayrıntısı + kalıcı silme (P16, AC-242; mimari-e11 §7.8). Yalnız Super Admin (arka uç da 403).
 * Firma satırı silinmişse (iş TENANT_ROW sonrası / DONE) son iş durumu "Silinmiş firma #…" adıyla gösterilir.
 * Silme durumu alınamazsa kısmi durum: firma bilgileri + uyarı + Tekrar dene.
 */
export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const crumbs = (name?: string) => (
    <Breadcrumb items={[{ label: t("nav.tenants"), href: "/admin/tenants" }, { label: name ?? t("tn.title") }]} />
  );
  if (me.me.user.role !== "SUPER_ADMIN") {
    return (
      <>
        {crumbs()}
        <div className="max-w-xl">
          <Alert tone="warning" testId="tenants-forbidden">
            {t("tn.forbidden")}
          </Alert>
        </div>
      </>
    );
  }
  if (!ULID.test(id)) notFound();

  const [tr, pr] = await Promise.all([
    serverGet<TenantItem>(`/admin/tenants/${id}`),
    serverGet<TenantPurgeStatus>(`/admin/tenants/${id}/purge`),
  ]);
  if ((tr.kind === "error" && tr.status === 401) || (pr.kind === "error" && pr.status === 401)) redirect(EXPIRED_LOGIN_PATH);
  const job = pr.kind === "ok" ? pr.data : null;
  const jobError = pr.kind === "error" && pr.status !== 404;

  let tenant: TenantItem | null = null;
  if (tr.kind === "ok") tenant = tr.data;
  else if (tr.status !== 404 || !job) {
    if (tr.status === 404) notFound();
    return (
      <>
        {crumbs()}
        <div className="max-w-xl">
          <LoadError />
        </div>
      </>
    );
  }

  const name = tenant?.name ?? deletedTenantLabel(id);
  const passiveSince = tenant?.passiveSince ?? null;
  return (
    <>
      {crumbs(name)}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold break-words text-fg" data-testid="tenant-name">
          {name}
        </h1>
        {tenant && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="font-mono text-xs text-fg">{tenant.slug}</span>
            <StatusPill status={tenant.status} testId="tenant-status" />
            <span className="tabular-nums">
              {t("tn.col.users")}: {formatNumber(tenant.activeUserCount)}
            </span>
            {passiveSince && (
              <span className="tabular-nums" data-testid="tenant-passive-since">
                {t("tn.passiveSince")}: <time dateTime={passiveSince}>{formatDateTime(passiveSince)}</time>
              </span>
            )}
          </div>
        )}
      </div>

      <section
        aria-labelledby="purge-h"
        id="purge"
        className="mt-6 flex max-w-3xl scroll-mt-20 flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      >
        <div>
          <h2 id="purge-h" className="flex items-center gap-2 text-base font-semibold text-fg">
            <Trash2 aria-hidden className="size-5 text-fg-muted" />
            {t("tn.p.section")}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{t("tn.p.intro", { days: PURGE_AUDIT_RETAIN_DAYS })}</p>
        </div>
        {jobError ? (
          <div className="flex flex-col gap-3" data-testid="purge-status-error">
            <Alert tone="warning">{t("tn.p.statusFailed")}</Alert>
            <LoadError />
          </div>
        ) : (
          <PurgePanel
            tenantId={id}
            tenant={tenant ? { name: tenant.name, status: tenant.status, passiveSince } : null}
            name={name}
            initial={job}
          />
        )}
      </section>
    </>
  );
}
