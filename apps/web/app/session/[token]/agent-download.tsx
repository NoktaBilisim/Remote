"use client";

import { CircleHelp, Download, FileCheck2, LoaderCircle, ScreenShare } from "lucide-react";
import { useId, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import type { AgentOs } from "@/lib/device-support";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { agentDownloadUrl, probeAgentDownload, type MacVariant } from "@/lib/agent-download";
import { t } from "@/lib/i18n";
import type { GuestEnd } from "../guest-ui";
import { GuideStep as Step } from "./guide-step";
import { LinuxGuide } from "./linux-guide";
import { MacGuide } from "./mac-guide";

type State = "idle" | "checking" | "started" | "notReady" | "rate" | "error";

const noop = () => () => undefined;

/**
 * AC-27 (Windows masaüstü) / P28f AC-396 (macOS, aynı düzen + macOS rehberi) / P28g AC-403 (Linux x86_64 + Linux rehberi): birincil "Hızlı Destek uygulamasını indir" + aynı adımda SmartScreen rehberi (DESIGN §8:
 * numaralı adım + şema kutusu, ekran görüntüsüz). Tıklamada uç önce `redirect: manual` ile denenir; 302 ise indirme
 * başlar, 503 NOT_READY'de tarayıcı modu önerilir, 410/404 bitiş ekranına, 429 bekleme mesajına gider.
 */
export function AgentDownload({
  sessionRef,
  verifyCode,
  os = "windows",
  variant = "adhoc",
  onEnd,
  onBrowser,
}: {
  sessionRef: string;
  verifyCode: string;
  /** P28f (AC-396): macOS'ta indirme `os=macos` (zip) ve macOS rehberi; P28g (AC-403): Linux'ta `os=linux` + Linux rehberi. */
  os?: AgentOs;
  /** P28f-r4 (K-P28f-r4-3/6): macOS rehber varyantı; varsayılan `adhoc` (asla `notarized` varsayılmaz). */
  variant?: MacVariant;
  onEnd: (e: GuestEnd) => void;
  /** Tarayıcı moduna geç (ad alanına / paylaş düğmesine odak). Yoksa (tarayıcı modu desteklenmiyor) düğme gösterilmez. */
  onBrowser?: () => void;
}) {
  const guideId = useId();
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState<string | undefined>();
  const host = useSyncExternalStore(
    noop,
    () => window.location.host,
    () => "",
  );
  const href = agentDownloadUrl(sessionRef, os);
  const mac = os === "macos";
  const linux = os === "linux";
  const checking = state === "checking";

  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (checking) return;
    setState("checking");
    setDetail(undefined);
    const r = await probeAgentDownload(sessionRef, os);
    switch (r.kind) {
      case "ok":
        // Caddy dosyayı `Content-Disposition: attachment` ile sunar → sayfa yerinde kalır, indirme başlar
        window.location.assign(href);
        return setState("started");
      case "notReady":
        return setState("notReady");
      case "end":
        return onEnd(r.end);
      case "rate":
        setDetail(r.retryAfter ? t("ga.rate", { minutes: Math.max(1, Math.ceil(r.retryAfter / 60)) }) : t("ga.rateNoTime"));
        return setState("rate");
      case "error":
        setDetail(r.requestId);
        return setState("error");
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="agent-download-block">
      <a
        href={href}
        onClick={(e) => void onClick(e)}
        aria-busy={checking || undefined}
        aria-describedby={guideId}
        data-testid="agent-download"
        data-state={state}
        data-os={os}
        className="flex min-h-11 flex-col items-start gap-1 rounded-lg border-2 border-primary bg-surface p-4 text-left shadow-sm transition-[transform,opacity] duration-150 ease-out hover:bg-primary-surface active:scale-[0.99] aria-busy:cursor-progress aria-busy:opacity-80"
      >
        <span className="inline-flex flex-wrap items-center gap-2 font-semibold text-fg">
          {checking ? (
            <LoaderCircle aria-hidden className="size-5 animate-spin text-primary motion-reduce:animate-none" />
          ) : (
            <Download aria-hidden className="size-5 text-primary" />
          )}
          {checking ? t("ga.checking") : t("ga.download")}
          <span className="rounded-full bg-accent-surface px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-accent-fg">
            {t("ga.recommended")}
          </span>
        </span>
        <span className="text-sm text-fg-muted">{t("ga.downloadBody")}</span>
        <span className="text-xs text-fg-muted">{t(mac ? "gm.downloadMeta" : linux ? "gl.downloadMeta" : "ga.downloadMeta")}</span>
      </a>
      {mac && variant === "test" && (
        <Alert tone="warning" testId="mac-test-build">
          <p className="font-semibold">{t("gm.testTitle")}</p>
          <p className="text-fg">{t("gm.testBody")}</p>
        </Alert>
      )}
      {/* S-r4-1: indirme kaynağına çapalı uyarı düğmenin yanında, rehberin 2. adımından önce */}
      {mac && variant === "adhoc" && (
        <Alert tone="warning" testId="mac-adhoc-only-this">
          <p className="font-semibold">{t("gm.adhocOnlyTitle")}</p>
          <p className="text-fg">{t("gm.adhocOnlyBody", { host: host || "—" })}</p>
        </Alert>
      )}

      {state === "started" && (
        <Alert tone="success" testId="agent-started">
          <p className="font-semibold">{t("ga.startedTitle")}</p>
          <p className="text-fg">{t("ga.startedBody")}</p>
        </Alert>
      )}
      {state === "notReady" && (
        <Alert tone="warning" testId="agent-not-ready">
          <p className="font-semibold">{t("ga.notReadyTitle")}</p>
          {onBrowser && (
            <>
              <p className="mt-1 text-fg">{t("ga.notReadyBody")}</p>
              <Button type="button" variant="secondary" className="mt-2" onClick={onBrowser} data-testid="agent-to-browser">
                <ScreenShare aria-hidden className="size-4" />
                {t("ga.continueBrowser")}
              </Button>
            </>
          )}
        </Alert>
      )}
      {(state === "rate" || state === "error") && (
        <Alert tone={state === "rate" ? "locked" : "danger"} testId="agent-error">
          <p>{state === "rate" ? detail : t("ga.error")}</p>
          {state === "error" && detail && (
            <p className="mt-1 text-xs opacity-80">
              {t("err.requestId")}: <span className="font-mono">{detail}</span>
            </p>
          )}
        </Alert>
      )}

      {mac ? (
        <MacGuide id={guideId} highlight={state === "started"} variant={variant} verifyCode={verifyCode} host={host} />
      ) : linux ? (
        <LinuxGuide id={guideId} highlight={state === "started"} verifyCode={verifyCode} host={host} />
      ) : (
        <section
          aria-labelledby={`${guideId}-t`}
          id={guideId}
          data-testid="smartscreen-guide"
          className={`rounded-lg border bg-surface p-4 text-sm shadow-sm ${state === "started" ? "border-primary" : "border-border"}`}
        >
          <h3 id={`${guideId}-t`} className="inline-flex items-center gap-2 font-semibold text-fg">
            <CircleHelp aria-hidden className="size-4 shrink-0 text-primary" />
            {t("ga.guideTitle")}
          </h3>
          <p className="mt-1 text-fg-muted">{t("ga.guideIntro")}</p>
          <ol className="mt-3 flex list-none flex-col gap-3">
            <Step n={1} title={t("ga.step1")} body={t("ga.step1Body")} />
            <Step n={2} title={t("ga.step2")} body={t("ga.step2Body")}>
              <Schematic>
                <span className="font-semibold">{t("ga.ssTitle")}</span>
                <span>{t("ga.ssBody")}</span>
                <span className="font-semibold text-primary underline">{t("ga.ssMore")}</span>
              </Schematic>
            </Step>
            <Step n={3} title={t("ga.step3")} body={t("ga.step3Body")}>
              <Schematic>
                <span>{t("ga.ssPublisher")}</span>
                <span className="flex flex-wrap justify-end gap-2">
                  <span className="rounded-sm border-2 border-primary px-2 py-0.5 font-semibold text-fg">{t("ga.ssRun")}</span>
                  <span className="rounded-sm border border-border px-2 py-0.5">{t("ga.ssDont")}</span>
                </span>
              </Schematic>
            </Step>
            <Step n={4} title={t("ga.step4")} body={t("ga.step4Body", { code: verifyCode, host: host || "—" })} />
          </ol>
          <details className="mt-3 rounded-md border border-border bg-canvas px-3 py-2" data-testid="agent-verify">
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
              <FileCheck2 aria-hidden className="mr-1.5 inline size-4 align-[-0.1875em]" />
              {t("ga.verifyTitle")}
            </summary>
            <p className="pb-2 text-fg-muted">{t("ga.verifyBody")}</p>
          </details>
        </section>
      )}
    </div>
  );
}

/** Windows penceresinin şeması (görsel yardım; metin adımlarda zaten var → ekran okuyucudan gizli). */
function Schematic({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden className="mt-2 flex max-w-sm flex-col gap-1 rounded-md border border-border bg-canvas p-3 text-xs text-fg-muted">
      {children}
    </div>
  );
}
