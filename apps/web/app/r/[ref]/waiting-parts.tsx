"use client";

import { Clock, Download, MonitorUp, ShieldCheck, WifiOff, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { RequestEndScreen, type RequestEnd } from "./request-end";
import type { AcceptedPhase, ClosedPhase, Phase } from "./request-socket";

function endOf(phase: ClosedPhase): RequestEnd {
  if (phase.status === "REJECTED") return "rejected";
  if (phase.status === "EXPIRED") return "expired";
  if (phase.status === "CONNECT_FAILED") return "connectFailed";
  return phase.byCustomer || phase.reason === "CUSTOMER" ? "cancelledByYou" : "closed";
}

/** Kapanış: talep metniyle bitiş ekranı + reddedildiyse teknisyenin mesajı (metin düğümü, `pre-wrap`). */
export function ClosedScreen({ phase, action }: { phase: ClosedPhase; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3" data-testid={`wr-closed-${phase.status.toLowerCase()}`}>
      <RequestEndScreen end={endOf(phase)} action={action} />
      {phase.status === "REJECTED" && phase.message && (
        <Alert tone="warning" testId="wr-reject-message">
          <span className="whitespace-pre-wrap">{t("wr.rejectMsg", { msg: phase.message })}</span>
        </Alert>
      )}
    </div>
  );
}

function VerifyCodes({ phase }: { phase: AcceptedPhase }) {
  return (
    <>
      <p className="font-mono text-3xl font-semibold tracking-widest text-fg tabular-nums" data-testid="wr-verify-code">
        {phase.techVerifyCode}
      </p>
      {phase.admitCode && (
        <p className="text-sm text-fg" data-testid="wr-admit-code">
          {t("wr.admitCode")} <span className="font-mono text-lg font-semibold tabular-nums">{phase.admitCode}</span>
        </p>
      )}
    </>
  );
}

interface AcceptedProps {
  phase: AcceptedPhase;
  tenantRef: string;
  onShare: () => void;
  onDecline: () => void;
}

/** Kabul: teknisyen adı + doğrulama kodu (+ kabul kodu), "Ekranımı paylaş" / "Vazgeç", uygulama indirme bağlantısı. */
export function AcceptedCard({ phase, tenantRef, onShare, onDecline }: AcceptedProps) {
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 text-center shadow-sm sm:p-6"
      data-testid="wr-accepted"
      role="alert"
    >
      <ShieldCheck aria-hidden className="mx-auto size-8 text-success" />
      <h1 className="text-xl font-semibold text-fg">{t("wr.acceptedTitle", { name: phase.technicianName })}</h1>
      <p className="text-sm text-fg-muted">{t("wr.verifyHint")}</p>
      <VerifyCodes phase={phase} />
      <div className="flex flex-col justify-center gap-2 sm:flex-row">
        <Button onClick={onShare} data-testid="wr-share">
          <MonitorUp aria-hidden className="size-4" />
          {t("wr.share")}
        </Button>
        <Button variant="secondary" onClick={onDecline} data-testid="wr-decline">
          <XCircle aria-hidden className="size-4" />
          {t("wr.decline")}
        </Button>
      </div>
      <a
        href={`/api/v1/public/agent/request-download?ref=${encodeURIComponent(tenantRef)}`}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
        data-testid="wr-download"
      >
        <Download aria-hidden className="size-4" />
        {t("wr.download")}
      </a>
    </section>
  );
}

export function LostBanner() {
  return (
    <Alert tone="warning" testId="wr-lost">
      <span className="inline-flex items-center gap-2">
        <WifiOff aria-hidden className="size-4" />
        {t("wr.lost")}
      </span>
    </Alert>
  );
}

function PendingFacts({ position, remaining }: { position: number; remaining: number }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-fg-muted">{t("wr.position")}</dt>
        <dd className="text-lg font-semibold text-fg tabular-nums" data-testid="wr-position">
          {position}
        </dd>
      </div>
      <div>
        <dt className="text-fg-muted">{t("wr.remaining")}</dt>
        <dd className="text-lg font-semibold text-fg tabular-nums" data-testid="wr-remaining">
          {formatRemaining(remaining)}
        </dd>
      </div>
    </dl>
  );
}

/** Bekleme kartı: talep kodu, sıra + kalan süre (sunucu saati ofsetiyle) ya da "bağlanıyor", iptal düğmesi. */
export function WaitingCard({
  phase,
  requestCode,
  now,
  cancelling,
  onCancel,
}: {
  phase: Phase;
  requestCode: string;
  now: number;
  cancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid="wr-waiting"
      aria-live="polite"
    >
      <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
        <Clock aria-hidden className="size-5 text-fg-muted" />
        {t("wr.waitTitle")}
      </h1>
      <p className="text-sm text-fg-muted">{t("wr.code", { code: requestCode })}</p>
      {phase.kind === "pending" ? (
        <PendingFacts position={phase.position} remaining={phase.expiresAt - (now + phase.offset)} />
      ) : (
        <p className="text-sm text-fg-muted" data-testid="wr-connecting">
          {t("wr.connecting")}
        </p>
      )}
      <Button variant="danger-ghost" className="self-start" loading={cancelling} onClick={onCancel} data-testid="wr-cancel">
        {!cancelling && <XCircle aria-hidden className="size-4" />}
        {t("wr.cancel")}
      </Button>
    </section>
  );
}
