"use client";

import { Eye, LoaderCircle, LogOut, RotateCw, ShieldAlert, Timer } from "lucide-react";
import { useEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnnotLayer } from "@/components/collab/annot-layer";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { Dialog } from "@/components/ui/dialog";
import { formatRemaining, formatTime } from "@/lib/format";
import { forgetResume, writeResume } from "@/lib/guest-resume";
import { t } from "@/lib/i18n";
import type { AnnotState } from "@/lib/dc/annot";
import type { GuestState } from "@/lib/webrtc/guest-machine";
import type { ShareResult } from "@/lib/webrtc/use-guest-session";

/**
 * F5 dönüş kaydı (TEST-P4-1): her yeni reconnectToken yazılır, oturum bitince silinir. S-P4-T3-1: kayıt 120 sn'den
 * eskiyse okunmaz → canlı oturumda damga 30 sn'de bir ve sayfa kapanırken tazelenir.
 */
export function useResumeStore(
  storeKey: string | null,
  state: Pick<GuestState, "phase" | "reconnectToken">,
  join: { technicianName: string; customerName: string },
  verifyCode: string,
  sessionRef: string,
) {
  const { phase, reconnectToken } = state;
  const { technicianName, customerName } = join;
  useEffect(() => {
    if (!storeKey || phase !== "live" || !reconnectToken) return;
    const save = () =>
      writeResume(storeKey, { reconnectToken: reconnectToken ?? "", technicianName, customerName, verifyCode, sessionRef });
    const id = setInterval(save, 30_000);
    addEventListener("pagehide", save);
    return () => {
      clearInterval(id);
      removeEventListener("pagehide", save);
    };
  }, [storeKey, phase, reconnectToken, technicianName, customerName, verifyCode, sessionRef]);

  useEffect(() => {
    if (!storeKey) return;
    if (phase === "ended") return forgetResume(storeKey);
    if (reconnectToken) writeResume(storeKey, { reconnectToken, technicianName, customerName, verifyCode, sessionRef });
  }, [storeKey, phase, reconnectToken, technicianName, customerName, verifyCode, sessionRef]);
}

export function GuestResuming() {
  return (
    <section
      data-testid="guest-resuming"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm"
    >
      <LoaderCircle aria-hidden className="size-8 animate-spin text-fg-muted motion-reduce:animate-none" />
      <h1 role="status" className="text-xl font-semibold text-fg">
        {t("gs.resuming")}
      </h1>
    </section>
  );
}

/** Lobi (admitCode, AC-112/113): kodu teknisyene okuma ekranı. */
export function GuestLobby({
  state,
  now,
  admitCode,
  technicianName,
  verifyCode,
  onLeave,
}: {
  state: GuestState;
  now: number | null;
  admitCode: string | null;
  technicianName: string;
  verifyCode: string;
  onLeave: () => void;
}) {
  const left = state.lobbyExpiresAt && now !== null ? Date.parse(state.lobbyExpiresAt) - now : null;
  return (
    <section
      aria-labelledby="kod-t"
      data-testid="guest-lobby"
      className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-4 py-8 text-center shadow-sm sm:px-8"
    >
      <span
        role="status"
        className="inline-flex items-center gap-2 rounded-full bg-warning-surface px-3 py-1 text-xs font-medium text-warning"
      >
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
        {state.phase === "connecting" ? t("gl.connecting") : t("gl.waiting")}
      </span>
      <h1 id="kod-t" className="text-xl font-semibold text-fg">
        {t("gl.codeTitle")}
      </h1>
      <CodeDisplay code={admitCode ?? ""} size="xl" testId="admit-code" />
      <p className="max-w-md text-base text-fg">{t("gl.readCode")}</p>
      <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
        <ShieldAlert aria-hidden className="size-4 shrink-0" />
        {t("gl.onlyTech")}
      </p>
      <dl className="grid w-full max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border pt-4 text-left text-sm">
        <dt className="text-fg-muted">{t("gl.tech")}</dt>
        <dd className="text-fg">
          {technicianName} · {t("gl.verify")} <b className="font-mono">{verifyCode}</b>
        </dd>
        <dt className="text-fg-muted">{t("gl.share")}</dt>
        <dd className="text-fg">{t("gl.shareValue")}</dd>
        <dt className="text-fg-muted">{t("gl.left")}</dt>
        <dd className="inline-flex items-center gap-1.5 tabular-nums text-fg">
          <Timer aria-hidden className="size-4 text-fg-muted" />
          {left === null ? "—" : formatRemaining(left)}
        </dd>
      </dl>
      <Button variant="danger-ghost" onClick={onLeave} data-testid="lobby-leave">
        <LogOut aria-hidden className="size-4" />
        {t("gl.leave")}
      </Button>
    </section>
  );
}

