"use client";

import {
  REC_BASIS_LABELS,
  REC_DELETE_ACTIVE_MESSAGE,
  REC_DELETE_REASON_LABELS,
  REC_STATE_REASON_LABELS,
  type RecordingView,
  type RecordingViewResponse,
  type SessionRecordingSummary,
} from "@remote/contracts/api/recording";
import type { SessionUnattendedInfo } from "@remote/contracts/api/sessions";
import { Eraser, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FormError } from "@/components/form-error";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { canPlay } from "@/lib/rec/support";
import { useHydrated } from "@/lib/use-hydrated";
import { CONSENT_MODE_LABELS } from "@/lib/unattended/contract";
import { RecordingPlayer } from "./recording-player";

type Meta = { kind: "loading" } | { kind: "ok"; v: RecordingView } | { kind: "error" } | { kind: "none" };

function useMeta(sessionId: string, enabled: boolean) {
  const [meta, setMeta] = useState<Meta>(enabled ? { kind: "loading" } : { kind: "none" });
  const router = useRouter();
  const load = useCallback(async () => {
    setMeta({ kind: "loading" });
    try {
      setMeta({ kind: "ok", v: await api<RecordingView>("GET", `/sessions/${sessionId}/recording`) });
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setMeta(e instanceof ApiError && (e.status === 404 || e.status === 403) ? { kind: "none" } : { kind: "error" });
    }
  }, [router, sessionId]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const v = await api<RecordingView>("GET", `/sessions/${sessionId}/recording`);
        if (live) setMeta({ kind: "ok", v });
      } catch (e) {
        if (!live) return;
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        setMeta(e instanceof ApiError && (e.status === 404 || e.status === 403) ? { kind: "none" } : { kind: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled, router, sessionId]);
  return { meta, reload: load };
}

function Row({ term, children, testId }: { term: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <dt className="text-xs text-fg-muted">{term}</dt>
      <dd className="text-sm text-fg wrap-anywhere">{children}</dd>
    </div>
  );
}

/** Meta: süre, boyut, dayanak, (gözetimsizde) kip + `silent` gerekçe (AC-450), durum, silinme tarihi. */
function MetaList({ r, v, unattended }: { r: SessionRecordingSummary; v: RecordingView | null; unattended?: SessionUnattendedInfo }) {
  const mode = v?.consentMode ?? unattended?.consentMode ?? null;
  const reason = v?.silentReason ?? unattended?.silentReason;
  const stop = r.stopReason ?? v?.stopReason;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="rec-meta">
      <Row term={t("hr.duration")}>{formatDuration(Math.round((v?.durationMs ?? r.durationMs) / 1000))}</Row>
      {v && <Row term={t("hr.size")}>{formatBytes(v.sizeBytes)}</Row>}
      <Row term={t("hr.basis")} testId="rec-basis">
        {REC_BASIS_LABELS[r.basis]}
      </Row>
      {mode && (
        <Row term={t("hr.mode")} testId="rec-mode">
          {CONSENT_MODE_LABELS[mode]}
        </Row>
      )}
      {mode === "silent" && reason && (
        <Row term={t("hr.reason")} testId="rec-reason">
          {reason}
        </Row>
      )}
      <Row term={t("hr.state")} testId="rec-state">
        {r.state === "active" ? t("hr.active") : stop ? `${t("hr.stopped")} — ${REC_STATE_REASON_LABELS[stop]}` : t("hr.stopped")}
      </Row>
      <Row term={t("hr.expires")}>{formatDateTime(r.expiresAt)}</Row>
    </dl>
  );
}

