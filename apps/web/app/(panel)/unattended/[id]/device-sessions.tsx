"use client";

import type { SessionListResponse } from "@remote/contracts/api/sessions";
import { ChevronRight, History, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { deviceSessionsPath } from "@/lib/unattended/query";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: SessionListResponse };

function useSessions(deviceId: string) {
  const router = useRouter();
  const [nonce, setNonce] = useState(0);
  const [res, setRes] = useState<{ nonce: number; state: State } | null>(null);
  useEffect(() => {
    let live = true;
    api<SessionListResponse>("GET", deviceSessionsPath(deviceId)).then(
      (data) => live && setRes({ nonce, state: { kind: "ok", data } }),
      (e: unknown) => {
        if (!live) return;
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        setRes({ nonce, state: { kind: "error" } });
      },
    );
    return () => {
      live = false;
    };
  }, [deviceId, nonce, router]);
  const state: State = res?.nonce === nonce ? res.state : { kind: "loading" };
  return { state, retry: () => setNonce((n) => n + 1) };
}

function SessionsLoading() {
  return (
    <div aria-busy="true" data-testid="un-sessions-loading">
      <span className="sr-only" role="status">
        {t("panel.loading")}
      </span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="mb-2 h-12 w-full" />
      ))}
    </div>
  );
}

function SessionsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="un-sessions-error">
      <Alert tone="danger">{t("un.sessions.error")}</Alert>
      <Button variant="secondary" onClick={onRetry} className="self-start">
        <RotateCw aria-hidden className="size-4" />
        {t("err.retry")}
      </Button>
    </div>
  );
}

/** Son 20 gözetimsiz oturum (AC-275): mevcut geçmiş ucu `mode=UNATTENDED&deviceId=`; satır → geçmiş ayrıntısı. */
export function DeviceSessions({ deviceId }: { deviceId: string }) {
  const { state, retry } = useSessions(deviceId);
  if (state.kind === "loading") return <SessionsLoading />;
  if (state.kind === "error") return <SessionsError onRetry={retry} />;
  if (state.data.items.length === 0)
    return <EmptyState Icon={History} title={t("un.sessions.empty")} body={t("un.sessions.emptyBody")} testId="un-sessions-empty" />;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface" data-testid="un-sessions">
      {state.data.items.map((s) => (
        <li key={s.id} data-testid="un-session-row">
          <Link
            href={`/history/${s.id}`}
            className="flex min-h-11 flex-col gap-1 px-3 py-2 hover:bg-surface-muted sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{s.technician.name}</span>
            <span className="text-sm tabular-nums text-fg">{formatDateTime(s.startedAt ?? s.createdAt)}</span>
            <span className="text-sm tabular-nums text-fg">{s.durationSec !== null ? formatDuration(s.durationSec) : "—"}</span>
            <span className="text-sm text-fg-muted">{t(`s.status.${s.status}`)}</span>
            <ChevronRight aria-hidden className="hidden size-4 text-fg-muted sm:block" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
