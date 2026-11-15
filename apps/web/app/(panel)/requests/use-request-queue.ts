"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { useRequestNotifier } from "@/components/request-notifier";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { RequestSource } from "@remote/contracts/api/requests";
import type { SupportRequestItem, SupportRequestList } from "@/lib/requests/contract";
import { applyUpdate, serverOffset, sortQueue, withP18Defaults, type AssignedFilter } from "@/lib/requests/p18";

/* RequestQueue (request-queue.tsx) liste ve canlılık kancaları — PT-K13: bileşenden çıkarıldı; efekt sırası aynı
 * (yazışma ref'i → liste ref'i → saat ofseti → panel olayları → pageshow → yoklama). */

const POLL_MS = 15_000;

/**
 * TEST-P8b-2: bu sekmede kabul edilen talepler. Konsoldan geri dönülünce sayfa istemci yönlendirici önbelleğinden
 * (eski `initial`) çizilir; kabul edilen kart bu küme ile yerelde düşülür. Tam bfcache dönüşünde liste tazelenir.
 */
export const acceptedHere = new Set<string>();

/** Mesaj paneli yerleşimi: ≥ lg sağ panel, altında diyalog (bkz. implementation.md P18 H4 sapma: Vaul yok). */
const WIDE = "(min-width: 1024px)";
const subscribeWide = (fn: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", fn);
  return () => m.removeEventListener("change", fn);
};
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const prepare = (xs: SupportRequestItem[]) => sortQueue(xs.filter((x) => !acceptedHere.has(x.id)).map(withP18Defaults));

interface QueueFilter {
  customer?: string;
  assigned?: AssignedFilter;
  source?: RequestSource;
  meId: string;
}

/** Açık yazışma paneli, panel açıkken gelen etkinlik sayacı, kart başına okunmamış müşteri mesajı. */
export function useQueueThread() {
  const [thread, setThread] = useState<{ id: string; name: string; closed: boolean } | null>(null);
  const [activity, setActivity] = useState<Record<string, number>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const threadRef = useRef(thread);
  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);
  const openThread = (it: SupportRequestItem) => {
    setThread({ id: it.id, name: it.customerName ?? t("rq.anon"), closed: false });
    setUnread((u) => ({ ...u, [it.id]: 0 }));
  };
  return { thread, setThread, activity, setActivity, unread, setUnread, threadRef, openThread };
}
type QueueThread = ReturnType<typeof useQueueThread>;

async function fetchPending({ customer, assigned, source }: Omit<QueueFilter, "meId">): Promise<SupportRequestList> {
  const q = new URLSearchParams({ tab: "pending" });
  if (customer) q.set("customer", customer);
  if (assigned) q.set("assigned", assigned);
  if (source) q.set("source", source);
  return api<SupportRequestList>("GET", `/support-requests?${q.toString()}`);
}

type SetItems = (xs: SupportRequestItem[]) => void;

/** REST tazeleme: son istek kazanır; hata → kısmi durum (son başarılı liste korunur), oturum düştüyse giriş. */
function useQueueRefresh(filter: QueueFilter, setItems: SetItems, setOffsetMs: (ms: number) => void) {
  const router = useRouter();
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const { customer, assigned, source } = filter;
  const refresh = useCallback(async () => {
    const my = ++seq.current;
    setRefreshing(true);
    try {
      const r = await fetchPending({ customer, assigned, source });
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
  }, [router, customer, assigned, source, setItems, setOffsetMs]);
  return { stale, refreshing, refresh };
}

/** Liste durumu: ilk liste + sunucu saati ofseti (SLA sayacı), REST tazeleme, kart düşürme/güncelleme. */
export function useQueueList(initial: SupportRequestItem[], filter: QueueFilter, th: QueueThread) {
  const [items, setItems] = useState(() => prepare(initial));
  // Sunucu saati ofseti (SLA sayacı): ilk liste sunucuda çizildi, alındığı an ≈ ilk istemci çizimi
  const [offsetMs, setOffsetMs] = useState(0);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    const id = setTimeout(() => setOffsetMs(serverOffset(initial, Date.now())), 0);
    return () => clearTimeout(id);
  }, [initial]);
  const { stale, refreshing, refresh } = useQueueRefresh(filter, setItems, setOffsetMs);
  const { assigned, meId } = filter;
  const { setThread } = th;
  const drop = useCallback(
    (id: string) => {
      setItems((xs) => xs.filter((x) => x.id !== id));
      // Açık yazışma paneli salt okunur kalır (talep kapandı)
      setThread((cur) => (cur && cur.id === id ? { ...cur, closed: true } : cur));
    },
    [setThread],
  );
  const replace = useCallback(
    (next: SupportRequestItem) => {
      const u = { id: next.id, priority: next.priority, assignedTo: next.assignedTo, slaDueAt: next.slaDueAt };
      setItems((xs) => applyUpdate(xs, u, assigned, meId).items);
    },
    [assigned, meId],
  );
  return { items, setItems, itemsRef, offsetMs, stale, refreshing, refresh, drop, replace };
}
type QueueList = ReturnType<typeof useQueueList>;

/**
 * Canlılık (AC-146, 149, 153, 157): request.new/resync → REST tazeleme (WS önizlemesi telefon/e-posta taşımaz);
 * request.removed → kart düşer; request.updated → yerinde güncelle (görünmeyense tazele); request.activity → panel
 * sayacı / okunmamış. bfcache dönüşünde tazele; soket yokken 15 sn'de bir yoklama.
 */
export function useQueueLive(
  subscribe: ReturnType<typeof useRequestNotifier>["subscribe"],
  connected: boolean,
  list: QueueList,
  th: QueueThread,
  filter: QueueFilter,
) {
  const { drop, refresh, itemsRef, setItems } = list;
  const { threadRef, setActivity, setUnread } = th;
  const { assigned, meId } = filter;
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
    [subscribe, drop, refresh, assigned, meId, itemsRef, setItems, threadRef, setActivity, setUnread],
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
}
