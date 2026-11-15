"use client";

import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmNameDialog } from "@/components/ui/confirm-name-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  PURGE_AUDIT_RETAIN_DAYS,
  TENANT_PURGE_DELAY_HOURS,
  purgeCountRows,
  purgeErrorOf,
  type TenantPurgePreviewResponse,
  type TenantPurgeScheduledResponse,
} from "@/lib/tenants/purge";

type Preview = { kind: "loading" } | { kind: "error"; error: UiError } | { kind: "ready"; data: TenantPurgePreviewResponse };

/**
 * Önizleme (dryRun sayımları) + ad yazarak onay → step-up → 202 (P16, AC-242). Önizleme 15 dk geçerli ve tek
 * kullanımlık; 428'de "Önizlemeyi yenile". Uygun değilse (409 PURGE_NOT_ELIGIBLE) tarih yazılır; açık iş çakışmasında
 * `onStale` (panel yenilenir).
 */
export function PurgeDialog({
  mode,
  tenantId,
  name,
  onClose,
  onScheduled,
  onStale,
}: {
  mode: "new" | "resume" | null;
  tenantId: string;
  name: string;
  onClose: () => void;
  onScheduled: (r: TenantPurgeScheduledResponse) => void;
  onStale: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [needPreview, setNeedPreview] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [seq, setSeq] = useState(0);
  // Üst bileşen her saniye yeniden çizilir (geri sayım); geri çağrı değişince önizleme yeniden istenmesin
  const staleRef = useRef(onStale);
  useEffect(() => {
    staleRef.current = onStale;
  }, [onStale]);

  const errOf = useCallback((e: unknown): UiError => {
    const m = purgeErrorOf(e);
    if (m.kind === "notEligible")
      return { message: m.eligibleAt ? t("tn.p.notEligibleAt", { at: formatDateTime(m.eligibleAt) }) : m.message, tone: "danger" };
    return toUiError(e, { 404: t("tn.p.notFound") });
  }, []);

  useEffect(() => {
    if (!mode) return;
    let alive = true;
    api<TenantPurgePreviewResponse>("POST", `/admin/tenants/${tenantId}/purge`, { dryRun: true })
      .then((data) => alive && setPreview({ kind: "ready", data }))
      .catch((e: unknown) => {
        if (!alive) return;
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        if (purgeErrorOf(e).kind === "refresh") return staleRef.current();
        setPreview({ kind: "error", error: errOf(e) });
      });
    return () => {
      alive = false;
    };
  }, [mode, tenantId, seq, router, errOf]);

  const refreshPreview = () => {
    setError(null);
    setNeedPreview(false);
    setPreview({ kind: "loading" });
    setSeq((n) => n + 1);
  };
  const close = () => {
    setError(null);
    setNeedPreview(false);
    setFieldError(undefined);
    setPreview({ kind: "loading" });
    onClose();
  };

  const run = async (confirmName: string) => {
    if (preview.kind !== "ready") return;
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    try {
      const r = await api<TenantPurgeScheduledResponse>("POST", `/admin/tenants/${tenantId}/purge`, {
        dryRun: false,
        previewId: preview.data.previewId,
        confirmName,
      });
      setPreview({ kind: "loading" });
      onScheduled(r);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      const m = purgeErrorOf(e);
      if (m.kind === "field") setFieldError(m.message);
      else if (m.kind === "preview") {
        setNeedPreview(true);
        setError({ message: m.message, tone: "danger" });
      } else if (m.kind === "refresh") staleRef.current();
      else setError({ ...errOf(e), requestId: e instanceof ApiError ? e.requestId : undefined });
    } finally {
      setBusy(false);
    }
  };

  const resume = mode === "resume";
  const expected = preview.kind === "ready" ? preview.data.tenant.name : name;
  return (
    <ConfirmNameDialog
      open={mode !== null}
      onClose={close}
      testId="purge-dialog"
      title={t(resume ? "tn.p.resumeTitle" : "tn.p.title", { name: expected })}
      description={t("tn.p.body")}
      expectedName={expected}
      confirmLabel={t(resume ? "tn.p.confirmResume" : "tn.p.confirm")}
      busy={busy}
      blocked={preview.kind !== "ready"}
      error={error}
      fieldError={fieldError}
      onTyped={() => setFieldError(undefined)}
      errorAction={
        needPreview && (
          <Button variant="secondary" className="self-start" onClick={refreshPreview} data-testid="purge-refresh-preview">
            <RotateCw aria-hidden className="size-4" />
            {t("tn.p.refreshPreview")}
          </Button>
        )
      }
      onConfirm={(n) => void run(n)}
    >
      {preview.kind === "loading" && (
        <div aria-busy="true" data-testid="purge-preview-loading">
          <p role="status" className="sr-only">
            {t("tn.p.loading")}
          </p>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        </div>
      )}
      {preview.kind === "error" && (
        <div className="flex flex-col gap-2" data-testid="purge-preview-error">
          <Alert tone={preview.error.tone}>
            <p className="font-medium">{t("tn.p.previewFailed")}</p>
            <p className="mt-1">{preview.error.message}</p>
          </Alert>
          <Button variant="secondary" className="self-start" onClick={refreshPreview} data-testid="purge-preview-retry">
            <RotateCw aria-hidden className="size-4" />
            {t("err.retry")}
          </Button>
        </div>
      )}
      {preview.kind === "ready" && <PreviewBody data={preview.data} resume={resume} />}
    </ConfirmNameDialog>
  );
}

function PreviewBody({ data, resume }: { data: TenantPurgePreviewResponse; resume: boolean }) {
  const rows = purgeCountRows(data.counts);
  return (
    <div className="flex flex-col gap-3" data-testid="purge-preview">
      <section aria-labelledby="pv-h">
        <h3 id="pv-h" className="text-sm font-medium text-fg">
          {t("tn.p.counts")}
        </h3>
        <dl className="mt-1.5 divide-y divide-border rounded-md border border-border bg-canvas text-sm">
          {rows.map((r) => (
            <div key={r.step} className="flex items-center justify-between gap-3 px-3 py-1.5" data-testid="purge-count-row">
              <dt className="min-w-0 text-fg-muted">{r.label}</dt>
              <dd className="font-medium text-fg tabular-nums">{formatNumber(r.count)}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 px-3 py-1.5" data-testid="purge-files-row">
            <dt className="text-fg-muted">{t("tn.p.files")}</dt>
            <dd className="font-medium text-fg tabular-nums">
              {t("tn.p.filesValue", { n: formatNumber(data.files.count), size: formatBytes(data.files.bytes) })}
            </dd>
          </div>
        </dl>
      </section>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
        <li data-testid="purge-audit-note">{t("tn.p.audit", { n: formatNumber(data.auditRetained), days: PURGE_AUDIT_RETAIN_DAYS })}</li>
        <li data-testid="purge-delay-note">{resume ? t("tn.p.resumeNote") : t("tn.p.delay", { hours: TENANT_PURGE_DELAY_HOURS })}</li>
      </ul>
    </div>
  );
}
