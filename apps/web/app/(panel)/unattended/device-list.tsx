"use client";

import { ChevronsDown, MonitorCog, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { LinkEmpty } from "@/components/list-page";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { DeviceListResponse } from "@/lib/unattended/contract";
import type { DeviceListParams } from "@/lib/unattended/query";
import { CreateCodeButton } from "./code-dialog";
import { ConnectDialog } from "./connect-dialog";
import { DeviceRows } from "./device-rows";
import { useConnect } from "./use-connect";
import { useDevicePoll } from "./use-device-poll";

const filtered = (p: DeviceListParams) => Boolean(p.q || p.customerId || p.state !== "all");

/** Boş durum: filtre varsa "uyan cihaz yok" + temizle; yoksa yönetici "kayıt kodu oluşturun", teknisyen "yetki yok". */
function Empty({ params, manage, createBlock }: { params: DeviceListParams; manage: boolean; createBlock: string | null }) {
  if (filtered(params))
    return (
      <LinkEmpty
        Icon={SearchX}
        title={t("un.noMatch")}
        body={t("un.noMatchBody")}
        testId="un-no-match"
        href="/unattended"
        label={t("un.clearFilters")}
      />
    );
  if (!manage) return <EmptyState Icon={MonitorCog} title={t("un.emptyTech")} body={t("un.emptyTechBody")} testId="un-empty-tech" />;
  return (
    <EmptyState
      Icon={MonitorCog}
      title={t("un.empty")}
      body={t("un.emptyBody")}
      testId="un-empty"
      action={<CreateCodeButton block={createBlock} testId="un-empty-create" />}
    />
  );
}

function MoreButton({ state, onClick }: { state: "idle" | "busy" | "error"; onClick: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {state === "error" && <Alert tone="danger">{t("un.moreError")}</Alert>}
      <Button variant="secondary" loading={state === "busy"} onClick={onClick} data-testid="un-more">
        {state !== "busy" && <ChevronsDown aria-hidden className="size-4" />}
        {t("un.more")}
      </Button>
    </div>
  );
}

/**
 * Cihazlar sekmesi gövdesi (AC-275, 293, 336, 337, 339): 8 sn yoklamalı liste, rozetler, Bağlan. Kısmi durum: yoklama
 * hatasında son veri + "durum güncellenemedi" bandı. Sayfa `key`'i filtre yoludur (filtre değişince durum sıfırlanır).
 */
export function DeviceList({
  initial,
  params,
  available,
  manage,
  createBlock,
}: {
  initial: DeviceListResponse;
  params: DeviceListParams;
  available: boolean;
  manage: boolean;
  createBlock: string | null;
}): ReactNode {
  const { data, stale, more, poll, loadMore } = useDevicePoll(initial, params.q, params.customerId, params.state);
  const flow = useConnect(() => void poll());
  const openConnect = (id: string) => {
    const d = data.items.find((x) => x.id === id);
    if (d) flow.open(d);
  };
  return (
    <section className="mt-4 flex flex-col gap-4" aria-label={t("un.tab.devices")}>
      {stale && (
        <Alert tone="warning" testId="un-stale">
          {t("un.stale")}
        </Alert>
      )}
      {data.items.length === 0 ? (
        <Empty params={params} manage={manage} createBlock={createBlock} />
      ) : (
        <>
          <DeviceRows items={data.items} available={available} busyId={flow.busyId} onConnect={openConnect} />
          <p className="text-sm text-fg-muted tabular-nums" role="status" data-testid="un-count">
            {t(data.nextCursor ? "un.countMore" : "un.count", { n: formatNumber(data.items.length) })}
          </p>
          {data.nextCursor && <MoreButton state={more} onClick={() => void loadMore()} />}
        </>
      )}
      <ConnectDialog flow={flow} />
    </section>
  );
}
