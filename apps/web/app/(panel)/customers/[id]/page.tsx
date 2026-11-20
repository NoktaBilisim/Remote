import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Globe, Link2, UserRound } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { CopyLink } from "@/components/copy-link";
import { SendToCustomerDialog } from "@/components/send-to-customer/send-to-customer-dialog";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import type { CustomerDetail } from "@/lib/customers/contract";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import { CustomerStatusBadge } from "../customer-list";
import { CustomerActions } from "./customer-actions";
import { CustomerTabs } from "./customer-tabs";
import { NotifyContacts } from "./notify-contacts";
import { PortalAccounts } from "./portal-accounts";

export const metadata: Metadata = { title: t("cu.detailTitle") };
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-fg wrap-anywhere" data-testid={testId}>
        {children}
      </dd>
    </>
  );
}

/**
 * /customers/[id] — müşteri detayı (AC-169..171, 178, 195): üst çizgili bölümler (history detayı kalıbı) — bilgiler,
 * bağlantı (Kopyala, Yenile), durum eylemleri, Talepler/Oturumlar sekmeleri. Başka tenant / yok → 404.
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const perms = me.me.permissions as readonly string[];
  const { id } = await params;
  const crumbs = [{ label: t("nav.customers"), href: "/customers" }];
  if (!perms.includes("customers.view")) {
    return (
      <>
        <Breadcrumb items={[...crumbs, { label: t("cu.detailTitle") }]} />
        <h1 className="text-2xl font-semibold text-fg">{t("cu.detailTitle")}</h1>
        <div className="mt-6 max-w-xl">
          <Alert tone="warning" testId="customers-forbidden">
            {t("cu.forbidden")}
          </Alert>
        </div>
      </>
    );
  }
  if (!ULID.test(id)) notFound();
  const res = await serverGet<CustomerDetail>(`/customers/${id}`);
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error" && res.status === 404) notFound();
  if (res.kind === "error") {
    return (
      <>
        <Breadcrumb items={[...crumbs, { label: t("cu.detailTitle") }]} />
        <h1 className="text-2xl font-semibold text-fg">{t("cu.detailTitle")}</h1>
        <div className="mt-6 max-w-xl">
          {res.status === 403 ? (
            <Alert tone="warning" testId="customers-forbidden">
              {t("cu.forbidden")}
            </Alert>
          ) : (
            <LoadError />
          )}
        </div>
      </>
    );
  }
  const c = res.data;
  const canEdit = perms.includes("customers.edit");
  const anon = Boolean(c.anonymizedAt);
  // LG-3 (AC-421, 423): ACTIVE + anonim değil + en az bir bağlantı + `customers.view` (yukarıda) + `sessions.send_link`
  const canSendToCustomer =
    c.status === "ACTIVE" && !anon && Boolean(c.downloadUrl || c.webFormUrl) && perms.includes("sessions.send_link");
  const pii = (v: string | null) =>
    v ?? (anon ? <span className="italic text-fg-muted">{t("cu.anonymized")}</span> : <span className="text-fg-muted">—</span>);

  return (
    <>
      <Breadcrumb items={[...crumbs, { label: c.name }]} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-fg wrap-anywhere">{c.name}</h1>
            <CustomerStatusBadge status={c.status} />
          </div>
          {c.status === "PASSIVE" && c.passiveAt && (
            <p className="mt-1 text-sm text-fg-muted">{t("cu.passiveSince", { at: formatDateTime(c.passiveAt) })}</p>
          )}
        </div>
        <CustomerActions customer={c} canEdit={canEdit} canDelete={perms.includes("customers.delete")} />
      </div>

      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        <section aria-labelledby="baglanti" className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 id="baglanti" className="flex items-center gap-2 text-lg font-semibold text-fg">
            <Link2 aria-hidden className="size-5 text-primary" />
            {t("cu.link.title")}
          </h2>
          {c.status === "ACTIVE" && c.downloadUrl ? (
            <>
              <code
                data-testid="customer-download-url"
                className="rounded-md border border-border bg-canvas px-3 py-2.5 font-mono text-sm text-fg break-all"
              >
                {c.downloadUrl}
              </code>
              <div className="flex flex-wrap items-start gap-2">
                <CopyLink url={c.downloadUrl} srLabel={t("cu.copyFor", { name: c.name })} testId="customer-copy" />
                {canSendToCustomer && <SendToCustomerDialog target={{ kind: "CUSTOMER", customerId: c.id }} testId="customer-send" />}
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <Row label={t("srs.dl.fileName")} testId="customer-file-name">
                  <span className="font-mono">{c.fileName}</span>
                </Row>
                <Row label={t("srs.dl.rotatedAt")}>{c.refRotatedAt ? formatDateTime(c.refRotatedAt) : t("srs.dl.never")}</Row>
              </dl>
              {/* P31 (AC-520): aynı bağlantı Mac'te .zip indirir */}
              <p className="text-sm text-fg-muted" data-testid="customer-mac-note">
                {t("rq.linkMacNote")}
              </p>
              {/* P19 (AC-259): web talep formu bağlantısı (form açıksa; aynı ref) */}
              {c.webFormUrl && (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3" data-testid="customer-web-form">
                  <p className="flex items-center gap-2 text-sm font-medium text-fg">
                    <Globe aria-hidden className="size-4 text-fg-muted" />
                    {t("cu.webForm")}
                  </p>
                  <code className="font-mono text-sm text-fg break-all" data-testid="customer-web-form-url">
                    {c.webFormUrl}
                  </code>
                  <CopyLink url={c.webFormUrl} srLabel={t("cu.webFormCopy", { name: c.name })} testId="customer-web-form-copy" />
                </div>
              )}
              <CustomerActions customer={c} canEdit={canEdit} canDelete={false} only="rotate" />
            </>
          ) : (
            <Alert tone="warning" testId="customer-link-passive">
              {t("cu.linkPassiveLong")}
            </Alert>
          )}
        </section>

        <section aria-labelledby="bilgiler" className="border-t border-border pt-6">
          <h2 id="bilgiler" className="flex items-center gap-2 text-lg font-semibold text-fg">
            <UserRound aria-hidden className="size-5 text-primary" />
            {t("cu.info")}
          </h2>
          {anon && (
            <div className="mt-3">
              <Alert tone="warning" testId="customer-anonymized">
                {t("cu.anonymizedNote", { at: formatDateTime(c.anonymizedAt ?? c.createdAt) })}
              </Alert>
            </div>
          )}
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <Row label={t("cu.f.contact")}>{pii(c.contactName)}</Row>
            <Row label={t("cu.f.phone")}>
              <span className="tabular-nums">{pii(c.phone)}</span>
            </Row>
            <Row label={t("cu.f.email")}>{pii(c.email)}</Row>
            <Row label={t("cu.f.note")} testId="customer-note">
              <span className="whitespace-pre-wrap">{pii(c.note)}</span>
            </Row>
            <Row label={t("cu.f.fileLabel")}>
              <span className="font-mono">{c.fileLabel}</span>
            </Row>
            <Row label={t("cu.col.created")}>
              <span className="tabular-nums">{formatDateTime(c.createdAt)}</span>
            </Row>
            <Row label={t("cu.col.lastRequest")}>
              <span className="tabular-nums">{c.lastRequestAt ? formatDateTime(c.lastRequestAt) : "—"}</span>
            </Row>
            <Row label={t("cu.col.requests")} testId="customer-detail-count">
              <span className="tabular-nums">{formatNumber(c.requestCount)}</span>
            </Row>
            <Row label={t("cu.sessionCount")}>
              <span className="tabular-nums">{formatNumber(c.sessionCount)}</span>
            </Row>
          </dl>
        </section>
        {/* P27 (AC-296, 337): gözetimsiz bildirim adresleri — yalnız `unattended.manage` */}
        {perms.includes("unattended.manage") && <NotifyContacts customerId={c.id} />}
        {/* P21 (AC-262): müşteri portal hesapları — yalnız `customers.portal` (uç da 403) */}
        {perms.includes("customers.portal") && <PortalAccounts customerId={c.id} customerActive={c.status === "ACTIVE" && !anon} />}
      </div>

      <CustomerTabs
        customerId={c.id}
        canRequests={perms.includes("support_requests.view")}
        canSessions={perms.includes("session_history.view")}
      />
    </>
  );
}