/** Canlı oturum uyarıları: yeniden bağlanma, süre uyarısı, paylaşım reddi/desteksizlik, teknisyen yok. */
export function GuestLiveAlerts({
  state,
  now,
  shareErr,
  busy,
  onRetry,
}: {
  state: GuestState;
  now: number | null;
  shareErr: ShareResult | null;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      {state.reconnectSince !== null && now !== null && (
        <Alert tone="warning">{t("gs.reconnecting", { time: formatRemaining(state.reconnectSince + 120_000 - now) })}</Alert>
      )}
      {state.warnEndsAt && <Alert tone="warning">{t("gs.warning", { time: formatTime(state.warnEndsAt) })}</Alert>}
      {shareErr === "denied" && state.share !== "sharing" && (
        <Alert tone="danger" testId="share-denied">
          <span className="block font-semibold">{t("gs.deniedTitle")}</span>
          <span className="block">{t("gs.denied")}</span>
          <Button variant="secondary" onClick={onRetry} loading={busy} className="mt-2" data-testid="share-retry">
            {!busy && <RotateCw aria-hidden className="size-4" />}
            {t("gs.retry")}
          </Button>
        </Alert>
      )}
      {shareErr === "unsupported" && <Alert tone="danger">{t("gs.unsupported")}</Alert>}
      {!state.techPresent && (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-fg-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {t("gs.techAway")}
        </p>
      )}
    </>
  );
}

/** Paylaşım önizlemesi (+ işaretleme); PiP açıkken kutu PiP penceresine taşınır, yerinde durum satırı kalır. */
export function GuestPreview({
  video,
  share,
  annot,
  pipWin,
}: {
  video: RefObject<HTMLVideoElement | null>;
  share: GuestState["share"];
  annot: AnnotState;
  pipWin: Window | null;
}) {
  const box = (
    <div
      className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-stage text-on-stage"
      data-testid="guest-preview"
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        aria-label={t("gs.previewLabel")}
        className={`size-full object-contain ${share === "sharing" ? "" : "hidden"}`}
      />
      {share === "sharing" && <AnnotLayer video={video} state={annot} label={t("p5.a.layer")} />}
      {share !== "sharing" && <p className="px-4 text-center text-sm">{t(share === "idle" ? "gs.previewIdle" : "gs.previewStopped")}</p>}
    </div>
  );
  if (!pipWin) return box;
  return (
    <>
      {createPortal(box, pipWin.document.body)}
      <p role="status" className="text-sm text-fg-muted">
        {t("p5.g.pipActive")}
      </p>
    </>
  );
}

export function ViewOnlyNote() {
  return (
    <Alert tone="success">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Eye aria-hidden className="size-4" />
        {t("gs.viewOnlyTitle")}
      </span>
      <span className="block">{t("gs.viewOnlyBody")}</span>
    </Alert>
  );
}

/** Oturumu bitir onayı (yıkıcı; odak "Vazgeç"te). */
export function GuestEndDialog({ open, onClose, onEnd }: { open: boolean; onClose: () => void; onEnd: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("gs.endTitle")}
      description={t("gs.endBody")}
      size="sm"
      role="alertdialog"
      testId="guest-end-dialog"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} className="sm:ml-auto">
            {t("gs.endCancel")}
          </Button>
          <Button variant="danger" onClick={onEnd} data-testid="guest-end-confirm">
            {t("gs.end")}
          </Button>
        </>
      }
    />
  );
}
