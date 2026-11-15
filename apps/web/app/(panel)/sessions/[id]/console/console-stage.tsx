"use client";

import type { SessionView } from "@remote/contracts/api/sessions";
import type { RefObject } from "react";
import type { DrawTool } from "@/components/collab/annot-layer";
import { MonitorPicker } from "@/components/console/control-button";
import { LobbyPanel } from "@/components/console/lobby-panel";
import { Stage } from "@/components/console/stage";
import { t } from "@/lib/i18n";
import type { AnnotColor } from "@/lib/dc/ctl";
import type { Collab } from "@/lib/dc/use-collab";
import type { useTechSession } from "@/lib/webrtc/use-tech-session";
import { comboMsgs, SPECIAL_COMBOS, type SpecialComboId } from "@/lib/control/input";
import { isCapturing, type ControlState } from "@/lib/control/machine";
import { sendInput } from "@/lib/control/use-remote-input";
import { annotInput, ConsoleAnnotTools, ConsoleControlBar } from "./console-parts";

type Tech = ReturnType<typeof useTechSession>;

/** Sahnenin P7 kontrol girdisi (yalnız Hızlı Destek misafiri). */
function stageControl(ts: Tech, canControl: boolean, releaseRef: RefObject<HTMLButtonElement | null>) {
  const c: ControlState = ts.control;
  return {
    active: canControl && isCapturing(c),
    channel: ts.input,
    onKeyboardRelease: () => releaseRef.current?.focus(),
    elevated: c.env.elevated,
    secureDesktop: c.env.secure,
    selfElevated: c.env.self,
    endedNote: c.phase === "idle" && c.endedBy === "peer" ? t("p7.end.peer") : null,
  };
}

/**
 * Konsol sahnesi: lobi, işaretleme, P7 kontrol çubuğu/monitör seçimi (yalnız Hızlı Destek misafiri +
 * remote_control.use; AC-34, 51). İşaretleme ve kontrol çakışmaz: kontrol yakalanırken çizim aracı etkisiz.
 */
export function ConsoleStage({
  ts,
  session,
  collab,
  tool,
  color,
  onTool,
  onColor,
  canControl,
  now,
  releaseRef,
}: {
  ts: Tech;
  session: SessionView;
  collab: Collab;
  tool: DrawTool | null;
  color: AnnotColor;
  onTool: (t: DrawTool | null) => void;
  onColor: (c: AnnotColor) => void;
  canControl: boolean;
  now: number | null;
  releaseRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, control } = ts;
  const live = state.phase === "live";
  const agent = live && state.guest?.kind === "AGENT";
  const capturing = isCapturing(control);
  const showing = live && state.share === "sharing" && state.peerLostSince === null && state.reconnectSince === null;
  const drawTool = capturing ? null : tool;
  // "%100" = görüntülenen monitörün pikselleriyle 1:1 (TEST-P7-1); tarayıcı paylaşımında monitör bilgisi yok
  const activeMon = control.monitors.find((m) => m.id === control.activeMonitor) ?? null;
  const sendKeys = (id: SpecialComboId) => {
    const c = SPECIAL_COMBOS.find((x) => x.id === id);
    if (!c || !capturing) return;
    for (const m of comboMsgs(c.codes)) sendInput(ts.input, m);
  };
  const bar = { control, now, available: showing, onKeys: sendKeys, releaseRef };
  return (
    <Stage
      state={state}
      stream={ts.stream}
      verifyCode={session.techVerifyCode}
      sessionCode={session.code}
      lobby={<LobbyPanel state={state} onAdmit={ts.admit} onReject={(p) => ts.reject(p.guestId)} />}
      annot={annotInput(collab, drawTool, color)}
      tools={<ConsoleAnnotTools collab={collab} tool={drawTool} color={color} onTool={onTool} onColor={onColor} capturing={capturing} />}
      controlBar={
        agent ? (
          <ConsoleControlBar
            canControl={canControl}
            {...bar}
            onRequest={ts.requestControl}
            onRelease={ts.releaseControl}
            onCancel={ts.cancelControl}
          />
        ) : null
      }
      monitors={agent && control.monitors.length > 1 ? <MonitorPicker s={control} now={now} onRequest={ts.requestMonitor} /> : null}
      monitorBusy={control.monitorPending !== null}
      nativeSize={agent && activeMon ? { w: activeMon.w, h: activeMon.h } : null}
      control={agent ? stageControl(ts, canControl, releaseRef) : null}
    />
  );
}
