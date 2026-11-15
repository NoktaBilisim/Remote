"use client";

import type { SessionListItem } from "@remote/contracts/api/sessions";
import { labelOf, SESSION_SOURCE_LABELS } from "@remote/contracts/labels";
import { ChevronLeft, ChevronRight, Inbox, Lock, MonitorSmartphone, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { CUSTOMER_TAB_PAGE_SIZE_DEFAULT } from "@/lib/customers/contract";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { RequestStatusBadge } from "../../requests/request-card";

type Tab = "requests" | "sessions";
interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
type State<T> = { kind: "loading" } | { kind: "error"; forbidden: boolean } | { kind: "ok"; data: Page<T> };

function useTabData<T>(path: string, page: number) {
  const router = useRouter();
  const [nonce, setNonce] = useState(0);
  const key = `${path}|${page}|${nonce}`;
  const [res, setRes] = useState<{ key: string; state: State<T> } | null>(null);
  useEffect(() => {
    let live = true;
    api<Page<T>>("GET", `${path}?page=${page}&pageSize=${CUSTOMER_TAB_PAGE_SIZE_DEFAULT}`).then(
      (data) => live && setRes({ key, state: { kind: "ok", data } }),
      (e: unknown) => {
        if (!live) return;
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        setRes({ key, state: { kind: "error", forbidden: e instanceof ApiError && e.status === 403 } });
      },
    );
    return () => {
      live = false;
    };
  }, [path, page, key, router]);
  const state: State<T> = res?.key === key ? res.state : { kind: "loading" };
  return { state, retry: useCallback(() => setNonce((n) => n + 1), []) };
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / CUSTOMER_TAB_PAGE_SIZE_DEFAULT));
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("h.pager")} className="mt-3 flex items-center justify-between gap-2">
      <Button variant="secondary" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        <ChevronLeft aria-hidden className="size-4" />
        <span className="sr-only sm:not-sr-only">{t("h.prev")}</span>
      </Button>
      <span className="text-sm tabular-nums text-fg">{t("h.pageOf", { page: formatNumber(page), pages: formatNumber(pages) })}</span>
      <Button variant="secondary" onClick={() => onPage(page + 1)} disabled={page >= pages}>
        <span className="sr-only sm:not-sr-only">{t("h.next")}</span>
        <ChevronRight aria-hidden className="size-4" />
      </Button>
    </nav>
  );
}

function TabBody<T>({
  state,
  retry,
  empty,
  render,
}: {
  state: State<T>;
  retry: () => void;
  empty: React.ReactNode;
  render: (d: Page<T>) => React.ReactNode;
}) {
  if (state.kind === "loading")
    return (
      <div aria-busy="true" data-testid="customer-tab-loading">
        <span className="sr-only" role="status">
          {t("panel.loading")}
        </span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="mb-2 h-14 w-full" />
        ))}
      </div>
    );
  if (state.kind === "error")
    return state.forbidden ? (
      <Alert tone="locked" testId="customer-tab-forbidden">
        {t("cu.tab.forbidden")}
      </Alert>
    ) : (
      <div className="flex flex-col gap-3" data-testid="customer-tab-error">
        <Alert tone="danger">{t("cu.tab.error")}</Alert>
        <Button variant="secondary" onClick={retry} className="self-start">
          <RotateCw aria-hidden className="size-4" />
          {t("err.retry")}
        </Button>
      </div>
    );
  return state.data.items.length === 0 ? empty : render(state.data);
}

function RequestsTab({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const { state, retry } = useTabData<SupportRequestItem>(`/customers/${customerId}/requests`, page);
  return (
    <TabBody
      state={state}
      retry={retry}
      empty={<EmptyState Icon={Inbox} title={t("cu.tab.reqEmpty")} body={t("cu.tab.reqEmptyBody")} testId="customer-requests-empty" />}
      render={(d) => (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface" data-testid="customer-requests">
            {d.items.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-4"
                data-testid="customer-request-row"
              >
                <RequestStatusBadge status={r.status} />
                <span className="text-sm tabular-nums text-fg">{formatDateTime(r.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {r.customerName ?? <span className="text-fg-muted italic">{t("cu.anonymized")}</span>}
                </span>
                <span className="text-sm tabular-nums text-fg-muted">{t("rq.waited", { d: formatDuration(r.waitSec) })}</span>
              </li>
            ))}
          </ul>
          <Pager page={page} total={d.total} onPage={setPage} />
        </>
      )}
    />
  );
}

function SessionsTab({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const { state, retry } = useTabData<SessionListItem>(`/customers/${customerId}/sessions`, page);
  return (
    <TabBody
      state={state}
      retry={retry}
      empty={
        <EmptyState
          Icon={MonitorSmartphone}
          title={t("cu.tab.sesEmpty")}
          body={t("cu.tab.sesEmptyBody")}
          testId="customer-sessions-empty"
        />
      }
      render={(d) => (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface" data-testid="customer-sessions">
            {d.items.map((s) => (
              <li key={s.id} data-testid="customer-session-row">
                <Link
                  href={`/history/${s.id}`}
                  className="flex min-h-11 flex-col gap-1 px-3 py-2 hover:bg-surface-muted sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{s.technician.name}</span>
                  <span className="text-sm tabular-nums text-fg">
                    {s.startedAt ? formatDateTime(s.startedAt) : formatDateTime(s.createdAt)}
                  </span>
                  <span className="text-sm tabular-nums text-fg">{s.durationSec !== null ? formatDuration(s.durationSec) : "—"}</span>
                  <span className="text-sm text-fg-muted">{labelOf(SESSION_SOURCE_LABELS, s.source)}</span>
                  <ChevronRight aria-hidden className="hidden size-4 text-fg-muted sm:block" />
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} total={d.total} onPage={setPage} />
        </>
      )}
    />
  );
}

/**
 * Müşteri detay sekmeleri (AC-178, K23): Talepler `support_requests.view`, Oturumlar `session_history.view` ister;
 * yetki yoksa sekme içinde "Bu sekmeyi görme yetkiniz yok" (`Lock`). Her sekmede yükleniyor/boş/hata. 25/sayfa.
 */
export function CustomerTabs({ customerId, canRequests, canSessions }: { customerId: string; canRequests: boolean; canSessions: boolean }) {
  const [tab, setTab] = useState<Tab>("requests");
  const allowed = tab === "requests" ? canRequests : canSessions;
  return (
    <section aria-labelledby="musteri-sekmeler" className="mt-8 border-t border-border pt-6">
      <h2 id="musteri-sekmeler" className="sr-only">
        {t("cu.tabs")}
      </h2>
      <Segmented<Tab>
        label={t("cu.tabs")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "requests", label: t("cu.tab.requests"), icon: <Inbox aria-hidden className="size-4" /> },
          { value: "sessions", label: t("cu.tab.sessions"), icon: <MonitorSmartphone aria-hidden className="size-4" /> },
        ]}
      />
      <div className="mt-4" data-testid={`customer-tab-${tab}`}>
        {!allowed ? (
          <EmptyState Icon={Lock} title={t("cu.tab.forbidden")} body={t("cu.tab.forbiddenBody")} testId="customer-tab-forbidden" />
        ) : tab === "requests" ? (
          <RequestsTab customerId={customerId} />
        ) : (
          <SessionsTab customerId={customerId} />
        )}
      </div>
    </section>
  );
}
