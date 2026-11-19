"use client";

import type { CreateRequestResponse, WebFormInfo } from "@remote/contracts/api/requests";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";
import { readStoredAt, type StoredRequest } from "@/lib/web-request/flow";
import { publicRequestSource, type WebRequestSource } from "@/lib/web-request/source";
import { GuestEndScreen, GuestShell } from "../../session/guest-ui";
import { WaitingRoom } from "./waiting-room";
import { WebRequestForm } from "./web-request-form";

type Load =
  { kind: "loading" } | { kind: "ok"; info: WebFormInfo; issuedAt: number } | { kind: "notFound" } | { kind: "rate" } | { kind: "error" };

async function loadInfo(source: WebRequestSource): Promise<Load> {
  try {
    const info = await source.loadInfo();
    return { kind: "ok", info, issuedAt: Date.now() };
  } catch (e) {
    // P21: portal oturumu düştü / şifre değişimi gerekli → yönlendirildi; o arada iskelet kalır
    if (source.onGateError?.(e)) return { kind: "loading" };
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { kind: "notFound" };
    if (e instanceof ApiError && e.status === 429) return { kind: "rate" };
    return { kind: "error" };
  }
}

const session = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const saveStored = (key: string, stored: StoredRequest) => {
  try {
    session()?.setItem(key, JSON.stringify(stored));
  } catch {
    /* sekme depolaması kapalı: F5 dönüşü olmaz, akış sürer */
  }
};

const clearStored = (key: string) => {
  try {
    session()?.removeItem(key);
  } catch {
    /* yok sayılır */
  }
};

/** Form bilgisi + talep (F5'te sekme deposundan) durumu ve geçişleri. */
function useWebRequestFlow(source: WebRequestSource) {
  const key = source.storeKey;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // undefined = kullanıcı henüz seçim yapmadı → sekme deposundaki kayıt (F5 dönüşü); hidrasyondan önce bilinmez
  const [override, setReq] = useState<StoredRequest | null | undefined>(undefined);
  const hydrated = useHydrated();
  const req = override !== undefined ? override : hydrated ? readStoredAt(key, session()) : undefined;

  const fetchInfo = useCallback(async () => {
    const l = await loadInfo(source);
    setLoad(l);
    return l.kind === "ok" ? l.info : null;
  }, [source]);

  useEffect(() => {
    let live = true;
    void loadInfo(source).then((l) => live && setLoad(l));
    return () => {
      live = false;
    };
  }, [source]);

  const onCreated = (r: CreateRequestResponse, customerName: string) => {
    const stored = { requestSecret: r.requestSecret, requestCode: r.requestCode, customerName };
    saveStored(key, stored);
    setReq(stored);
  };
  const onFinished = () => clearStored(key);
  const reload = () => {
    setLoad({ kind: "loading" });
    void fetchInfo();
  };
  const newRequest = () => {
    onFinished();
    setReq(null);
    reload();
  };
  return { load, setLoad, req, fetchInfo, onCreated, onFinished, newRequest, reload };
}

function FlowLoading() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm" data-testid="wr-loading" aria-busy>
      <span className="sr-only">{t("wr.loading")}</span>
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-11 w-40" />
    </div>
  );
}

type Flow = ReturnType<typeof useWebRequestFlow>;

/** Gövde seçimi (öncelik: talep → bulunamadı → yükleniyor → hız sınırı/hata → form). */
function flowBody(source: WebRequestSource, f: Flow) {
  const { load, req } = f;
  if (req)
    return (
      <WaitingRoom
        request={req}
        downloadHref={source.downloadHref}
        retentionDays={load.kind === "ok" ? load.info.chatRetentionDays : null}
        onFinished={f.onFinished}
        onNewRequest={f.newRequest}
      />
    );
  if (load.kind === "notFound") return <GuestEndScreen kind="notFound" />;
  if (load.kind === "loading" || req === undefined) return <FlowLoading />;
  if (load.kind === "rate" || load.kind === "error")
    return (
      <GuestEndScreen
        kind={load.kind}
        action={
          <Button variant="secondary" onClick={f.reload} data-testid="wr-retry">
            {t("wr.retry")}
          </Button>
        }
      />
    );
  return (
    <WebRequestForm
      source={source}
      info={load.info}
      issuedAt={load.issuedAt}
      refreshInfo={f.fetchInfo}
      onCreated={f.onCreated}
      onNotFound={() => f.setLoad({ kind: "notFound" })}
    />
  );
}

/**
 * Form ↔ bekleme durumu. F5'te `sessionStorage`'daki talep sırrıyla bekleme sayfasına dönülür (sekme kapsamı).
 * Tenant bilgisi (logo) yalnız form bilgisinden gelir; bekleme ekranında aynı çerçeve kullanılır.
 */
export function WebRequestFlow({ tenantRef }: { tenantRef: string }) {
  const source = useMemo(() => publicRequestSource(tenantRef), [tenantRef]);
  return <WebRequestFlowWith source={source} />;
}

/**
 * P21 K-P21-2: aynı akış, verilen kaynak adaptörüyle. `framed=false` (portal) → müşteri çerçevesi yok; çağıranın kabuğu
 * (`<main>`) kullanılır. `source` kararlı olmalı (useMemo) — değişirse form bilgisi yeniden alınır.
 */
export function WebRequestFlowWith({ source }: { source: WebRequestSource }) {
  const f = useWebRequestFlow(source);
  if (!source.framed) return flowBody(source, f);
  const tenant = f.load.kind === "ok" ? f.load.info.tenant : undefined;
  return <GuestShell tenant={tenant}>{flowBody(source, f)}</GuestShell>;
}
