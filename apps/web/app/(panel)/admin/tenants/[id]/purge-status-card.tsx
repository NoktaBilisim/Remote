"use client";

import { CalendarX2, CircleAlert, CircleCheck, CircleX, LoaderCircle, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { UiError } from "@/lib/error-message";
import { formatDateTime, formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { purgeErrorLabel, purgeProgress, TENANT_PURGE_OPEN_STATES, type TenantPurgeStatus } from "@/lib/tenants/purge";

/** Açık iş (SCHEDULED/RUNNING/FAILED) mı — panel "Kalıcı sil" düğmesini yalnız açık iş yokken gösterir. */
export const isOpenPurge = (job: TenantPurgeStatus | null): boolean =>
  job !== null && (TENANT_PURGE_OPEN_STATES as readonly string[]).includes(job.state);

function cardTone(job: TenantPurgeStatus): string {
  if (job.state === "FAILED") return "border-danger/30 bg-danger-surface";
  if (job.state === "DONE") return "border-success/30 bg-success-surface";
  if (isOpenPurge(job)) return "border-warning/30 bg-warning-surface";
  return "border-border bg-surface-muted";
}

/**
 * Silme işi durum kartı (P16, AC-242; mimari-e11 §7.8): SCHEDULED geri sayım + "Silmeyi iptal et"; RUNNING/DONE adım
 * çubuğu; FAILED adım + hata + "Sürdür"; CANCELLED iptal zamanı. Durum başlığı `role=status` ile duyurulur.
 */
export function PurgeStatusCard({
  job,
  remaining,
  cancelling,
  cancelError,
  onCancel,
  onResume,
}: {
  job: TenantPurgeStatus;
  remaining: number | null;
  cancelling: boolean;
  cancelError: UiError | null;
  onCancel: () => void;
  onResume: () => void;
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-md border p-3 sm:p-4 ${cardTone(job)}`} data-testid="purge-card">
      <p role="status" className="flex items-center gap-2 font-semibold text-fg" data-testid="purge-state">
        {job.state === "SCHEDULED" && <CalendarX2 aria-hidden className="size-5 shrink-0 text-warning" />}
        {job.state === "RUNNING" && (
          <LoaderCircle aria-hidden className="size-5 shrink-0 animate-spin text-warning motion-reduce:animate-none" />
        )}
        {job.state === "FAILED" && <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />}
        {job.state === "DONE" && <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />}
        {job.state === "CANCELLED" && <CircleX aria-hidden className="size-5 shrink-0 text-fg-muted" />}
        {t(`tn.p.s.${job.state}`)}
      </p>

      {job.state === "SCHEDULED" && (
        <>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-fg-muted">{t("tn.p.remaining")}</dt>
            <dd className="font-mono text-lg font-semibold text-fg tabular-nums" data-testid="purge-countdown">
              {remaining === null ? "—" : remaining === 0 ? t("tn.p.startingSoon") : formatRemaining(remaining)}
            </dd>
            <dt className="text-fg-muted">{t("tn.p.startsAtLabel")}</dt>
            <dd className="text-fg tabular-nums">
              <time dateTime={job.scheduledFor}>{formatDateTime(job.scheduledFor)}</time>
            </dd>
          </dl>
          <Button variant="secondary" className="self-start" loading={cancelling} onClick={onCancel} data-testid="purge-cancel">
            {!cancelling && <CircleX aria-hidden className="size-4" />}
            {t("tn.p.cancel")}
          </Button>
        </>
      )}

      {(job.state === "RUNNING" || job.state === "DONE") && <PurgeProgress job={job} />}

      {job.state === "FAILED" && (
        <>
          <PurgeProgress job={job} />
          <p className="text-sm text-fg" data-testid="purge-failed-body">
            {t("tn.p.failedBody", { step: purgeProgress(job).label, error: purgeErrorLabel(job.lastError) })}
          </p>
          <Button variant="danger" className="self-start" onClick={onResume} data-testid="purge-resume">
            <Play aria-hidden className="size-4" />
            {t("tn.p.resume")}
          </Button>
        </>
      )}

      {job.state === "DONE" && (
        <p className="text-sm text-fg">
          {t("tn.p.doneBody")}{" "}
          {job.finishedAt && <span className="tabular-nums">{t("tn.p.doneAt", { at: formatDateTime(job.finishedAt) })}</span>}
        </p>
      )}
      {job.state === "CANCELLED" && job.cancelledAt && (
        <p className="text-sm text-fg-muted tabular-nums">{t("tn.p.cancelledAt", { at: formatDateTime(job.cancelledAt) })}</p>
      )}
      {cancelError && (
        <Alert tone={cancelError.tone} testId="purge-cancel-error">
          {cancelError.message}
        </Alert>
      )}
    </div>
  );
}

function PurgeProgress({ job }: { job: TenantPurgeStatus }) {
  const p = purgeProgress(job);
  return (
    <div className="flex flex-col gap-1.5">
      <progress
        max={p.total}
        value={p.current}
        aria-label={t("tn.p.progress")}
        aria-valuetext={t("tn.p.step", { current: p.current, total: p.total, label: p.label })}
        className="h-2 w-full accent-primary"
        data-testid="purge-progress"
      />
      <p className="text-sm text-fg tabular-nums" data-testid="purge-step">
        {t("tn.p.step", { current: p.current, total: p.total, label: p.label })}
      </p>
    </div>
  );
}
