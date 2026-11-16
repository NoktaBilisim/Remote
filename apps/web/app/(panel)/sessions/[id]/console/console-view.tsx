"use client";

import type { SessionView } from "@remote/contracts/api/sessions";
import { useEffect, useId, useRef, useState } from "react";
import type { DrawTool } from "@/components/collab/annot-layer";
import { CollabSide, type CollabTab } from "@/components/console/collab-side";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { useClipPrint } from "@/lib/clip/use-clip-print";
import type { AnnotColor } from "@/lib/dc/ctl";
import { useCollab } from "@/lib/dc/use-collab";
import { useQuality } from "@/lib/webrtc/use-quality";
import { useTechSession } from "@/lib/webrtc/use-tech-session";
import { ConsoleHeader } from "./console-header";
import { ConfirmEndDialog, ConsoleEnded } from "./console-parts";
import { ConsoleStage } from "./console-stage";
import { useControlToasts } from "./use-control-toasts";

/** Konsol: üst bar (müşteri, durum, süre, doğrulama kodu, bitir/iptal) + sahne. Sohbet/dosya/işaretleme/kalite P5. */
export function ConsoleView({
  session,
  canFiles,
  canControl,
  canClip = false,
  canPrint = false,
}: {
  session: SessionView;
  canFiles: boolean;
  canControl: boolean;
  /** P28a: `remote_control.clipboard` / `file_transfer.print` (yoksa düğme gizli). */
  canClip?: boolean;
  canPrint?: boolean;
}) {
  const ts = useTechSession(session.id);
  const { state, control } = ts;
  const [tab, setTab] = useState<CollabTab>("chat");
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [color, setColor] = useState<AnnotColor>("red");
  // P28a §4.4: yazdırma `file` kanalını kullanırken dosya teklifi "busy" (kanca sırası nedeniyle ref üzerinden)
  const printBusy = useRef<() => boolean>(() => false);
  const files = serverFiles(state, canFiles);
  const collab = useCollab(ts.channels, { ...collabOptions(ts, files.allowed, tab), printBusy: () => printBusy.current() });
  const quality = useQuality(ts.pc, ts.send);
  const now = useNow();
  const toast = useToast();
  const clipPrint = useClipPrint(ts, collab, { clip: canClip, print: canPrint }, toast, now);
  useEffect(() => {
    printBusy.current = clipPrint.transferring;
  }, [clipPrint.transferring]);
  const { confirm, setConfirm, busy, confirmEnd } = useEndConfirm(session.id, state.phase === "live", quality, ts.end, toast);
  const controlHint = useId();
  const live = state.phase === "live";
  const name = state.guest?.name ?? t("c.customer");

  const releaseRef = useRef<HTMLButtonElement>(null);
  useControlToasts(control, toast);

  return (
    <div className="flex flex-col gap-3" data-testid="console" data-phase={state.phase}>
      <ConsoleHeader session={session} state={state} name={name} now={now} controlHint={controlHint} onConfirm={() => setConfirm(true)} />

      {state.warnEndsAt && state.phase !== "ended" && (
        <Alert tone="warning">{t("c.warning", { time: formatTime(state.warnEndsAt) })}</Alert>
      )}

      {state.phase === "ended" ? (
        <ConsoleEnded end={state.end} />
      ) : (
        <div className="flex flex-col gap-3 xl:flex-row">
          <ConsoleStage
            ts={ts}
            session={session}
            collab={collab}
            draw={{ tool, color, onTool: setTool, onColor: setColor }}
            canControl={canControl}
            now={now}
            releaseRef={releaseRef}
          />
          {live && (
            <CollabSide
              collab={collab}
              clipPrint={clipPrint}
              now={now}
              quality={quality}
              canFiles={files.allowed}
              filesBlocked={files.blocked}
              peerName={name}
              tab={tab}
              onTab={setTab}
            />
          )}
        </div>
      )}

      <ConfirmEndDialog open={confirm} live={live} busy={busy} onClose={() => setConfirm(false)} onConfirm={confirmEnd} />
    </div>
  );
}

/**
 * P28b (§5.4, K-P28b-7): SERVER modunda dosya yolu misafirin `fsrv` yeteneğine bağlı; gözetimsiz odada kapalı. Yetki yoksa
 * mevcut P5 metni ("yetki yok") — `blocked` yalnız yetkili teknisyende neden verir.
 */
function serverFiles(s: ReturnType<typeof useTechSession>["state"], canFiles: boolean) {
  if (s.fileMode !== "SERVER" || !canFiles) return { allowed: canFiles, blocked: null };
  if (s.unattended) return { allowed: false, blocked: "unattended" as const };
  if (s.guest && s.peerLostSince === null && !s.guestFeatures.includes("fsrv")) return { allowed: false, blocked: "unsupported" as const };
  return { allowed: true, blocked: null };
}

/** Konsol tarafı işbirliği seçenekleri (gelen yön TO_TECH; okunmamış sayacı sohbet sekmesi açıkken sıfırlanır). */
function collabOptions(ts: ReturnType<typeof useTechSession>, canFiles: boolean, tab: CollabTab) {
  return {
    inbound: "TO_TECH" as const,
    filesAllowed: canFiles,
    chatVisible: tab === "chat",
    receiveAnnot: false,
    sendMeta: ts.send,
    maxFileMb: ts.maxFileMb,
    fsrv: {
      mode: ts.state.fileMode,
      sendWs: ts.send,
      subscribe: ts.subscribe,
      ready: ts.state.phase === "live" && ts.state.peerLostSince === null && ts.state.reconnectSince === null,
    },
  };
}

/**
 * Bitir / iptal onayı. Canlıda: son kalite özeti (AC-46, session.end'den önce) + session.end. Beklemede: REST iptal;
 * sunucu odaya session.ended{cancelled} yollar → "bitti" ekranı.
 */
function useEndConfirm(
  sessionId: string,
  live: boolean,
  quality: ReturnType<typeof useQuality>,
  end: () => void,
  toast: ReturnType<typeof useToast>,
) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmEnd = async () => {
    if (live) {
      quality.flush();
      end();
      return setConfirm(false);
    }
    setBusy(true);
    try {
      await api("POST", `/sessions/${sessionId}/cancel`);
      setConfirm(false);
    } catch (e) {
      toast(toUiError(e).message, "danger");
    } finally {
      setBusy(false);
    }
  };
  return { confirm, setConfirm, busy, confirmEnd };
}
