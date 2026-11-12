"use client";

import { Inbox, RotateCw, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRequestNotifier } from "@/components/request-notifier";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { AcceptResult, SupportRequestItem, SupportRequestList } from "@/lib/requests/contract";
import { consolePath, requestErrorMessage } from "@/lib/requests/errors";
import { useNow } from "@/lib/use-now";
import { RejectDialog } from "./reject-dialog";
import { RequestCard } from "./request-card";

const POLL_MS = 15_000;

/**
 * TEST-P8b-2: bu sekmede kabul edilen talepler. Konsoldan geri dönülünce sayfa istemci yönlendirici önbelleğinden
 * (eski `initial`) çizilir; kabul edilen kart bu küme ile yerelde düşülür. Tam bfcache dönüşünde liste tazelenir.
 */
const acceptedHere = new Set<string>();

/**
 * Bekleyen talepler kuyruğu (AC-146, 149, 153, 157): ilk liste sunucudan; /ws/panel olaylarıyla canlı.
 * request.new → liste REST'ten tazelenir (WS önizlemesi telefon/e-posta taşımaz); request.removed → kart düşer;
 * soket yokken 15 sn'de bir yoklama (kısmi durum: son başarılı liste korunur, üstte uyarı).
 */
export function RequestQueue({ initial, canAccept, canSettings }: { initial: SupportRequestItem[]; canAccept: boolean; canSettings: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow(1000);
  const { subscribe, connected } = useRequestNotifier();
  const [items, setItems] = useState(() => initial.filter((x) => !acceptedHere.has(x.id)));
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SupportRequestItem | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    setRefreshing(true);
    try {
      const r = await api<SupportRequestList>("GET", "/support-requests?tab=pending");
      if (my !== seq.current) return;
      setItems(r.items.filter((x) => !acceptedHere.has(x.id)));
      setStale(false);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (my === seq.current) setStale(true);
    } finally {
      if (my === seq.current) setRefreshing(false);
    }
  }, [router]);

  const drop = useCallback((id: string) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.t === "request.removed") drop(e.id);
        else if (e.t === "request.new" || e.t === "resync") void refresh();
      }),
    [subscribe, drop, refresh],
  );

  useEffect(() => {
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) void refresh();
    };
    window.addEventListener("pageshow", show);
    return () => window.removeEventListener("pageshow", show);
  }, [refresh]);

  useEffect(() => {
    if (connected) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [connected, refresh]);

  const accept = async (it: SupportRequestItem) => {
    setBusyId(it.id);
    try {
      const r = await api<AcceptResult>("POST", `/support-requests/${it.id}/accept`, {});
      acceptedHere.add(it.id);
      router.push(consolePath(r));
    } catch (e) {
      setBusyId(null);
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      toast(requestErrorMessage(e), "danger", { durationMs: 6000 });
      if (e instanceof ApiError && (e.code === "REQUEST_TAKEN" || e.code === "REQUEST_CLOSED" || e.status === 404)) drop(it.id);
    }
  };

  return (
    <>
      {stale && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Alert tone="warning" testId="queue-stale">{t("rq.stale")}</Alert>
          <Button variant="secondary" onClick={() => void refresh()} loading={refreshing} className="shrink-0">
            {!refreshing && <RotateCw aria-hidden className="size-4" />}
            {t("err.retry")}
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite" data-testid="queue-count-live">{t("rq.countLive", { n: items.length })}</p>
      {items.length === 0 ? (
        <EmptyState
          Icon={Inbox}
          title={t("rq.emptyTitle")}
          body={t("rq.emptyBody")}
          testId="requests-empty"
          action={
            canSettings && (
              <Link href="/settings/support-requests" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline">
                <Settings aria-hidden className="size-4" />
                {t("rq.emptyAction")}
              </Link>
            )
          }
        />
      ) : (
        <ol className="flex flex-col gap-4" aria-label={t("rq.listLabel")}>
          {items.map((it) => (
            <li key={it.id}>
              <RequestCard
                item={it}
                now={now}
                canAccept={canAccept}
                busy={busyId === it.id}
                onAccept={() => void accept(it)}
                onReject={() => setRejecting(it)}
              />
            </li>
          ))}
        </ol>
      )}
      <RejectDialog
        item={rejecting}
        onClose={() => setRejecting(null)}
        onDone={(id) => {
          setRejecting(null);
          drop(id);
          toast(t("rq.rj.done"));
        }}
        onGone={(id, code) => {
          setRejecting(null);
          drop(id);
          toast(code === "REQUEST_TAKEN" ? t("rq.err.taken") : t("rq.err.closed"), "danger");
        }}
      />
    </>
  );
}
