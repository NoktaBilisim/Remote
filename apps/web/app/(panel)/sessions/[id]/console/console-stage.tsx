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

/** İşaretleme aracı/rengi ve değiştiricileri. */
interface DrawState {
  tool: DrawTool | null;
  color: AnnotColor;
  onTool: (t: DrawTool | null) => void;
  onColor: (c: AnnotColor) => void;
}

interface ConsoleStageProps {
  ts: Tech;
  session: SessionView;
  collab: Collab;
  draw: DrawState;
  canControl: boolean;
  /** P28c (§10): kontrol sahibi değil → kontrol/işaretleme pasif + bu metin. */
  seatLock?: string | null;
  now: number | null;
  releaseRef: RefObject<HTMLButtonElement | null>;
}

/** Özel tuş birleşimi (Ctrl+Alt+Del vb.) yalnız yakalama sürerken `input` kanalına gider. */
function comboSender(input: RTCDataChannel | null, capturing: boolean) {
  return (id: SpecialComboId) => {
    const c = SPECIAL_COMBOS.find((x) => x.id === id);
    if (!c || !capturing) return;
    for (const m of comboMsgs(c.codes)) sendInput(input, m);
  };
}

/** P7 kontrol çubuğu (yalnız Hızlı Destek misafiri). */
function controlBar(p: ConsoleStageProps, showing: boolean, capturing: boolean) {
  const { ts } = p;
  return (
    <ConsoleControlBar
      lock={p.canControl ? (p.seatLock ?? null) : null}
      canControl={p.canControl && !p.seatLock}
      control={ts.control}
      now={p.now}
      available={showing}
      onKeys={comboSender(ts.input, capturing)}
      releaseRef={p.releaseRef}
      unattended={ts.state.unattended !== null}
      onRequest={ts.requestControl}
      onRelease={ts.releaseControl}
      onCancel={ts.cancelControl}
    />
  );
}

/** "%100" = görüntülenen monitörün pikselleriyle 1:1 (TEST-P7-1); tarayıcı paylaşımında monitör bilgisi yok. */
function nativeSizeOf(c: ControlState) {
  const m = c.monitors.find((x) => x.id === c.activeMonitor) ?? null;
  return m ? { w: m.w, h: m.h } : null;
}

/**
 * Konsol sahnesi: lobi, işaretleme, P7 kontrol çubuğu/monitör seçimi (yalnız Hızlı Destek misafiri +
 * remote_control.use; AC-34, 51). İşaretleme ve kontrol çakışmaz: kontrol yakalanırken çizim aracı etkisiz.
 */
export function ConsoleStage(p: ConsoleStageProps) {
  const { ts, session, collab, draw, now } = p;
  const { state, control } = ts;
  const live = state.phase === "live";
  const agent = live && state.guest?.kind === "AGENT";
  const capturing = isCapturing(control);
  const showing = live && state.share === "sharing" && state.peerLostSince === null && state.reconnectSince === null;
  const drawTool = capturing || p.seatLock ? null : draw.tool;
  const tools = <ConsoleAnnotTools collab={collab} {...draw} tool={drawTool} capturing={capturing} lock={p.seatLock ?? null} />;
  return (
    <Stage
      state={state}
      stream={ts.stream}
      verifyCode={session.techVerifyCode}
      sessionCode={session.code}
      lobby={<LobbyPanel state={state} onAdmit={ts.admit} onReject={(g) => ts.reject(g.guestId)} />}
      annot={annotInput(collab, drawTool, draw.color)}
      tools={tools}
      controlBar={agent ? controlBar(p, showing, capturing) : null}
      monitors={agent && control.monitors.length > 1 ? <MonitorPicker s={control} now={now} onRequest={ts.requestMonitor} /> : null}
      monitorBusy={control.monitorPending !== null}
      nativeSize={agent ? nativeSizeOf(control) : null}
      control={agent ? stageControl(ts, p.canControl, p.releaseRef) : null}
    />
  );
}
