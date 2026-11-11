"use client";

import type { SessionListResponse, SessionStatus, SessionView } from "@remote/contracts/api/sessions";
import { MonitorSmartphone, Plus, SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { formatTimeSeconds } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CancelDialog } from "./cancel-dialog";
import { TerminateDialog } from "./terminate-dialog";
import { NewSessionDialog } from "./new-session-dialog";
import { SessionList } from "./session-list";

type Filter = "all" | "open" | "closed";
const OPEN: readonly SessionStatus[] = ["PENDING", "ACTIVE"];
const REFRESH_MS = 10_000;

export function SessionsView(props: {
  initial: SessionView[];
  fetchedAt: number;
  canCreate: boolean;
  canCancel: boolean;
  showTechnician: boolean;
  meId: string;
  canTerminate: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(props.initial);
  const [updatedAt, setUpdatedAt] = useState(props.fetchedAt);
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SessionView | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<SessionView | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<SessionListResponse>("GET", "/sessions?pageSize=100");
      setItems(res.items);
      setUpdatedAt(Date.now());
      setStale(false);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setStale(true);
    }
  }, [router]);

  // Periyodik yenileme (durum/geri sayım sunucuyla hizalı kalır); sekme gizliyken istek atılmaz
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const open = items.filter((s) => OPEN.includes(s.status));
  const shown = filter === "all" ? items : filter === "open" ? open : items.filter((s) => !OPEN.includes(s.status));

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{t("s.title")}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t("s.subtitleShort")}</p>
        </div>
        {props.canCreate && (
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <Plus aria-hidden className="size-4" />
            {t("s.new")}
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          label={t("s.filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("s.filter.all"), count: items.length },
            { value: "open", label: t("s.filter.open"), count: open.length },
            { value: "closed", label: t("s.filter.closed"), count: items.length - open.length },
          ]}
        />
        <p className="text-xs text-fg-muted" data-testid="last-updated">
          {t("s.updated", { time: formatTimeSeconds(updatedAt) })}
        </p>
      </div>

      {stale && (
        <div className="mt-4">
          <Alert tone="warning" testId="refresh-error">
            {t("s.refreshFailed")}
          </Alert>
        </div>
      )}

      <div className="mt-4">
        {shown.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              Icon={MonitorSmartphone}
              title={t("s.emptyTitle")}
              body={t("s.emptyBody")}
              action={
                props.canCreate && (
                  <Button onClick={() => setCreating(true)}>
                    <Plus aria-hidden className="size-4" />
                    {t("s.new")}
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState Icon={SearchX} title={t("s.emptyFilterTitle")} body={t("s.emptyFilterBody")} />
          )
        ) : (
          <SessionList
            items={shown}
            showTechnician={props.showTechnician}
            canCancel={props.canCancel}
            onCancel={setCancelTarget}
            meId={props.meId}
            canTerminate={props.canTerminate}
            onTerminate={setTerminateTarget}
          />
        )}
      </div>

      {creating && (
        <NewSessionDialog
          canCancel={props.canCancel}
          onChanged={refresh}
          onClose={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
      <TerminateDialog
        session={terminateTarget}
        onClose={() => setTerminateTarget(null)}
        onDone={() => {
          setTerminateTarget(null);
          void refresh();
        }}
      />
      <CancelDialog
        session={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={() => {
          setCancelTarget(null);
          void refresh();
        }}
      />
    </>
  );
}