function DeleteDialog({ open, sessionId, onClose }: { open: boolean; sessionId: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", `/sessions/${sessionId}/recording`, { confirm: true });
      toast(t("hr.deleted"), "success");
      onClose();
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(e instanceof ApiError && e.status === 409 ? { message: REC_DELETE_ACTIVE_MESSAGE, tone: "danger" } : toUiError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("hr.deleteTitle")}
      description={t("hr.deleteBody")}
      size="sm"
      role="alertdialog"
      testId="rec-delete-dialog"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={close} disabled={busy} className="sm:ml-auto">
            {t("hr.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={confirm} data-testid="rec-delete-confirm">
            {!busy && <Trash2 aria-hidden className="size-4" />}
            {t("hr.deleteConfirm")}
          </Button>
        </>
      }
    >
      {error && <FormError error={error} />}
    </Dialog>
  );
}

/** "Kaydı izle": POST /view YALNIZ tıklamada (audit `recording.view`; effect/mount'ta asla). */
function useWatch(sessionId: string) {
  const [view, setView] = useState<RecordingViewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const start = async (): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const v = await api<RecordingViewResponse>("POST", `/sessions/${sessionId}/recording/view`, {});
      setView(v);
      return v.token;
    } catch (e) {
      setError(toUiError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { view, busy, error, start, close: () => setView(null) };
}

/**
 * P28e geçmiş detayı "Oturum kaydı" bölümü (mimari-p28e §9; AC-385, 386, 450). Durumlar: silindi (`Eraser` + neden), meta
 * yükleniyor (iskelet), hata (Tekrar dene), oynatıcı desteklenmiyor, izleme (satır içi oynatıcı), sil (onay diyaloğu,
 * varsayılan odak Vazgeç). İndirme düğmesi/ucu yok.
 */
export function RecordingSection({
  sessionId,
  r,
  unattended,
}: {
  sessionId: string;
  r: SessionRecordingSummary;
  unattended?: SessionUnattendedInfo;
}) {
  const hydrated = useHydrated();
  const live = r.state !== "deleted";
  const { meta, reload } = useMeta(sessionId, live && r.canView);
  const watch = useWatch(sessionId);
  const [del, setDel] = useState(false);

  if (!live)
    return (
      <p className="inline-flex items-center gap-2 text-sm text-fg-muted" data-testid="rec-deleted" data-reason={r.deleteReason}>
        <Eraser aria-hidden className="size-4" />
        {r.deleteReason ? REC_DELETE_REASON_LABELS[r.deleteReason] : t("hr.deleted")}
      </p>
    );

  const v = meta.kind === "ok" ? meta.v : null;
  return (
    <div className="flex flex-col gap-4" data-testid="rec-section" data-state={r.state}>
      {meta.kind === "loading" ? (
        <div className="flex flex-col gap-2" aria-busy data-testid="rec-loading">
          <span className="sr-only">{t("hr.loading")}</span>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : (
        <MetaList r={r} v={v} unattended={unattended} />
      )}
      {meta.kind === "error" && <LoadError onRetry={() => void reload()} />}
      {!r.canView && (
        <p className="text-sm text-fg-muted" data-testid="rec-noperm">
          {t("hr.noPerm")}
        </p>
      )}
      {r.canView && hydrated && !canPlay() && (
        <Alert tone="warning" testId="rec-unsupported">
          {t("hr.unsupported")}
        </Alert>
      )}
      {watch.error && <FormError error={watch.error} />}
      {v && watch.view && <RecordingPlayer v={v} view={watch.view} onRenew={watch.start} onClose={watch.close} durationMs={v.durationMs} />}
      <div className="flex flex-wrap gap-2">
        {r.canView && v && !watch.view && hydrated && canPlay() && (
          <Button onClick={() => void watch.start()} loading={watch.busy} data-testid="rec-watch">
            {!watch.busy && <Play aria-hidden className="size-4" />}
            {t("hr.watch")}
          </Button>
        )}
        {r.canDelete && r.state !== "active" && (
          <Button variant="danger-ghost" onClick={() => setDel(true)} data-testid="rec-delete">
            <Trash2 aria-hidden className="size-4" />
            {t("hr.delete")}
          </Button>
        )}
      </div>
      <p className="text-xs text-fg-muted">{t("hr.noDownload")}</p>
      <DeleteDialog open={del} sessionId={sessionId} onClose={() => setDel(false)} />
    </div>
  );
}
