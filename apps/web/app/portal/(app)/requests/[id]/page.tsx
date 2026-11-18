import type { PortalRequestItem } from "@remote/contracts/api/portal";
import { Inbox, MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LIST_LINK_CLS } from "@/components/list-page";
import { t } from "@/lib/i18n";
import { requestFacts } from "@/lib/portal/view";
import { RequestStatusBadge } from "../../../../(panel)/requests/request-card";
import { Facts, loadPortalItem, PortalBackLink, PortalBreadcrumb } from "../../detail-parts";

export const metadata: Metadata = { title: t("portal.rq.detail") };

/** /portal/requests/[id] — talep meta (K-P21-7); bağlı oturum varsa bağlantı. Başkasının kaydı = yok (404). */
export default async function PortalRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadPortalItem<PortalRequestItem>("requests", id);
  if ("view" in r) return r.view;
  const it = r.ok;
  const f = requestFacts(it);
  return (
    <>
      <PortalBreadcrumb items={[{ label: t("portal.tabs.requestsBare"), href: "/portal" }, { label: it.requestCode }]} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-fg">
          <Inbox aria-hidden className="size-6 text-primary" />
          {t("portal.rq.detailTitle", { code: it.requestCode })}
        </h1>
        <RequestStatusBadge status={it.status} />
      </div>
      <Facts
        testId="portal-rq-facts"
        rows={[
          { label: t("portal.col.code"), value: <span className="font-mono">{it.requestCode}</span> },
          { label: t("portal.col.created"), value: f.created },
          { label: t("portal.col.closed"), value: f.closed },
          { label: t("portal.col.source"), value: f.source },
          { label: t("portal.col.priority"), value: f.priority },
          { label: t("portal.col.requester"), value: f.requester },
        ]}
      />
      <div className="mt-6 flex flex-wrap gap-4">
        {it.sessionId && (
          <Link href={`/portal/sessions/${it.sessionId}`} className={LIST_LINK_CLS} data-testid="portal-rq-session">
            <MonitorSmartphone aria-hidden className="size-4" />
            {t("portal.ss.openLinked")}
          </Link>
        )}
        {PortalBackLink}
      </div>
    </>
  );
}
