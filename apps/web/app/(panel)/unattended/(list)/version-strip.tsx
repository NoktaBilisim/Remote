import { FilterX, Info, Layers, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { serverGet } from "@/lib/server-api";
import type { DeviceVersionsResponse } from "@/lib/unattended/contract";
import { devicesHref, versionsApiPath, type DeviceListParams } from "@/lib/unattended/query";
import { PLATFORM_LABELS, publishedParts, sortVersionRows } from "@/lib/unattended/update";
import { StripRetry, VersionScope } from "./version-strip-parts";

const chip = "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm tabular-nums";

/** Yükleniyor: şerit iskeleti (liste ayrı akışla gelir). */
export function VersionStripSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-2" aria-busy="true" data-testid="upd-strip-loading">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="h-4 w-64" />
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-11 w-36" />
        ))}
      </div>
    </div>
  );
}

function Published({ data }: { data: DeviceVersionsResponse }) {
  const parts = publishedParts(data.published);
  if (!parts)
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted" data-testid="upd-published-none">
        <Info aria-hidden className="size-4 shrink-0" />
        {t("upd.publishedNone")}
      </p>
    );
  return (
    <p className="text-sm text-fg-muted" data-testid="upd-published">
      <span className="font-medium text-fg">{t("upd.published")}</span>{" "}
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 && " · "}
          {p.label} <span className="font-mono text-fg">{p.version ?? "—"}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * P29 sürüm dağılımı şeridi (mimari-p29 §6; AC-490): yayındaki sürüm satırı + sürüm → cihaz sayısı (platform ayrımlı). Firma
 * kapsamında her sürüm `?version=` süzgecine bağlantıdır; Super Admin "Tüm firmalar" (`scope=all`) yalnız sayıdır (alttaki
 * liste tek firmanındır). Durumlar: iskelet (Suspense), hata (yeniden dene; liste etkilenmez), kısmi (yayın bilgisi yok),
 * boş (cihaz yok → şerit çizilmez, listenin boş durumu konuşur). 403/404 (eski sunucu / yetki) → şerit gizli.
 */
export async function VersionStrip({ params, superAdmin }: { params: DeviceListParams; superAdmin: boolean }) {
  const all = superAdmin && params.scope === "all";
  const res = await serverGet<DeviceVersionsResponse>(versionsApiPath(all));
  if (res.kind === "error" && res.status === 401) redirect(EXPIRED_LOGIN_PATH);
  if (res.kind === "error" && (res.status === 403 || res.status === 404)) return null;
  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="upd-strip-h" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Layers aria-hidden className="size-4 text-fg-muted" />
        {t("upd.strip")}
      </h2>
      {superAdmin && <VersionScope params={params} />}
    </div>
  );
  if (res.kind === "error")
    return (
      <section aria-labelledby="upd-strip-h" className="mt-4 flex max-w-3xl flex-col gap-2" data-testid="upd-strip-error">
        {head}
        <Alert tone="warning">{t("upd.stripError")}</Alert>
        <div>
          <StripRetry />
        </div>
      </section>
    );
  const data = res.data;
  if (data.rows.length === 0 && !all && !params.version) return null;
  const rows = sortVersionRows(data.rows);
  return (
    <section aria-labelledby="upd-strip-h" className="mt-4 flex flex-col gap-2" data-testid="upd-strip" data-scope={all ? "all" : "tenant"}>
      {head}
      <Published data={data} />
      {rows.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t(all ? "upd.rowsAll" : "upd.rows")}>
          {rows.map((r) => {
            const label = t("upd.row", { platform: PLATFORM_LABELS[r.platform], version: r.version });
            const count = t("upd.devices", { n: formatNumber(r.count) });
            const current = data.published.service?.version === r.version;
            const body = (
              <>
                <span>{label}</span>
                <span className="font-semibold text-fg">{count}</span>
                {current && <span className="text-xs text-success">{t("upd.isPublished")}</span>}
              </>
            );
            const selected = params.version === r.version;
            return (
              <li key={`${r.platform}-${r.component}-${r.version}`} data-testid="upd-row" data-version={r.version}>
                {all ? (
                  <span className={`${chip} border-border bg-surface text-fg-muted`}>{body}</span>
                ) : (
                  <Link
                    href={devicesHref({ ...params, version: selected ? undefined : r.version })}
                    aria-current={selected ? "true" : undefined}
                    className={`${chip} ${selected ? "border-primary bg-primary-surface text-primary" : "border-border bg-surface text-fg-muted hover:bg-surface-muted"}`}
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data.belowMin > 0 && (
        <p className="flex items-center gap-2 text-sm font-medium text-danger" data-testid="upd-below-min">
          <ShieldAlert aria-hidden className="size-4 shrink-0" />
          {t("upd.belowMin", { n: formatNumber(data.belowMin) })}
        </p>
      )}
      {all && <p className="text-xs text-fg-muted">{t("upd.allNote")}</p>}
      {params.version && (
        <Link
          href={devicesHref({ ...params, version: undefined })}
          className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-primary hover:underline"
          data-testid="upd-clear"
        >
          <FilterX aria-hidden className="size-4" />
          {t("upd.clear", { version: params.version })}
        </Link>
      )}
    </section>
  );
}
