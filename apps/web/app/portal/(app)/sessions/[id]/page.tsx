import type { PortalSessionItem } from "@remote/contracts/api/portal";
import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/ui/badge";
import { t } from "@/lib/i18n";
import { sessionFacts } from "@/lib/portal/view";
import { Facts, loadPortalItem, PortalBackLink, PortalBreadcrumb } from "../../detail-parts";

export const metadata: Metadata = { title: t("portal.ss.detail") };

/** /portal/sessions/[id] — oturum meta (K-P21-7: not/sohbet/IP/cihaz/kayıt yok). Başkasının kaydı = yok (404). */
export default async function PortalSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadPortalItem<PortalSessionItem>("sessions", id);
  if ("view" in r) return r.view;
  const it = r.ok;
  const f = sessionFacts(it);
  return (
    <>
      <PortalBreadcrumb items={[{ label: t("portal.tabs.sessionsBare"), href: "/portal?tab=sessions" }, { label: f.created }]} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-fg">
          <MonitorSmartphone aria-hidden className="size-6 text-primary" />
          {t("portal.ss.detailTitle")}
        </h1>
        <StatusBadge status={it.status} />
      </div>
      <Facts
        testId="portal-ss-facts"
        rows={[
          { label: t("portal.col.created"), value: f.created },
          { label: t("portal.col.started"), value: f.started },
          { label: t("portal.col.ended"), value: f.ended },
          { label: t("portal.col.duration"), value: f.duration },
          { label: t("portal.col.mode"), value: f.mode },
          { label: t("portal.col.technician"), value: f.technician },
          { label: t("portal.col.contact"), value: f.contact },
          { label: t("portal.col.ticket"), value: <span className="font-mono">{f.ticket}</span> },
        ]}
      />
      <div className="mt-6">{PortalBackLink}</div>
    </>
  );
}
