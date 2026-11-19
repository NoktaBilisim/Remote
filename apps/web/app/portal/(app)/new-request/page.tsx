import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { t } from "@/lib/i18n";
import { getPortalMe } from "@/lib/portal/server";
import { PortalBreadcrumb } from "../detail-parts";
import { PortalNewRequest } from "./portal-new-request";

export const metadata: Metadata = { title: t("portal.newreq.title") };

/**
 * /portal/new-request (K-P21-2): P19 web talep formu + bekleme odası AYNEN, veri kaynağı portal adaptörü
 * (`GET /portal/request-form`, `POST /portal/requests`). Firma web formu kapalı olsa da çalışır (sunucu kuralı).
 */
export default async function PortalNewRequestPage() {
  const s = await getPortalMe();
  if (s.kind !== "ok") return <LoadError />;
  return (
    <>
      <PortalBreadcrumb items={[{ label: t("portal.newreq.title") }]} />
      <div className="mx-auto w-full max-w-2xl">
        <PortalNewRequest me={s.me} />
      </div>
    </>
  );
}
