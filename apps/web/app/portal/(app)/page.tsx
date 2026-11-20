import type { PortalPage, PortalRequestItem, PortalSessionItem } from "@remote/contracts/api/portal";
import { PORTAL_PAGE_SIZE_DEFAULT } from "@remote/contracts/api/portal";
import { ChevronRight, Download, LifeBuoy } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoadError } from "@/components/load-error";
import { t } from "@/lib/i18n";
import { PORTAL_CHANGE_PASSWORD, PORTAL_NEW_REQUEST } from "@/lib/portal/paths";
import { getPortalMe, portalExpiredLogin, portalGet } from "@/lib/portal/server";
import { parsePortalQuery } from "@/lib/portal/view";
import type { ServerResult } from "@/lib/server-api";
import { PortalTabs, RequestsPanel, SessionsPanel } from "./history";

export const metadata: Metadata = { title: t("portal.home.title") };

type Search = Promise<{ tab?: string; page?: string }>;

const listPath = (kind: "requests" | "sessions", page: number, pageSize: number) => `/portal/${kind}?page=${page}&pageSize=${pageSize}`;

/** Oturum kapısı: 401 → giriş, 403 şifre değişimi → zorunlu ekran (iki listeden biri yeter). */
async function gate(...rs: ServerResult<unknown>[]) {
  if (rs.some((r) => r.kind === "error" && r.status === 401)) redirect(await portalExpiredLogin());
  if (rs.some((r) => r.kind === "error" && r.status === 403 && r.code === "PASSWORD_CHANGE_REQUIRED")) redirect(PORTAL_CHANGE_PASSWORD);
}

const actionCls =
  "group flex min-h-11 items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm hover:border-primary focus-visible:border-primary";

/**
 * /portal (AC-262): firma dosyası + yeni talep eylemleri; Talepler / Oturumlar geçmişi (yalnız meta, K-P21-7). İki liste
 * sunucuda paralel alınır: etkin sekme sayfasıyla, diğeri yalnız sayaç için (pageSize=1) → bir liste hata verirse o sekme
 * "yüklenemedi" olur, diğeri çalışır (kısmi durum).
 */
export default async function PortalHome({ searchParams }: { searchParams: Search }) {
  const s = await getPortalMe();
  if (s.kind !== "ok") return <LoadError />;
  const { tab, page } = parsePortalQuery(await searchParams);
  const size = (k: typeof tab) => (k === tab ? PORTAL_PAGE_SIZE_DEFAULT : 1);
  const [rq, ss] = await Promise.all([
    portalGet<PortalPage<PortalRequestItem>>(listPath("requests", tab === "requests" ? page : 1, size("requests"))),
    portalGet<PortalPage<PortalSessionItem>>(listPath("sessions", tab === "sessions" ? page : 1, size("sessions"))),
  ]);
  await gate(rq, ss);
  const { user, customer, links } = s.me;
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">{t("portal.home.welcome", { name: user.fullName })}</h1>
      <p className="mt-1 text-sm text-fg-muted">{t("portal.home.intro", { customer: customer.name })}</p>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <a
          href={links.downloadUrl}
          className={actionCls}
          data-testid="portal-download"
          aria-label={`${t("portal.download.aria", { file: links.fileName })} ${t("rq.linkMacNote")}`}
        >
          <Download aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-semibold text-fg">{t("portal.download.title")}</span>
            <span className="text-sm text-fg-muted">{t("portal.download.body")}</span>
            <span className="font-mono text-xs text-fg-muted break-all" data-testid="portal-file-name">
              {links.fileName}
            </span>
            {/* P31 (AC-520) */}
            <span className="text-xs text-fg-muted" data-testid="portal-mac-note">
              {t("rq.linkMacNote")}
            </span>
          </span>
        </a>
        {/* S-P21-12 sapması: Permissions-Policy belge yüklenirken sabitlenir → yeni talep sayfası (ekran paylaşımı) TAM yükleme ile açılır */}
        <a href={PORTAL_NEW_REQUEST} className={actionCls} data-testid="portal-new-request">
          <LifeBuoy aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-semibold text-fg">{t("portal.new.title")}</span>
            <span className="text-sm text-fg-muted">{t("portal.new.body")}</span>
          </span>
          <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        </a>
      </div>
      <section aria-labelledby="portal-history-h" className="mt-8">
        <h2 id="portal-history-h" className="sr-only">
          {t("portal.tabs.label")}
        </h2>
        <PortalTabs tab={tab} rq={rq} ss={ss} />
        {tab === "requests" ? <RequestsPanel res={rq} /> : <SessionsPanel res={ss} />}
      </section>
    </>
  );
}
