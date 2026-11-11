"use client";

import { Eye, LoaderCircle, LogOut, RotateCw, ShieldAlert, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ShareStrip } from "@/components/guest/share-strip";
import { GuestCollab, PipButton, usePip } from "@/components/guest/guest-collab";
import { AnnotLayer } from "@/components/collab/annot-layer";
import { useCollab } from "@/lib/dc/use-collab";
import { createPortal } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { Dialog } from "@/components/ui/dialog";
import { formatRemaining, formatTime } from "@/lib/format";
import { forgetResume, writeResume } from "@/lib/guest-resume";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import type { GuestEnd as MachineEnd } from "@/lib/webrtc/guest-machine";
import { useGuestSession, type GuestCred, type ShareResult } from "@/lib/webrtc/use-guest-session";
import { GuestEndScreen, type GuestEnd } from "../guest-ui";

const END_UI: Record<MachineEnd, GuestEnd> = {
  ended: "finished", rejected: "rejected", lobbyTimeout: "lobbyTimeout", cancelled: "cancelled",
  expired: "expired", left: "left", lost: "lost", error: "error", resumeFailed: "consumed",
};

export interface GuestInfo {
  technicianName: string;
  customerName: string;
  /** Lobi kodu; F5 dönüşünde (lobiye girilmez) null. */
  admitCode: string | null;
}

/**
 * Lobi (admitCode, AC-112/113) → tarayıcı modu oturumu (paylaş/durdur/yeniden, bitir; AC-28..33, 59).
 * `storeKey`: F5 dönüş kaydı (TEST-P4-1) — her yeni reconnectToken yazılır, oturum bitince silinir.
 */
