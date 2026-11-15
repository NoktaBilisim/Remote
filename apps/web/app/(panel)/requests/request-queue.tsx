"use client";

import { Inbox, RotateCw, Settings, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { markSelfAssigned, useRequestNotifier } from "@/components/request-notifier";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { AcceptResult, SupportRequestItem, SupportRequestList } from "@/lib/requests/contract";
import { consolePath, requestErrorMessage } from "@/lib/requests/errors";
import { useNow } from "@/lib/use-now";
import { toUiError, type UiError } from "@/lib/error-message";
import { applyUpdate, serverOffset, sortQueue, withP18Defaults, type AssignedFilter, type RequestPriority } from "@/lib/requests/p18";
import { AssignDialog } from "./assign-menu";
import { RejectDialog } from "./reject-dialog";
import { RequestThread } from "./request-thread";
import { RequestCard } from "./request-card";
import { RevokeBindingDialog } from "./revoke-binding-dialog";
import { RequestBlockDialog } from "@/components/request-blocks/block-dialogs";

const POLL_MS = 15_000;

/**
 * TEST-P8b-2: bu sekmede kabul edilen talepler. Konsoldan geri dönülünce sayfa istemci yönlendirici önbelleğinden
 * (eski `initial`) çizilir; kabul edilen kart bu küme ile yerelde düşülür. Tam bfcache dönüşünde liste tazelenir.
 */
const acceptedHere = new Set<string>();

/** Mesaj paneli yerleşimi: ≥ lg sağ panel, altında diyalog (bkz. implementation.md P18 H4 sapma: Vaul yok). */
const WIDE = "(min-width: 1024px)";
const subscribeWide = (fn: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", fn);
  return () => m.removeEventListener("change", fn);
};
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const prepare = (xs: SupportRequestItem[]) => sortQueue(xs.filter((x) => !acceptedHere.has(x.id)).map(withP18Defaults));

/**
 * Bekleyen talepler kuyruğu (AC-146, 149, 153, 157): ilk liste sunucudan; /ws/panel olaylarıyla canlı.
 * request.new → liste REST'ten tazelenir (WS önizlemesi telefon/e-posta taşımaz); request.removed → kart düşer;
 * soket yokken 15 sn'de bir yoklama (kısmi durum: son başarılı liste korunur, üstte uyarı).
 */
export function RequestQueue({
  initial,
  canAccept,
  canSettings,
  canRevoke = false,
  canBlock = false,
  customer,
  meId = "",
  assigned,
  canAssign = false,
  canMessage = false,
}: {
  initial: SupportRequestItem[];
  canAccept: boolean;
  canSettings: boolean;
  /** P8c r2 (§15.2) + B-P8c-3: `customers.edit` ve `support_requests.view`. */
  canRevoke?: boolean;
  /** P15 (AC-235): `support_requests.block` → kart menüsünde "Bu kaynağı engelle". */
  canBlock?: boolean;
  /** P8c (AC-176): müşteri filtresi (`general` | ULID); yenilemelerde de uygulanır. */
  customer?: string;
  /** P18: oturumdaki kullanıcı (atama filtresi, "Bana ata", kabul onayı). */
  meId?: string;
  /** P18 (AC-256): `me` = bana atanan, `none` = atanmamış. */
  assigned?: AssignedFilter;
  /** P18 (AC-256, 257): `support_requests.assign` → atama ve öncelik menüsü. */
  canAssign?: boolean;
  /** P18 (AC-255, S-P18-T3): `support_requests.message` → mesaj yazma alanı. */
  canMessage?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow(1000);
  const wide = useWide();
  const { subscribe, connected } = useRequestNotifier();
  const [items, setItems] = useState(() => prepare(initial));
  // Sunucu saati ofseti (SLA sayacı): ilk liste sunucuda çizildi, alındığı an ≈ ilk istemci çizimi
  const [offsetMs, setOffsetMs] = useState(0);
  const [assigning, setAssigning] = useState<SupportRequestItem | null>(null);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<UiError | null>(null);
  const [confirmAccept, setConfirmAccept] = useState<SupportRequestItem | null>(null);
  const [thread, setThread] = useState<{ id: string; name: string; closed: boolean } | null>(null);
  const [activity, setActivity] = useState<Record<string, number>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const threadRef = useRef(thread);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SupportRequestItem | null>(null);
  const [revoking, setRevoking] = useState<SupportRequestItem | null>(null);
  const [blocking, setBlocking] = useState<SupportRequestItem | null>(null);
  const seq = useRef(0);

  const itemsRef = useRef(items);
  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    const id = setTimeout(() => setOffsetMs(serverOffset(initial, Date.now())), 0);
    return () => clearTimeout(id);
  }, [initial]);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    setRefreshing(true);
    try {
      const q = new URLSearchParams({ tab: "pending" });
      if (customer) q.set("customer", customer);
      if (assigned) q.set("assigned", assigned);
      const r = await api<SupportRequestList>("GET", `/support-requests?${q.toString()}`);
      if (my !== seq.current) return;
      setItems(prepare(r.items));
      setOffsetMs(serverOffset(r.items, Date.now()));
      setStale(false);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (my === seq.current) setStale(true);
    } finally {
      if (my === seq.current) setRefreshing(false);
    }
  }, [router, customer, assigned]);

  const drop = useCallback((id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    // Açık yazışma paneli salt okunur kalır (talep kapandı)
    setThread((th) => (th && th.id === id ? { ...th, closed: true } : th));
  }, []);

  const replace = useCallback(
    (next: SupportRequestItem) => {
      const u = { id: next.id, priority: next.priority, assignedTo: next.assignedTo, slaDueAt: next.slaDueAt };
      setItems((xs) => applyUpdate(xs, u, assigned, meId).items);
    },
    [assigned, meId],
  );

  useEffect(
    () =>
      subscribe((e) => {
        if (e.t === "request.removed") drop(e.id);
        else if (e.t === "request.new" || e.t === "resync") void refresh();
        else if (e.t === "request.updated") {
          const r = applyUpdate(itemsRef.current, e, assigned, meId);
          setItems(r.items);
          if (r.missing) void refresh();
        } else if (e.t === "request.activity") {
          if (threadRef.current?.id === e.id) setActivity((a) => ({ ...a, [e.id]: (a[e.id] ?? 0) + 1 }));
          else if (e.sender === "CUSTOMER") setUnread((u) => ({ ...u, [e.id]: Math.min((u[e.id] ?? 0) + 1, 999) }));
        }
      }),
    [subscribe, drop, refresh, assigned, meId],
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
    setConfirmAccept(null);
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

  /** K-P18-3: başkasına atanmış talep kabul edilebilir ama önce onay istenir. */
  const requestAccept = (it: SupportRequestItem) => {
    if (it.assignedTo && it.assignedTo.id !== meId) setConfirmAccept(it);
    else void accept(it);
  };

  /** Atama / öncelik ortak hata yolu: kapanmış talep düşer, diğerleri toast. */
  const assignFailed = (it: SupportRequestItem, e: unknown): UiError | null => {
    if (isUnauthenticated(e)) {
      router.replace(EXPIRED_LOGIN_PATH);
      return null;
    }
    if (e instanceof ApiError && (e.code === "REQUEST_CLOSED" || e.status === 404)) {
      drop(it.id);
      toast(t("rq.err.closed"), "danger");
      return null;
    }
    return toUiError(e);
  };

  const assignTo = async (it: SupportRequestItem, userId: string | null, fromDialog = false) => {
    setAssignBusy(it.id);
    setAssignError(null);
    if (userId && userId === meId) markSelfAssigned(it.id);
    try {
      const next = await api<SupportRequestItem>("POST", `/support-requests/${it.id}/assign`, { userId });
      replace(withP18Defaults(next));
      if (fromDialog) setAssigning(null);
      toast(userId === null ? t("rq.as.cleared") : t("rq.as.done", { name: next.assignedTo?.name ?? "" }));
    } catch (e) {
      const ui = assignFailed(it, e);
      if (ui && e instanceof ApiError && e.status === 400 && e.fields?.userId) {
        if (fromDialog) setAssignError({ message: e.fields.userId, tone: "danger", requestId: e.requestId });
        else toast(e.fields.userId, "danger", { durationMs: 6000 });
      } else if (ui) {
        if (fromDialog) setAssignError(ui);
        else toast(ui.message, "danger", { durationMs: 6000 });
      } else if (fromDialog) setAssigning(null);
    } finally {
      setAssignBusy(null);
    }
  };

  const setPriority = async (it: SupportRequestItem, priority: RequestPriority) => {
    setAssignBusy(it.id);
    try {
      const next = await api<SupportRequestItem>("POST", `/support-requests/${it.id}/priority`, { priority });
      replace(withP18Defaults(next));
      toast(t("rq.p.done"));
    } catch (e) {
      const ui = assignFailed(it, e);
      if (ui) toast(ui.message, "danger", { durationMs: 6000 });
    } finally {
      setAssignBusy(null);
    }
  };

  const openThread = (it: SupportRequestItem) => {
    setThread({ id: it.id, name: it.customerName ?? t("rq.anon"), closed: false });
    setUnread((u) => ({ ...u, [it.id]: 0 }));
  };

  const threadView = thread && (
    <RequestThread
      key={thread.id}
      requestId={thread.id}
      customerName={thread.name}
      canSend={canMessage}
      closed={thread.closed}
      activity={activity[thread.id] ?? 0}
      connected={connected}
      onClose={() => setThread(null)}
      headingLevel={2}
    />
  );

  return (
    <>
      {stale && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Alert tone="warning" testId="queue-stale">
            {t("rq.stale")}
          </Alert>
          <Button variant="secondary" onClick={() => void refresh()} loading={refreshing} className="shrink-0">
            {!refreshing && <RotateCw aria-hidden className="size-4" />}
            {t("err.retry")}
          </Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite" data-testid="queue-count-live">
        {t("rq.countLive", { n: items.length })}
      </p>
      <div className={thread && wide ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]" : ""}>
        <div className="min-w-0">
          {items.length === 0 ? (
            <EmptyState
              Icon={assigned === "me" ? UserCheck : Inbox}
              title={assigned === "me" ? t("rq.as.emptyMine") : assigned === "none" ? t("rq.as.emptyNone") : t("rq.emptyTitle")}
              body={assigned ? t("rq.as.emptyBody") : t("rq.emptyBody")}
              testId="requests-empty"
              action={
                assigned ? (
                  <Link
                    href={customer ? `/requests?customer=${encodeURIComponent(customer)}` : "/requests"}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <Inbox aria-hidden className="size-4" />
                    {t("rq.as.all")}
                  </Link>
                ) : (
                  canSettings && (
                    <Link
                      href="/settings/support-requests"
                      className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      <Settings aria-hidden className="size-4" />
                      {t("rq.emptyAction")}
                    </Link>
                  )
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
                    onAccept={() => requestAccept(it)}
                    onReject={() => setRejecting(it)}
                    onRevokeBinding={canRevoke ? () => setRevoking(it) : undefined}
                    onBlock={canBlock ? () => setBlocking(it) : undefined}
                    meId={meId}
                    offsetMs={offsetMs}
                    assign={
                      canAssign && meId
                        ? {
                            meId,
                            busy: assignBusy === it.id,
                            onOpenAssign: () => {
                              setAssignError(null);
                              setAssigning(it);
                            },
                            onAssign: (userId) => void assignTo(it, userId),
                            onPriority: (p) => void setPriority(it, p),
                          }
                        : undefined
                    }
                    onThread={() => openThread(it)}
                    unread={unread[it.id] ?? 0}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
        {thread && wide && (
          <aside
            aria-label={t("th.panel")}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm lg:sticky lg:top-20"
            data-testid="thread-panel"
          >
            {threadView}
          </aside>
        )}
      </div>
      {!wide && (
        <Dialog open={thread !== null} onClose={() => setThread(null)} testId="thread-dialog" title={t("th.panel")}>
          {threadView}
        </Dialog>
      )}
      <AssignDialog
        item={assigning}
        busy={assigning !== null && assignBusy === assigning.id}
        error={assignError}
        onClose={() => setAssigning(null)}
        onSubmit={(userId) => assigning && void assignTo(assigning, userId, true)}
      />
      <Dialog
        open={confirmAccept !== null}
        onClose={() => setConfirmAccept(null)}
        size="sm"
        role="alertdialog"
        testId="accept-assigned-dialog"
        title={t("rq.as.confirmTitle")}
        description={confirmAccept?.assignedTo ? t("rq.as.confirmBody", { name: confirmAccept.assignedTo.name }) : undefined}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmAccept(null)} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button onClick={() => confirmAccept && void accept(confirmAccept)} data-testid="accept-assigned-confirm">
              <UserCheck aria-hidden className="size-4" />
              {t("rq.as.confirmAccept")}
            </Button>
          </>
        }
      />
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
      <RequestBlockDialog
        request={blocking ? { id: blocking.id, name: blocking.customerName ?? t("rq.anon") } : null}
        onClose={() => setBlocking(null)}
        onSaved={() => {
          setBlocking(null);
          toast(t("bl.rq.done"));
        }}
      />
      <RevokeBindingDialog
        item={revoking}
        onClose={() => setRevoking(null)}
        onDone={(id) => {
          setRevoking(null);
          drop(id);
          toast(t("rq.revoke.done"));
          void refresh();
        }}
        onGone={(_id, message) => {
          setRevoking(null);
          toast(message, "danger");
          void refresh();
        }}
      />
    </>
  );
}
