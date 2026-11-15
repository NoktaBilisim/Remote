"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  PURGE_RUNNING_POLL_MS,
  TENANT_PURGE_PASSIVE_DAYS,
  TENANT_PURGE_STEPS,
  purgeEligibility,
  purgeErrorOf,
  purgeRemainingMs,
  type TenantPurgeScheduledResponse,
  type TenantPurgeStatus,
} from "@/lib/tenants/purge";
import { useNow } from "@/lib/use-now";
import { PurgeDialog } from "./purge-dialog";
import { isOpenPurge, PurgeStatusCard } from "./purge-status-card";

type TenantInfo = { name: string; status: string; passiveSince: string | null };

/**
 * Kalıcı silme paneli (P16, AC-242; mimari-e11 §7.8). İş yoksa uygunluk + "Kalıcı sil"; SCHEDULED geri sayım +
 * "Silmeyi iptal et" (step-up); RUNNING adım çubuğu (3 sn yoklama); FAILED "Sürdür" (yeni önizleme); DONE başarı.
 * Durum değişimleri `role=status` ile duyurulur.
 */
export function PurgePanel({
  tenantId,
  tenant,
  name,
  initial,
}: {
  tenantId: string;
  tenant: TenantInfo | null;
  name: string;
  initial: TenantPurgeStatus | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const now = useNow(1000);
  const [job, setJob] = useState(initial);
  const stateRef = useRef(initial?.state ?? null);
  const [dialog, setDialog] = useState<"new" | "resume" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<UiError | null>(null);

  const remaining = job?.state === "SCHEDULED" ? purgeRemainingMs(job.scheduledFor, now) : null;
  const poll = job?.state === "RUNNING" || (job?.state === "SCHEDULED" && remaining === 0);

  const reload = useCallback(async () => {
    try {
      const next = await api<TenantPurgeStatus>("GET", `/admin/tenants/${tenantId}/purge`);
      const was = stateRef.current;
      stateRef.current = next.state;
      setJob(next);
      // DONE: firma satırı artık yok → sayfa "Silinmiş firma" görünümüne geçer
      if (was !== next.state && next.state === "DONE") router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) router.replace(EXPIRED_LOGIN_PATH);
      // Diğer hatalar sessiz: son durum korunur, sonraki turda yeniden denenir
    }
  }, [tenantId, router]);

  useEffect(() => {
    if (!poll) return;
    const id = setInterval(() => void reload(), PURGE_RUNNING_POLL_MS);
    return () => clearInterval(id);
  }, [poll, reload]);

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await api<unknown>("DELETE", `/admin/tenants/${tenantId}/purge`);
      toast(t("tn.p.cancelled", { name }));
      await reload();
      router.refresh();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      const m = purgeErrorOf(e);
      if (m.kind === "refresh") {
        setCancelError({ message: m.message, tone: "danger" });
        await reload();
      } else setCancelError(toUiError(e, { 404: t("tn.p.notFound") }));
    } finally {
      setCancelling(false);
    }
  };

  const onScheduled = async (r: TenantPurgeScheduledResponse) => {
    setDialog(null);
    toast(t(r.state === "RUNNING" ? "tn.p.resumedToast" : "tn.p.scheduledToast", { name }));
    setJob((prev) => ({
      jobId: r.jobId,
      state: r.state,
      step: prev?.step ?? "FENCE",
      stepIndex: prev?.stepIndex ?? 0,
      stepCount: prev?.stepCount ?? TENANT_PURGE_STEPS.length,
      scheduledFor: r.scheduledFor,
      counts: prev?.counts ?? {},
      attempts: prev?.attempts ?? 0,
      lastError: null,
      startedAt: prev?.startedAt ?? null,
      heartbeatAt: null,
      finishedAt: null,
      cancelledAt: null,
    }));
    await reload();
    router.refresh();
  };

  // Hidrasyon öncesi (now null) düğme pasif, neden yazılmaz → saat farkı uyuşmazlığı yok; ilk tikte gerçek durum
  const elig = tenant ? (now === null ? ({ kind: "pending" } as const) : purgeEligibility(tenant, now)) : null;
  const open = isOpenPurge(job);

  return (
    <div className="flex flex-col gap-4" data-testid="purge-panel" data-state={job?.state ?? "none"}>
      {job && (
        <PurgeStatusCard
          job={job}
          remaining={remaining}
          cancelling={cancelling}
          cancelError={cancelError}
          onCancel={() => void cancel()}
          onResume={() => setDialog("resume")}
        />
      )}

      {!open && tenant && elig && job?.state !== "DONE" && (
        <div className="flex flex-col items-start gap-1.5">
          <Button
            variant="danger-ghost"
            disabled={elig.kind !== "eligible"}
            aria-describedby={elig.kind === "active" || elig.kind === "wait" ? "purge-why" : undefined}
            onClick={() => setDialog("new")}
            data-testid="purge-open"
          >
            <Trash2 aria-hidden className="size-4" />
            {t("tn.p.open")}
          </Button>
          {elig.kind === "active" && (
            <p id="purge-why" className="text-sm text-fg-muted" data-testid="purge-why">
              {t("tn.p.needsPassive")}
            </p>
          )}
          {elig.kind === "wait" && (
            <p id="purge-why" className="text-sm text-fg-muted" data-testid="purge-why">
              <span className="font-medium text-fg tabular-nums">{t("tn.p.wait", { at: formatDateTime(elig.eligibleAt) })}</span>
              {" · "}
              {t("tn.p.waitHint", { days: TENANT_PURGE_PASSIVE_DAYS })}
            </p>
          )}
        </div>
      )}

      <PurgeDialog
        mode={dialog}
        tenantId={tenantId}
        name={name}
        onClose={() => setDialog(null)}
        onScheduled={(r) => void onScheduled(r)}
        onStale={() => {
          setDialog(null);
          void reload();
          router.refresh();
        }}
      />
    </div>
  );
}
