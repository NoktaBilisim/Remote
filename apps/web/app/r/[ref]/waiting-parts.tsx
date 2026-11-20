"use client";

import { Clock, Download, MonitorUp, ShieldCheck, WifiOff, XCircle } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requestDownloadHref, type MacVariant } from "@/lib/agent-download";
import type { AgentOs } from "@/lib/device-support";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { AgentOffer } from "../../session/[token]/agent-offer";
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

/**
 * P31 (AC-520): kabul kartındaki firma dosyası indirmesinin biçimi. `macos` yalnız macOS masaüstünde ve availability
 * `macos: true` iken; `loading` = macOS kapısı denetleniyor; diğer her durum (Windows, Linux — AC-521, mobil, kapı kapalı,
 * availability hatası) bugünkü Windows bağlantısı.
 */
export type RequestDownloadOffer = { kind: "windows" } | { kind: "loading" } | { kind: "macos"; variant: MacVariant };

/** Cihaz işletim sistemi + `useAgentOffer` sonucu → indirme biçimi (saf; Linux ve bilinmeyen → Windows bağlantısı). */
export function requestDownloadOffer(os: AgentOs | null, offer: AgentOffer): RequestDownloadOffer {
  if (os !== "macos") return { kind: "windows" };
  if (offer.state === "loading") return { kind: "loading" };
  return offer.state === "ready" && offer.os === "macos" ? { kind: "macos", variant: offer.variant } : { kind: "windows" };
}

const DL_CLS = "inline-flex min-h-11 items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline";

/**
 * İndirme bağlantısı. macOS'ta `&os=macos` (302 → `.zip`) + indirme kaynağına çapalı "Yine de Aç" uyarısı (mimari-p31 §15.3,
 * `gm.adhocOnlyBody`) ve firma adının güvenlik kanıtı olmadığı cümlesi; notarize derlemede "Yine de Aç" gerekmediği için uyarı yok
 * (oturum sayfasıyla aynı kural: `gm.neverTitle`).
 */
export function RequestDownload({ href, offer, host }: { href: string; offer: RequestDownloadOffer; host: string }) {
  if (offer.kind === "loading")
    return (
      <div aria-busy="true" data-testid="wr-download-loading" className="flex min-h-11 items-center justify-center">
        <span className="sr-only">{t("gm.checking")}</span>
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
    );
  const mac = offer.kind === "macos";
  return (
    <div className="flex flex-col gap-2">
      <a
        href={requestDownloadHref(href, mac ? "macos" : "windows")}
        className={DL_CLS}
        data-testid="wr-download"
        data-os={mac ? "macos" : "windows"}
      >
        <Download aria-hidden className="size-4 shrink-0" />
        {t(mac ? "wr.downloadMac" : "wr.download")}
      </a>
      {mac && offer.variant !== "notarized" && (
        <div className="text-left">
          <Alert tone="warning" testId="wr-mac-adhoc-only">
            <p className="font-semibold">{t("gm.adhocOnlyTitle")}</p>
            <p className="text-fg">{t("gm.adhocOnlyBody", { host: host || "—" })}</p>
            <p className="mt-1 text-fg" data-testid="wr-mac-firm-note">
              {t("gm.firmNameNotProof")}
            </p>
          </Alert>
        </div>
      )}
    </div>
  );
}

interface AcceptedProps {
  phase: AcceptedPhase;
  /** Firma dosyası indirme bağlantısı (P21: kaynak adaptöründen; `/r/` için `request-download?ref=`). */
  downloadHref: string;
  /** P31: indirme biçimi (macOS / Windows / denetleniyor); varsayılan bugünkü Windows bağlantısı. */
  download?: RequestDownloadOffer;
  onShare: () => void;
  onDecline: () => void;
}

const noop = () => () => undefined;

/** Kabul: teknisyen adı + doğrulama kodu (+ kabul kodu), "Ekranımı paylaş" / "Vazgeç", uygulama indirme bağlantısı. */
export function AcceptedCard({ phase, downloadHref, download = { kind: "windows" }, onShare, onDecline }: AcceptedProps) {
  const host = useSyncExternalStore(
    noop,
    () => window.location.host,
    () => "",
  );
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
      <RequestDownload href={downloadHref} offer={download} host={host} />
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
