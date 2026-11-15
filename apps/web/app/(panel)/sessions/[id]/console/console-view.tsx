"use client";

import type { SessionView } from "@remote/contracts/api/sessions";
import { ArrowLeft, CircleX, MousePointer2, Power } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { DrawTool } from "@/components/collab/annot-layer";
import { AnnotToolbar, CollabSide, type CollabTab } from "@/components/console/collab-side";
import { ControlButton, MonitorPicker, monitorName } from "@/components/console/control-button";
import { LobbyPanel } from "@/components/console/lobby-panel";
import { Stage } from "@/components/console/stage";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatRemaining, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import type { AnnotColor } from "@/lib/dc/ctl";
import { useCollab } from "@/lib/dc/use-collab";
import { useQuality } from "@/lib/webrtc/use-quality";
import { useTechSession } from "@/lib/webrtc/use-tech-session";
import { comboMsgs, SPECIAL_COMBOS, type SpecialComboId } from "@/lib/control/input";
import { isCapturing } from "@/lib/control/machine";
import { sendInput } from "@/lib/control/use-remote-input";

const pill = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

/** Konsol: üst bar (müşteri, durum, süre, doğrulama kodu, bitir/iptal) + sahne. Sohbet/dosya/işaretleme/kalite P5. */
export function ConsoleView({ session, canFiles, canControl }: { session: SessionView; canFiles: boolean; canControl: boolean }) {
  const {
    state,
    stream,
    channels,
    pc,
    send,
    maxFileMb,
    admit,
    reject,
    end: endWs,
    control,
    input,
    requestControl,
    requestMonitor,
    releaseControl,
    cancelControl,
  } = useTechSession(session.id);
  const [tab, setTab] = useState<CollabTab>("chat");
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [color, setColor] = useState<AnnotColor>("red");
  const collab = useCollab(channels, {
    inbound: "TO_TECH",
    filesAllowed: canFiles,
    chatVisible: tab === "chat",
    receiveAnnot: false,
    sendMeta: send,
    maxFileMb,
  });
  const quality = useQuality(pc, send);
  // AC-46: oturum sonunda son kalite özeti (session.end'den önce)
  const end = () => {
    quality.flush();
    endWs();
  };
  const now = useNow();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const controlHint = useId();
  const live = state.phase === "live";
  const name = state.guest?.name ?? t("c.customer");

  // P7 uzaktan kontrol (yalnız Hızlı Destek misafiri + remote_control.use; AC-34, 51)
  const agent = live && state.guest?.kind === "AGENT";
  const capturing = isCapturing(control);
  const releaseRef = useRef<HTMLButtonElement>(null);
  const showing = live && state.share === "sharing" && state.peerLostSince === null && state.reconnectSince === null;
  // İşaretleme ve kontrol çakışmaz: kontrol yakalanırken çizim aracı etkisiz (araç çubuğu pasif)
  const drawTool = capturing ? null : tool;
  // "%100" = görüntülenen monitörün pikselleriyle 1:1 (TEST-P7-1); tarayıcı paylaşımında monitör bilgisi yok
  const activeMon = control.monitors.find((m) => m.id === control.activeMonitor) ?? null;
  const nativeSize = agent && activeMon ? { w: activeMon.w, h: activeMon.h } : null;
  // Durum geçiş bildirimleri (AC-50 ≤ 1 sn, AC-99 "Kontrol reddedildi")
  const prev = useRef(control);
  useEffect(() => {
    const p = prev.current;
    prev.current = control;
    if (p.phase !== "granted" && control.phase === "granted") toast(t("p7.toast.granted"), "success");
    else if (p.phase !== "denied" && control.phase === "denied") toast(t("p7.toast.denied"), "danger");
    // Teknisyenin kendi bırakması/iptali bildirim üretmez (not satırında yazar)
    else if (p.phase === "granted" && control.phase !== "granted" && control.endedBy && control.endedBy !== "tech")
      toast(t(`p7.end.${control.endedBy}`), "danger");
    if (!p.forbidden && control.forbidden) toast(t("p7.forbidden"), "danger");
    // Dar sahnede monitör seçimi menüde: sonuç menü kapalıyken de duyurulsun (TEST-P7-2)
    if (p.monitorOutcome !== control.monitorOutcome && control.monitorOutcome && control.monitorOutcome !== "switched") {
      const key = {
        denied: "p7.monitorDenied",
        noAnswer: "p7.monitorNoAnswer",
        rate: "p7.monitorRate",
        already: "p7.monitorAlready",
      } as const;
      toast(t(key[control.monitorOutcome]), "danger");
    }
    if (p.monitorOutcome !== "switched" && control.monitorOutcome === "switched") {
      const i = control.monitors.findIndex((m) => m.id === control.activeMonitor);
      if (i >= 0) toast(t("p7.monitorSwitched", { name: monitorName(control.monitors[i]!, i) }), "success");
    }
  }, [control, toast]);
  const sendKeys = (id: SpecialComboId) => {
    const c = SPECIAL_COMBOS.find((x) => x.id === id);
    if (!c || !capturing) return;
    for (const m of comboMsgs(c.codes)) sendInput(input, m);
  };

  const status =
    state.phase === "ended"
      ? { cls: "bg-surface-muted text-fg-muted", label: t("c.st.ended") }
      : state.reconnectSince !== null || state.peerLostSince !== null
        ? { cls: "bg-danger-surface text-danger", label: t("c.st.lost") }
        : live
          ? { cls: "bg-success-surface text-success", label: t("c.st.live") }
          : state.pending.length
            ? { cls: "bg-warning-surface text-warning", label: t("c.st.lobby") }
            : { cls: "bg-primary-surface text-primary", label: t("c.st.waiting") };
  const until = live ? state.maxEndsAt : session.expiresAt;
  const left = until && now !== null ? formatRemaining(Date.parse(until) - now) : "—";

  const confirmEnd = async () => {
    if (live) {
      end();
      return setConfirm(false);
    }
    setBusy(true);
    try {
      await api("POST", `/sessions/${session.id}/cancel`);
      setConfirm(false); // sunucu odaya session.ended{cancelled} yollar → "bitti" ekranı
    } catch (e) {
      toast(toUiError(e).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="console" data-phase={state.phase}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg xl:flex-nowrap border border-border bg-surface px-3 py-2">
        <Link
          href="/sessions"
          aria-label={t("c.back")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={name} />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-fg" data-testid="console-guest">
              {name}
            </h1>
            <p className="text-xs text-fg-muted">{t(state.guest?.kind === "AGENT" ? "cl.kindAgent" : "c.kindBrowser")}</p>
          </div>
        </div>
        <span role="status" data-testid="console-status" className={`${pill} shrink-0 ${status.cls}`}>
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {status.label}
        </span>
        {state.phase !== "ended" && (
          <div className="shrink-0 text-xs text-fg-muted">
            <span className="block">{live ? t("c.maxLeft") : t("c.codeLeft")}</span>
            <b className="text-sm tabular-nums text-fg" data-testid="console-left">
              {left}
            </b>
          </div>
        )}
        <div className="shrink-0 text-xs text-fg-muted">
          <span className="block">{t("cs.verify")}</span>
          <CodeDisplay code={session.techVerifyCode} size="sm" testId="console-verify-code" />
        </div>
        <span className="flex-1" />
        {live && state.guest?.kind === "BROWSER" && (
          // AC-34: tarayıcı modunda kontrol yok — buton pasif, nedeni yanında (AGENT'ta etkin akış: ControlButton, P7)
          // TEST-P4-4: dar masaüstünde (1280 px) açıklama satır kırarak daralır; "Oturumu bitir" aynı satırda kalır
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="secondary" disabled className="shrink-0" aria-describedby={controlHint} data-testid="console-control">
              <MousePointer2 aria-hidden className="size-4" />
              {t("c.control")}
            </Button>
            <p id={controlHint} className="min-w-20 max-w-48 text-xs text-fg-muted" data-testid="console-control-hint">
              {t("c.controlBrowser")}
            </p>
          </div>
        )}
        {live && (
          <Button variant="danger" onClick={() => setConfirm(true)} data-testid="console-end" className="shrink-0">
            <Power aria-hidden className="size-4" />
            {t("c.end")}
          </Button>
        )}
        {state.phase === "waiting" && (
          <Button variant="danger-ghost" onClick={() => setConfirm(true)} data-testid="console-cancel" className="shrink-0">
            <CircleX aria-hidden className="size-4" />
            {t("c.cancel")}
          </Button>
        )}
      </header>

      {state.warnEndsAt && state.phase !== "ended" && (
        <Alert tone="warning">{t("c.warning", { time: formatTime(state.warnEndsAt) })}</Alert>
      )}

      {state.phase === "ended" ? (
        <section
          role="status"
          data-testid="console-ended"
          className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6"
        >
          <h2 className="text-lg font-semibold text-fg">{t("c.endedTitle")}</h2>
          <p className="text-sm text-fg-muted">{t(`c.reason.${state.end ?? "server"}`)}</p>
          <Link href="/sessions" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline">
            <ArrowLeft aria-hidden className="size-4" />
            {t("c.back")}
          </Link>
        </section>
      ) : (
        <div className="flex flex-col gap-3 xl:flex-row">
          <Stage
            state={state}
            stream={stream}
            verifyCode={session.techVerifyCode}
            sessionCode={session.code}
            lobby={<LobbyPanel state={state} onAdmit={admit} onReject={(p) => reject(p.guestId)} />}
            annot={
              collab.ready
                ? {
                    state: collab.annot,
                    input: drawTool
                      ? {
                          tool: drawTool,
                          color,
                          onStroke: (s) => collab.sendAnnot({ t: "annot.stroke", id: s.id, tool: s.tool, color: s.color, pts: s.pts }),
                          onLaser: (x, y) => collab.sendAnnot({ t: "annot.laser", x, y }),
                        }
                      : null,
                  }
                : null
            }
            tools={
              collab.ready ? (
                <AnnotToolbar
                  tool={drawTool}
                  color={color}
                  onTool={setTool}
                  onColor={setColor}
                  onUndo={() =>
                    collab.sendAnnot({ t: "annot.undo", ...(collab.annot.strokes.at(-1) ? { id: collab.annot.strokes.at(-1)?.id } : {}) })
                  }
                  onClear={() => collab.sendAnnot({ t: "annot.clear" })}
                  disabledHint={capturing ? t("p7.annotOff") : null}
                />
              ) : null
            }
            controlBar={
              agent ? (
                <>
                  {canControl && (
                    <ControlButton
                      s={control}
                      now={now}
                      available={showing}
                      onRequest={requestControl}
                      onRelease={releaseControl}
                      onCancel={cancelControl}
                      onKeys={sendKeys}
                      releaseRef={releaseRef}
                    />
                  )}
                </>
              ) : null
            }
            monitors={agent && control.monitors.length > 1 ? <MonitorPicker s={control} now={now} onRequest={requestMonitor} /> : null}
            monitorBusy={control.monitorPending !== null}
            nativeSize={nativeSize}
            control={
              agent
                ? {
                    active: canControl && capturing,
                    channel: input,
                    onKeyboardRelease: () => releaseRef.current?.focus(),
                    elevated: control.env.elevated,
                    secureDesktop: control.env.secure,
                    selfElevated: control.env.self,
                    endedNote: control.phase === "idle" && control.endedBy === "peer" ? t("p7.end.peer") : null,
                  }
                : null
            }
          />
          {live && <CollabSide collab={collab} quality={quality} canFiles={canFiles} peerName={name} tab={tab} onTab={setTab} />}
        </div>
      )}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={live ? t("c.endTitle") : t("c.cancelTitle")}
        description={live ? t("c.endBody") : t("c.cancelBody")}
        size="sm"
        role="alertdialog"
        testId="console-confirm"
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(false)} disabled={busy} className="sm:ml-auto">
              {t("c.keep")}
            </Button>
            <Button variant="danger" loading={busy} onClick={confirmEnd} data-testid="console-confirm-ok">
              {!busy && (live ? <Power aria-hidden className="size-4" /> : <CircleX aria-hidden className="size-4" />)}
              {live ? t("c.end") : t("c.cancel")}
            </Button>
          </>
        }
      />
    </div>
  );
}
