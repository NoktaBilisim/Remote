import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadError } from "@/components/load-error";
import { EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";
import type { DeviceListResponse, UnattendedStatus } from "@/lib/unattended/contract";
import { createCodeBlock, gateOpen, isRiskAccepted } from "@/lib/unattended/errors";
import { devicesApiPath, parseDeviceParams } from "@/lib/unattended/query";
import { DeviceFilters } from "../device-filters";
import { DeviceList } from "../device-list";
import { accessOf, gateBody, UnattendedShell } from "../unattended-shell";
import { VersionStrip, VersionStripSkeleton } from "./version-strip";

export const metadata: Metadata = { title: t("nav.unattended") };

type SP = Record<string, string | string[] | undefined>;

/**
 * /unattended — Cihazlar sekmesi (P27-K8; AC-275, 293, 336, 337, 339, 342). İlk veri sunucuda, sonra 8 sn yoklama
 * (istemci). Yetki ve tenant kapsamı arka uçta da denetlenir; `manage` yoksa sunucu yalnız grant'lı cihazları döner.
 */
export default async function UnattendedPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getMe();
  if (me.kind !== "ok") redirect(EXPIRED_LOGIN_PATH);
  const access = accessOf({ ...me.me, permissions: me.me.permissions as readonly string[] });
  const gate = gateBody(access);
  if (gate)
    return (
      <UnattendedShell access={access} status={undefined} createBlock={null}>
        {gate}
      </UnattendedShell>
    );

  const params = parseDeviceParams(await searchParams);
  const path = devicesApiPath(params);
  const [st, res] = await Promise.all([serverGet<UnattendedStatus>("/unattended/status"), serverGet<DeviceListResponse>(path)]);
  if ((st.kind === "error" && st.status === 401) || (res.kind === "error" && res.status === 401)) redirect(EXPIRED_LOGIN_PATH);
  const status = st.kind === "ok" ? st.data : null;
  const available = gateOpen(status);
  const createBlock = createCodeBlock(status);
  const customerLabel = res.kind === "ok" ? (res.data.items.find((d) => d.customerId === params.customerId)?.customerName ?? null) : null;

  return (
    <UnattendedShell access={access} status={status} createBlock={createBlock}>
      {/* P29 (AC-490): sürüm dağılımı ayrı akış — hatası listeyi düşürmez */}
      <Suspense key={params.scope ?? "tenant"} fallback={<VersionStripSkeleton />}>
        <VersionStrip params={params} superAdmin={me.me.user.role === "SUPER_ADMIN"} />
      </Suspense>
      <DeviceFilters params={params} customerLabel={customerLabel} />
      {res.kind === "error" ? (
        <div className="mt-6 max-w-xl">
          <LoadError />
        </div>
      ) : (
        <DeviceList
          key={path}
          initial={res.data}
          params={params}
          available={available}
          manage={access.manage}
          createBlock={createBlock}
          riskAccepted={isRiskAccepted(status)}
        />
      )}
    </UnattendedShell>
  );
}
