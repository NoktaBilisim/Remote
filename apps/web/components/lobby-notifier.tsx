"use client";

import { LOBBY_POLL_MS, waitingSessionsResponseSchema, type WaitingSessionsResponse } from "@remote/contracts/api/sessions";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH } from "@/lib/api";
import { t } from "@/lib/i18n";
import { consoleSessionId, lobbyToast, toPrev, type LobbyPrev } from "@/lib/lobby/diff";
import { setTitlePart } from "@/lib/tab-title";

/*
 * Bekleme odası (lobi) göstergesi (P13b-L, mimari-lobi §6.2–6.7, ADR-0029; AC-306..308, 312, 315).
 * GET /sessions/waiting 10 sn'de bir (setTimeout zinciri, üst üste binmez; sekme gizliyken de sürer, görünür olunca
 * hemen bir tur). Yalnız kendi oturumlarımın sayısı gelir (sunucu süzer). Sonuç küçük modül deposuna yazılır
 * (RequestNotifier deseni; sayfa içeriği sarılmaz): menü sayacı `LobbyCountBadge`, sekme başlığı `lib/tab-title`.
 * Hatalar sessizdir (AC-315): son değer korunur, toast/console yok; 401 → giriş, 403 → dur, 429 → Retry-After kadar bekle.
 */
interface Snapshot {
  enabled: boolean;
  count: number;
  sessions: WaitingSessionsResponse["sessions"];
}
const EMPTY: Snapshot = { enabled: false, count: 0, sessions: [] };
let snap: Snapshot = EMPTY;
const listeners = new Set<() => void>();
function patch(p: Partial<Snapshot>) {
  snap = { ...snap, ...p };
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

function useLobby(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => EMPTY,
  );
}

/** Sekme gizliyken ve bekleyen varken lobi başlık öneki (AC-308); aksi halde 0. */
function syncTitle() {
  setTitlePart("lobby", document.visibilityState === "hidden" && snap.enabled ? snap.count : 0);
}

/** Panel kabuğunda bir kez (`enabled` = sessions.view + tenant bağlamı). `scopeKey` değişirse temel çizgi yeniden alınır. */
export function LobbyNotifier({ enabled, scopeKey }: { enabled: boolean; scopeKey: string }) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const toastRef = useRef(toast);
  const [live, setLive] = useState("");

  useEffect(() => {
    pathRef.current = pathname;
    toastRef.current = toast;
  }, [pathname, toast]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** 429 sonrası bu ana kadar ek (görünürlük) yoklaması yapılmaz. */
    let holdUntil = 0;
    let prev: LobbyPrev | null = null;
    let lastCount: number | null = null;
    patch({ enabled: true, count: 0, sessions: [] });

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void poll(), ms);
    };

    const onData = (data: WaitingSessionsResponse) => {
      const n = lobbyToast(prev, data.sessions, consoleSessionId(pathRef.current));
      if (n) {
        const action =
          n.target.kind === "console"
            ? { label: t("s.openConsole"), href: `/sessions/${n.target.id}/console` }
            : { label: t("s.lobby.toastList"), href: "/sessions" };
        toastRef.current(n.n === 1 ? t("s.lobby.toastOne") : t("s.lobby.toastMany", { n: n.n }), "info", { action, durationMs: 15_000 });
      }
      // AC-312: canlı bölge yalnız sayı değişince (temel çizgide yazılmaz)
      if (lastCount !== null && lastCount !== data.count)
        setLive(data.count > 0 ? t("s.lobby.navSr", { n: data.count }) : t("s.lobby.liveNone"));
      lastCount = data.count;
      prev = toPrev(data.sessions);
      patch({ count: data.count, sessions: data.sessions });
      syncTitle();
    };

    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      let next = LOBBY_POLL_MS;
      try {
        const parsed = waitingSessionsResponseSchema.safeParse(await api<unknown>("GET", "/sessions/waiting"));
        if (!stopped && parsed.success) onData(parsed.data);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          stopped = true;
          router.replace(EXPIRED_LOGIN_PATH);
        } else if (e instanceof ApiError && e.status === 403) {
          // Yetki ya da firma bağlamı yok: dur, sayaç 0 (sayfa yenilemesiyle yeniden başlar)
          stopped = true;
          patch({ count: 0, sessions: [] });
          syncTitle();
        } else if (e instanceof ApiError && e.status === 429) {
          next = Math.max((e.retryAfter ?? 0) * 1000, LOBBY_POLL_MS);
          holdUntil = Date.now() + next;
        }
        // Ağ hatası, 5xx, şema hatası: son değer korunur, sessizce sonraki turda (AC-315)
      } finally {
        inFlight = false;
      }
      schedule(next);
    }

    const onVisibility = () => {
      syncTitle();
      if (document.visibilityState === "visible" && !inFlight && Date.now() >= holdUntil) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      patch(EMPTY);
      setTitlePart("lobby", 0);
      setLive("");
    };
  }, [enabled, scopeKey, router]);

  if (!enabled) return null;
  return (
    <p className="sr-only" aria-live="polite" data-testid="lobby-live">
      {live}
    </p>
  );
}

/** "Oturumlar" menü sayacı (AC-306, 312, 313): 0 iken render edilmez; uyarı tonu (talep rozetinden ve "Bekliyor"dan ayrışır). */
export function LobbyCountBadge() {
  const { count } = useLobby();
  if (!count) return null;
  return (
    <span
      data-testid="lobby-badge"
      className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full border border-warning/30 bg-warning-surface px-1.5 text-xs font-semibold text-warning tabular-nums transition-[opacity,transform] duration-200 ease-out starting:scale-95 starting:opacity-0 motion-reduce:starting:scale-100"
    >
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{t("s.lobby.navSr", { n: count })}</span>
    </span>
  );
}
