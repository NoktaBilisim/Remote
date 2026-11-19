"use client";

import type { ActiveSessionItem, ActiveSessionsResponse } from "@remote/contracts/api/multi";
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
import { ACTIVE_POLL_MS, MAX_TECHS } from "@remote/contracts/ws-multi";
import { Eye, MonitorCog, MonitorSmartphone, Users } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { LoadError } from "@/components/load-error";
import { useJoin } from "@/components/multi/use-join";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "forbidden" } | { kind: "ok"; items: ActiveSessionItem[] };

/** "İzle" pasiflik nedeni (AC-372, V-PC-5): dolu / misafir multi1 yok; null = etkin (P28u r3: izinli oda kipi yok). */
export function watchBlock(s: ActiveSessionItem): string | null {
  if (!s.supported) return MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED;
  if (s.full) return MULTI_ERROR_MESSAGES.SESSION_FULL;
  return null;
}

/** 10 sn yoklama, yalnız bu bölüm açıkken (ACTIVE_POLL_MS). İlk hata → hata durumu; sonraki hatalarda son liste korunur. */
function useActive() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await api<ActiveSessionsResponse>("GET", "/sessions/active");
        if (!stopped) setLoad({ kind: "ok", items: r.items });
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && e.status === 403) return setLoad({ kind: "forbidden" });
        setLoad((l) => (l.kind === "ok" ? l : { kind: "error" }));
      }
      if (!stopped) timer = setTimeout(() => void poll(), ACTIVE_POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [tick]);
  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    setTick((n) => n + 1);
  }, []);
  return { load, retry };
}

/**
 * "Firmadaki etkin oturumlar" (mimari-p28c §10, AC-368): `sessions.supervise` sahibine; satırda "İzle" (izleyici olarak katıl).
 * Gözetimsiz odada step-up (lib/api). Sunucu yalnız çağıranın uygun olduğu gözetimsiz odaları listeler.
 */
export function ActiveSessions() {
  const headId = useId();
  const { load, retry } = useActive();
  const toast = useToast();
  const join = useJoin((_, e) => {
    toast(e.message, "danger");
    retry();
  });
  if (load.kind === "forbidden") return null;
  return (
    <section aria-labelledby={headId} className="mt-8 flex flex-col gap-3" data-testid="active-sessions">
      <div>
        <h2 id={headId} className="flex items-center gap-2 text-lg font-semibold text-fg">
          <Eye aria-hidden className="size-5 text-fg-muted" />
          {t("mt.active.title")}
        </h2>
        <p className="text-sm text-fg-muted">{t("mt.active.desc")}</p>
      </div>
      {load.kind === "loading" ? (
        <div className="flex flex-col gap-2" data-testid="active-loading" aria-busy>
          <span className="sr-only">{t("mt.active.loading")}</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : load.kind === "error" ? (
        <LoadError onRetry={retry} />
      ) : load.items.length === 0 ? (
        <EmptyState Icon={MonitorSmartphone} title={t("mt.active.empty")} body={t("mt.active.emptyHint")} testId="active-empty" />
      ) : (
        <ul className="flex flex-col gap-2">
          {load.items.map((s) => (
            <ActiveRow key={s.id} s={s} busy={join.busyId === s.id} onWatch={() => void join.start({ kind: "supervise", id: s.id })} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActiveRow({ s, busy, onWatch }: { s: ActiveSessionItem; busy: boolean; onWatch: () => void }) {
  const reasonId = useId();
  const block = watchBlock(s);
  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm sm:flex-row sm:items-center"
      data-testid="active-row"
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
          <span className="truncate">{s.customerName}</span>
          {s.unattended && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-surface px-2 py-0.5 text-xs font-medium text-primary">
              <MonitorCog aria-hidden className="size-3.5" />
              {t("mt.active.unattended")}
            </span>
          )}
        </p>
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          <div className="flex gap-1">
            <dt>{t("mt.active.tech")}:</dt>
            <dd className="text-fg">{s.technicianName}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{t("mt.active.started")}:</dt>
            <dd>
              <time dateTime={s.startedAt}>{formatDateTime(s.startedAt)}</time>
            </dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="flex items-center gap-1">
              <Users aria-hidden className="size-3.5" />
              {t("mt.active.techs")}:
            </dt>
            <dd className="tabular-nums">{t("mt.active.count", { n: Math.min(s.techCount, MAX_TECHS) })}</dd>
          </div>
        </dl>
        {block && (
          <p id={reasonId} className="mt-1 text-xs text-warning" data-testid="active-block">
            {block}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        onClick={onWatch}
        disabled={block !== null || busy}
        loading={busy}
        aria-label={t("mt.active.watchRow", { customer: s.customerName })}
        aria-describedby={block ? reasonId : undefined}
        className="shrink-0"
        data-testid="active-watch"
      >
        {!busy && <Eye aria-hidden className="size-4" />}
        {t("mt.active.watch")}
      </Button>
    </li>
  );
}
