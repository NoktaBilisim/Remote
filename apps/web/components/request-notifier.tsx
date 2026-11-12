"use client";

import { TriangleAlert } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { GENERAL_CUSTOMER_LABEL } from "@remote/contracts/labels";
import { parsePanelMessage, type PanelMessage } from "@/lib/requests/contract";
import { panelBackoff, panelCloseAction, titleWithCount } from "@/lib/requests/panel-socket";
import { playChime, readSoundPref, writeSoundPref } from "@/lib/requests/sound";

/*
 * Anlık talep bildirimi (AC-149, mimari-protokol §5.3): /ws/panel (çerez + Origin; sorgu dizesi yok, istemciden mesaj yok).
 * - queue.count → menü rozeti + sekme başlığı "(n) …"
 * - request.new → toast "Görüntüle" + ses (kapatılabilir; engellenirse yalnız görsel)
 * - request.removed / connect_failed / declined → abonelere (Talepler ekranı) + kabul edene toast
 * - queue.alert → kalıcı uyarı bandı (süre dolana kadar)
 * Yeniden bağlanınca sayı REST'ten (`/support-requests/count`) tazelenir ve abonelere "resync" iletilir
 * (kaçırılan olayların kaynağı REST). Etkin değilse (yetki yok / Super Admin firma seçmemiş) soket açılmaz.
 */
export type NotifierEvent = PanelMessage | { t: "resync" };

/*
 * Durum kenar çubuğu (rozet) ve Talepler ekranı tarafından okunur. RequestNotifier sayfa içeriğini SARMAZ
 * (istemci sağlayıcıyla sarmak loading.tsx akışında içeriği geçici olarak çift çiziyordu) → küçük modül deposu.
 */
interface Snapshot {
  enabled: boolean;
  count: number | null;
  connected: boolean;
  sound: boolean;
}
const SERVER_SNAPSHOT: Snapshot = { enabled: false, count: null, connected: false, sound: false };
let snap: Snapshot = SERVER_SNAPSHOT;
const snapListeners = new Set<() => void>();
const eventListeners = new Set<(e: NotifierEvent) => void>();
function patch(p: Partial<Snapshot>) {
  snap = { ...snap, ...p };
  snapListeners.forEach((fn) => fn());
}
const subscribeSnap = (fn: () => void) => {
  snapListeners.add(fn);
  return () => void snapListeners.delete(fn);
};
const subscribe = (fn: (e: NotifierEvent) => void) => {
  eventListeners.add(fn);
  return () => void eventListeners.delete(fn);
};
const emit = (e: NotifierEvent) => eventListeners.forEach((fn) => fn(e));
const setSound = (on: boolean) => {
  patch({ sound: on });
  writeSoundPref(on);
};
/** WS `queue.count` her geldiğinde artar; yolda olan REST sayısı daha yeni bir WS değerinin üzerine yazmaz. */
let countSeq = 0;
const setCount = (n: number) => {
  countSeq++;
  patch({ count: n });
};
const setConnected = (c: boolean) => patch({ connected: c });

export function useRequestNotifier() {
  const s = useSyncExternalStore(subscribeSnap, () => snap, () => SERVER_SNAPSHOT);
  return { ...s, setSound, subscribe };
}

/** Panel kabuğunda bir kez; yalnız uyarı bandını çizer (içerik sarmaz). */
export function RequestNotifier({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const pathname = usePathname();
  const { count } = useRequestNotifier();
  const [alertUntil, setAlertUntil] = useState<number | null>(null);

  useEffect(() => {
    patch({ enabled, sound: readSoundPref() });
    return () => patch({ enabled: false, count: null, connected: false });
  }, [enabled]);

  const onMessage = useCallback(
    (m: PanelMessage) => {
      switch (m.t) {
        case "queue.count":
          setCount(m.pending);
          break;
        case "request.new":
          toast(t("rq.toast.new", { name: m.customerName || t("rq.noName"), firm: m.customerFirm?.name ?? GENERAL_CUSTOMER_LABEL }), "info", {
            action: { label: t("rq.toast.view"), href: `/requests#talep-${m.id}` },
            durationMs: 8000,
          });
          if (snap.sound) void playChime();
          break;
        case "request.connect_failed":
          toast(t("rq.toast.connectFailed"), "danger", { durationMs: 8000 });
          break;
        case "request.declined":
          toast(t("rq.toast.declined"), "danger", { durationMs: 8000 });
          break;
        case "queue.alert": {
          const until = Date.parse(m.until);
          setAlertUntil(Number.isFinite(until) ? until : Date.now() + 15 * 60_000);
          break;
        }
        case "request.removed":
          break;
      }
      emit(m);
    },
    [toast],
  );

  // Soket yaşam döngüsü
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let unopened = 0;
    let everOpened = false;
    let stopped = false;

    const refreshCount = () => {
      const at = countSeq;
      return api<{ pending: number }>("GET", "/support-requests/count")
        .then((r) => {
          if (countSeq === at) setCount(r.pending);
        })
        .catch(() => {});
    };

    const connect = () => {
      let opened = false;
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/panel`);
      ws.onopen = () => {
        opened = everOpened = true;
        attempt = 0;
        unopened = 0;
        setConnected(true);
        void refreshCount();
        emit({ t: "resync" });
      };
      ws.onmessage = (e: MessageEvent) => {
        const m = parsePanelMessage(e.data);
        if (m) onMessage(m);
      };
      ws.onclose = (e: CloseEvent) => {
        setConnected(false);
        if (stopped) return;
        if (!opened) unopened++;
        if (panelCloseAction(e.code, opened || everOpened, unopened) === "stop") return;
        timer = setTimeout(connect, panelBackoff(attempt++));
      };
    };
    void refreshCount();
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        if (ws.readyState <= WebSocket.OPEN) ws.close(1000);
      }
    };
  }, [enabled, onMessage]);

  // Uyarı bandı süresi dolunca kalkar
  useEffect(() => {
    if (alertUntil === null) return;
    const left = Math.max(0, alertUntil - Date.now());
    const id = setTimeout(() => setAlertUntil(null), Math.min(left, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [alertUntil]);

  // Sekme başlığı: "(n) …". Konsol kendi okunmamış sohbet önekini kullanır (DESIGN §8) → orada dokunulmaz.
  useEffect(() => {
    if (!enabled || count === null || /\/console$/.test(pathname)) return;
    const apply = () => {
      const next = titleWithCount(document.title, count);
      if (document.title !== next) document.title = next;
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      obs.disconnect();
      document.title = titleWithCount(document.title, 0);
    };
  }, [enabled, count, pathname]);

  if (alertUntil === null) return null;
  return (
    <div
      role="alert"
      data-testid="queue-alert"
      className="mb-4 flex items-start gap-3 rounded-md border border-warning/30 bg-warning-surface px-3 py-2.5 text-sm text-warning"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0">
        <strong className="font-semibold">{t("rq.alert.title")}</strong> {t("rq.alert.body", { until: formatTime(alertUntil) })}
      </p>
    </div>
  );
}

/** Menü rozeti: bekleyen talep sayısı (0 ise gösterilmez). */
export function RequestCountBadge() {
  const { count } = useRequestNotifier();
  if (!count) return null;
  return (
    <span
      data-testid="requests-badge"
      className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary tabular-nums"
    >
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{t("rq.badgeSr", { n: count })}</span>
    </span>
  );
}
