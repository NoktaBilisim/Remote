"use client";

import { Expand, Hourglass, LoaderCircle, Maximize, Minimize, ScanSearch, ScreenShareOff, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnnotLayer, type DrawInput } from "@/components/collab/annot-layer";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { Segmented } from "@/components/ui/segmented";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import type { AnnotState } from "@/lib/dc/annot";
import type { TechState } from "@/lib/webrtc/tech-machine";

const PEER_WINDOW_MS = 120_000;
type ViewMode = "fit" | "actual";

function Msg({ icon, title, children, alert }: { icon: ReactNode; title: string; children?: ReactNode; alert?: boolean }) {
  return (
    <div role={alert ? "alert" : "status"} className="flex max-w-md flex-col items-center gap-2 px-4 text-center text-on-stage">
      {icon}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="text-sm">{children}</div>}
    </div>
  );
}

/**
 * Konsol sahnesi (DESIGN §6.1 `console/stage.tsx`): `stage` zemini (iki temada koyu), uzak video,
 * durum mesajları ve üst katman uyarıları. `lobby` yuvası bekleyen varken lobi panelini gösterir.
 */
export function Stage({
  state,
  stream,
  verifyCode,
  sessionCode,
  lobby,
  annot,
  tools,
}: {
  state: TechState;
  stream: MediaStream | null;
  verifyCode: string;
  sessionCode: string | null;
  lobby: ReactNode;
  /** P5 işaretleme: yalnız "Sığdır" görünümünde (koordinat = görünen içerik alanı). */
  annot?: { state: AnnotState; input: DrawInput | null } | null;
  tools?: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLElement>(null);
  const now = useNow();
  const [mode, setMode] = useState<ViewMode>("fit");
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current && box.current !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void box.current?.requestFullscreen().catch(() => undefined);
  };

  const live = state.phase === "live";
  const spin = <LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />;
  let overlay: ReactNode = null;
  if (state.reconnectSince !== null) overlay = <Msg alert icon={<WifiOff aria-hidden className="size-8" />} title={t("cs.selfLost")}>{t("cs.selfLostBody")}</Msg>;
  else if (state.phase === "connecting") overlay = <Msg icon={spin} title={t("cs.connecting")} />;
  else if (state.phase === "waiting" && state.pending.length > 0) overlay = lobby;
  else if (state.phase === "waiting")
    overlay = (
      <Msg icon={<Hourglass aria-hidden className="size-8" />} title={t("cs.waitingTitle")}>
        <p>{t("cs.waitingBody")}</p>
        <p className="mt-2">{t("cs.verify")} <CodeDisplay code={verifyCode} size="sm" /></p>
        {sessionCode && <p className="mt-1">{t("cs.sessionCode")} <CodeDisplay code={sessionCode} size="sm" /></p>}
      </Msg>
    );
  else if (live && state.peerLostSince !== null)
    overlay = (
      <Msg alert icon={<WifiOff aria-hidden className="size-8" />} title={t("cs.peerLost")}>
        {t("cs.peerLostBody", { time: now === null ? "—" : formatRemaining(state.peerLostSince + PEER_WINDOW_MS - now) })}
      </Msg>
    );
  else if (live && state.share === "unknown") overlay = <Msg icon={spin} title={t("cs.notShared")}>{t("cs.notSharedBody")}</Msg>;
  else if (live && state.share === "stopped")
    overlay = <Msg icon={<ScreenShareOff aria-hidden className="size-8" />} title={t("cs.stopped")}>{t("cs.stoppedBody")}</Msg>;

  const showing = live && state.share === "sharing" && state.peerLostSince === null;
  const actual = mode === "actual";

  return (
    <section
      ref={box}
      id="sahne"
      aria-label={t("cs.label")}
      data-testid="stage"
      data-share={state.share}
      data-mode={mode}
      data-fullscreen={full}
      className="relative flex min-h-[60vh] flex-1 items-center justify-center overflow-hidden rounded-lg bg-stage p-4"
    >
      {/* %100: doğal boyut + kaydırma (klavyeyle odaklanıp ok tuşlarıyla kaydırılır); Sığdır: object-contain */}
      <div
        data-testid="stage-scroll"
        tabIndex={showing && actual ? 0 : undefined}
        role={showing && actual ? "region" : undefined}
        aria-label={showing && actual ? t("cs.scroll") : undefined}
        className={`absolute inset-0 ${actual ? "overflow-auto focus-visible:-outline-offset-2" : "overflow-hidden"}`}
      >
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          data-testid="console-video"
          aria-label={t("cs.video", { name: state.guest?.name ?? t("c.customer") })}
          className={`${actual ? "size-auto max-w-none" : "size-full object-contain"} ${showing ? "" : "invisible"}`}
        />
        {showing && !actual && annot && <AnnotLayer video={ref} state={annot.state} input={annot.input} label={t("p5.a.layer")} />}
      </div>
      {showing && (
        <div className="absolute top-2 right-2 z-20 flex flex-wrap items-center justify-end gap-2" data-testid="stage-tools">
          {!actual && tools}
          <Segmented<ViewMode>
            label={t("cs.view")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "fit", label: t("cs.fit"), icon: <Expand aria-hidden className="size-4" /> },
              { value: "actual", label: t("cs.actual"), icon: <ScanSearch aria-hidden className="size-4" /> },
            ]}
          />
          <Button variant="secondary" onClick={toggleFull} aria-pressed={full} data-testid="stage-fullscreen">
            {full ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
            {full ? t("cs.exitFullscreen") : t("cs.fullscreen")}
          </Button>
        </div>
      )}
      {overlay && <div className="relative z-10 flex w-full items-center justify-center">{overlay}</div>}
    </section>
  );
}