export function GuestSession({ info: join, verifyCode, sessionRef, cred, storeKey }: {
  info: GuestInfo;
  verifyCode: string;
  sessionRef: string;
  cred: GuestCred;
  storeKey: string | null;
}) {
  const { state, preview, channels, caps, maxFileMb, send, startShare, stopShare, end } = useGuestSession(cred, sessionRef);
  const [chatOpen, setChatOpen] = useState(true);
  const filesAllowed = caps.includes("file_transfer");
  const collab = useCollab(channels, { inbound: "TO_CUSTOMER", filesAllowed, chatVisible: chatOpen, receiveAnnot: true, sendMeta: send, maxFileMb });
  const pip = usePip();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [shareErr, setShareErr] = useState<ShareResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = state.share === "sharing" ? preview : null;
  }, [preview, state.share, pip.win]);

  // S-P4-T3-1: dönüş kaydı 120 sn'den eskiyse okunmaz → canlı oturumda damga 30 sn'de bir ve sayfa kapanırken tazelenir
  useEffect(() => {
    if (!storeKey || state.phase !== "live" || !state.reconnectToken) return;
    const save = () => writeResume(storeKey, { reconnectToken: state.reconnectToken ?? "", technicianName: join.technicianName, customerName: join.customerName, verifyCode, sessionRef });
    const id = setInterval(save, 30_000);
    addEventListener("pagehide", save);
    return () => {
      clearInterval(id);
      removeEventListener("pagehide", save);
    };
  }, [storeKey, state.phase, state.reconnectToken, join.technicianName, join.customerName, verifyCode, sessionRef]);

  useEffect(() => {
    if (!storeKey) return;
    if (state.phase === "ended") return forgetResume(storeKey);
    if (state.reconnectToken) {
      writeResume(storeKey, { reconnectToken: state.reconnectToken, technicianName: join.technicianName, customerName: join.customerName, verifyCode, sessionRef });
    }
  }, [storeKey, state.phase, state.reconnectToken, join.technicianName, join.customerName, verifyCode, sessionRef]);

  if (state.phase === "ended") {
    const kind = END_UI[state.end ?? "ended"];
    const again = kind === "lobbyTimeout" || kind === "lost";
    return (
      <GuestEndScreen
        kind={kind}
        action={again ? (
          <Button variant="secondary" onClick={() => location.reload()}>
            <RotateCw aria-hidden className="size-4" />
            {t("g.rejoin")}
          </Button>
        ) : undefined}
      />
    );
  }

  if (state.phase === "connecting" && state.resuming) {
    return (
      <section data-testid="guest-resuming" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm">
        <LoaderCircle aria-hidden className="size-8 animate-spin text-fg-muted motion-reduce:animate-none" />
        <h1 role="status" className="text-xl font-semibold text-fg">{t("gs.resuming")}</h1>
      </section>
    );
  }

  if (state.phase !== "live") {
    const left = state.lobbyExpiresAt && now !== null ? Date.parse(state.lobbyExpiresAt) - now : null;
    return (
      <section aria-labelledby="kod-t" data-testid="guest-lobby" className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-4 py-8 text-center shadow-sm sm:px-8">
        <span role="status" className="inline-flex items-center gap-2 rounded-full bg-warning-surface px-3 py-1 text-xs font-medium text-warning">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
          {state.phase === "connecting" ? t("gl.connecting") : t("gl.waiting")}
        </span>
        <h1 id="kod-t" className="text-xl font-semibold text-fg">{t("gl.codeTitle")}</h1>
        <CodeDisplay code={join.admitCode ?? ""} size="xl" testId="admit-code" />
        <p className="max-w-md text-base text-fg">{t("gl.readCode")}</p>
        <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <ShieldAlert aria-hidden className="size-4 shrink-0" />
          {t("gl.onlyTech")}
        </p>
        <dl className="grid w-full max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border pt-4 text-left text-sm">
          <dt className="text-fg-muted">{t("gl.tech")}</dt>
          <dd className="text-fg">{join.technicianName} · {t("gl.verify")} <b className="font-mono">{verifyCode}</b></dd>
          <dt className="text-fg-muted">{t("gl.share")}</dt>
          <dd className="text-fg">{t("gl.shareValue")}</dd>
          <dt className="text-fg-muted">{t("gl.left")}</dt>
          <dd className="inline-flex items-center gap-1.5 tabular-nums text-fg">
            <Timer aria-hidden className="size-4 text-fg-muted" />
            {left === null ? "—" : formatRemaining(left)}
          </dd>
        </dl>
        <Button variant="danger-ghost" onClick={end} data-testid="lobby-leave">
          <LogOut aria-hidden className="size-4" />
          {t("gl.leave")}
        </Button>
      </section>
    );
  }

  const strip = state.reconnectSince !== null ? "reconnecting" : state.share;
  const onStart = async () => {
    setBusy(true);
    const r = await startShare();
    setBusy(false);
    setShareErr(r === "ok" ? null : r);
  };

  return (
    <div className="-mx-4 -mt-2 flex flex-col gap-4">
      <ShareStrip state={strip} techName={join.technicianName} busy={busy} onStart={onStart} onStop={stopShare} onEnd={() => setConfirm(true)} />
      <div className="flex flex-col gap-4 px-4">
        {state.reconnectSince !== null && now !== null && (
          <Alert tone="warning">{t("gs.reconnecting", { time: formatRemaining(state.reconnectSince + 120_000 - now) })}</Alert>
        )}
        {state.warnEndsAt && <Alert tone="warning">{t("gs.warning", { time: formatTime(state.warnEndsAt) })}</Alert>}
        {shareErr === "denied" && state.share !== "sharing" && (
          <Alert tone="danger" testId="share-denied">
            <span className="block font-semibold">{t("gs.deniedTitle")}</span>
            <span className="block">{t("gs.denied")}</span>
            <Button variant="secondary" onClick={onStart} loading={busy} className="mt-2" data-testid="share-retry">
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
        <section aria-labelledby="on-t" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h1 id="on-t" className="text-lg font-semibold text-fg">{t("gs.previewTitle")}</h1>
          {(() => {
            const box = (
              <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-stage text-on-stage" data-testid="guest-preview">
                <video ref={video} autoPlay muted playsInline aria-label={t("gs.previewLabel")} className={`size-full object-contain ${state.share === "sharing" ? "" : "hidden"}`} />
                {state.share === "sharing" && <AnnotLayer video={video} state={collab.annot} label={t("p5.a.layer")} />}
                {state.share !== "sharing" && <p className="px-4 text-center text-sm">{t(state.share === "idle" ? "gs.previewIdle" : "gs.previewStopped")}</p>}
              </div>
            );
            if (pip.win) return <>{createPortal(box, pip.win.document.body)}<p role="status" className="text-sm text-fg-muted">{t("p5.g.pipActive")}</p></>;
            return box;
          })()}
          {state.share === "sharing" && <PipButton pip={pip} />}
        </section>
        <GuestCollab collab={collab} filesAllowed={filesAllowed} techName={join.technicianName} onChatVisible={setChatOpen} />
        <Alert tone="success">
          <span className="inline-flex items-center gap-1.5 font-semibold"><Eye aria-hidden className="size-4" />{t("gs.viewOnlyTitle")}</span>
          <span className="block">{t("gs.viewOnlyBody")}</span>
        </Alert>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("gs.endTitle")}
        description={t("gs.endBody")}
        size="sm"
        role="alertdialog"
        testId="guest-end-dialog"
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(false)} className="sm:ml-auto">{t("gs.endCancel")}</Button>
            <Button variant="danger" onClick={() => { setConfirm(false); end(); }} data-testid="guest-end-confirm">{t("gs.end")}</Button>
          </>
        }
      />
    </div>
  );
}
