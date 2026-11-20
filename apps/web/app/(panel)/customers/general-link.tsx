import Link from "next/link";
import { Link2, Settings } from "lucide-react";
import { CopyLink } from "@/components/copy-link";
import { LIST_LINK_CLS } from "@/components/list-page";
import { Alert } from "@/components/ui/alert";
import type { GeneralLinkResponse } from "@/lib/customers/contract";
import { t } from "@/lib/i18n";

/** Genel bağlantı şeridi (AC-175): salt okunur + Kopyala; yenileme yalnız Ayarlar'dan. Alınamazsa kısmi durum uyarısı. */
export function GeneralLink({ data, canSettings }: { data: GeneralLinkResponse | null; canSettings: boolean }) {
  return (
    <section aria-labelledby="genel-baglanti" data-testid="general-link" className="mt-6 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <h2 id="genel-baglanti" className="flex items-center gap-2 text-base font-semibold text-fg">
            <Link2 aria-hidden className="size-5 text-primary" />
            {t("cu.general.title")}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{t("cu.general.body")}</p>
          {data && (
            <p className="mt-1 truncate font-mono text-xs text-fg-muted" title={data.fileName} data-testid="general-file-name">
              {data.fileName}
            </p>
          )}
          {/* P31 (AC-520) */}
          {data && (
            <p className="mt-1 text-xs text-fg-muted" data-testid="general-mac-note">
              {t("rq.linkMacNote")}
            </p>
          )}
          {canSettings && (
            <Link href="/settings/support-requests" className={LIST_LINK_CLS}>
              <Settings aria-hidden className="size-4" />
              {t("cu.general.manage")}
            </Link>
          )}
        </div>
        {data ? (
          <CopyLink url={data.downloadUrl} srLabel={t("cu.general.copy")} testId="general-copy" />
        ) : (
          <div className="lg:max-w-sm">
            <Alert tone="warning" testId="general-link-error">
              {t("cu.general.error")}
            </Alert>
          </div>
        )}
      </div>
    </section>
  );
}
