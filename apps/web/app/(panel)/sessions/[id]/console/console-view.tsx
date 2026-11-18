"use client";

import type { SessionView } from "@remote/contracts/api/sessions";
import { useEffect, useId, useRef, useState } from "react";
import type { DrawTool } from "@/components/collab/annot-layer";
import { CollabSide, type CollabTab } from "@/components/console/collab-side";
import { RecIndicator } from "@/components/console/rec-indicator";
import { TechsPanel } from "@/components/console/techs-panel";
import { UnattendedActions } from "@/components/console/unattended-actions";
import { VoiceAudio, VoiceControls } from "@/components/console/voice-controls";
import { MULTI_ERROR_MESSAGES } from "@remote/contracts/api/multi";
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
import { inviteBlockOf } from "@/lib/multi/errors";
import { autoControlDecision } from "@/lib/unattended/consent";
import { canSend, chatAuthor, seatOf, type Seat } from "@/lib/multi/roster";
import { consoleVoiceView, shouldListen } from "@/lib/voice/console";
import { voiceEndToast } from "@/lib/voice/ui";
import { useConsoleVoice } from "@/lib/voice/use-console-voice";
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
  isOwner = true,
  canInvite = false,
  canVoice = false,
}: {
  /** P28d: `sessions.voice` (sesli görüşme başlat/katıl/dinle; yoksa yalnız "dinleme yetkiniz yok" bilgisi). */
  canVoice?: boolean;
  /** P28c: konsolu açan oturum sahibi mi (değilse üye olarak bağlanır; üye değilse `notMember`). */
  isOwner?: boolean;
  /** P28c: `sessions.invite` (davet, kontrol/oturum devri — yalnız oturum sahibinde anlamlı). */
  canInvite?: boolean;
  session: SessionView;
  canFiles: boolean;
  canControl: boolean;
  /** P28a: `remote_control.clipboard` / `file_transfer.print` (yoksa düğme gizli). */
  canClip?: boolean;
  canPrint?: boolean;
}) {
  const ts = useTechSession(session.id, { member: !isOwner });
  const { state, control } = ts;
  const seat = mySeat(state, isOwner);
  const notController = !seat.controller;
  // P28c (§1.1, ROLE_MAY): kontrol sahibine özgü WS mesajları (quality.summary, file.meta, rec.error) yalnız kontrol sahibinden
  const gatedSend = (m: Parameters<typeof ts.send>[0]) => (canSend(seat, m.t) ? ts.send(m) : undefined);
  const [tab, setTab] = useState<CollabTab>("chat");
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [color, setColor] = useState<AnnotColor>("red");
  // P28a §4.4: yazdırma `file` kanalını kullanırken dosya teklifi "busy" (kanca sırası nedeniyle ref üzerinden)
  const printBusy = useRef<() => boolean>(() => false);
  const files = notController && canFiles ? { allowed: false, blocked: "notController" as const } : serverFiles(state, canFiles);
  const collab = useCollab(ts.channels, {
    ...collabOptions(ts, files.allowed, tab),
    sendMeta: gatedSend,
    printBusy: () => printBusy.current(),
  });
  const quality = useQuality(ts.pc, gatedSend);
  const now = useNow();
  const toast = useToast();
  const clipPrint = useClipPrint(ts, collab, { clip: canClip, print: canPrint, notController }, toast, now);
  useEffect(() => {
    printBusy.current = clipPrint.transferring;
  }, [clipPrint.transferring]);
  const { confirm, setConfirm, busy, confirmEnd } = useEndConfirm(session.id, state.phase === "live", quality, ts.end, toast);
  const controlHint = useId();
  const live = state.phase === "live";
  const name = state.guest?.name ?? t("c.customer");

  const releaseRef = useRef<HTMLButtonElement>(null);
  useControlToasts(control, toast);
  useAutoControl(ts, seat.controller, canControl);
  const voice = useVoiceSlot(ts, seat, canVoice, now, toast);

  return (
    <div className="flex flex-col gap-3" data-testid="console" data-phase={state.phase}>
      <ConsoleHeader
        session={session}
        state={state}
        name={name}
        now={now}
        controlHint={controlHint}
        owner={seat.owner}
        onConfirm={() => setConfirm(true)}
        voice={voice}
      />

      {/* P28c (§10): teknisyenler paneli (roster, davet, devir, ayrılma) */}
      {state.phase !== "ended" && (
        <TechsPanel
          ts={ts}
          sessionId={session.id}
          seat={seat}
          canInvite={canInvite}
          inviteBlock={inviteBlockOf(state.guestMulti)}
          now={now}
        />
      )}

      {/* P28e (§9): kayıt göstergesi + kaydedici (tüm teknisyenlerde gösterge; kaydedici yalnız upload alan sokette) */}
      <RecIndicator subscribe={ts.subscribe} send={gatedSend} stream={ts.stream} ended={state.phase === "ended"} />

      {state.phase !== "ended" && (
        <UnattendedActions sessionId={session.id} unattended={state.unattended} phase={control.phase} live={live} now={now} />
      )}

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
            seatLock={notController ? t("mt.onlyController") : null}
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
              chat={{
                authorOf: (by) => chatAuthor(by, state.roster, name),
                readOnlyNote: seat.observer ? t("mt.observerChat") : null,
              }}
            />
          )}
        </div>
      )}

      <ConfirmEndDialog open={confirm} live={live} busy={busy} onClose={() => setConfirm(false)} onConfirm={confirmEnd} />
    </div>
  );
}

/**
 * P28d (§4.3, §8; D-PD-5): ses kancası KOŞULSUZ (yeni katılan teknisyene `voice.state` roster'dan hemen sonra gelir); bitiş
 * toast'ı yalnız kendi görüşmemde. `now` henüz yokken (hidrasyon) görünüm gizli — bekleme/geri sayım 0'a göre hesaplanmaz.
 */
function useVoiceSlot(
  ts: ReturnType<typeof useTechSession>,
  seat: Seat,
  canVoice: boolean,
  now: number | null,
  toast: ReturnType<typeof useToast>,
) {
  const { state } = ts;
  const connected = state.phase === "live" && state.reconnectSince === null;
  const v = useConsoleVoice({
    subscribe: ts.subscribe,
    send: ts.send,
    setVoiceTrack: ts.voice.setVoiceTrack,
    me: state.tid,
    connected,
  });
  useEffect(() => {
    const m = voiceEndToast(v.ended);
    if (m) toast(m, "info");
  }, [v.ended, toast]);
  const view =
    now === null
      ? ({ kind: "hidden" } as const)
      : consoleVoiceView(v.s, {
          me: state.tid,
          observer: seat.observer,
          canVoice,
          guestVoice: state.guestVoice,
          unattended: !!state.unattended,
          live: connected && state.peerLostSince === null,
          now,
        });
  return (
    <>
      <VoiceControls
        view={view}
        unsupportedText={MULTI_ERROR_MESSAGES.CLIENT_UNSUPPORTED}
        onRequest={v.request}
        onJoin={v.join}
        onEnd={v.end}
        onMute={v.mute}
      />
      <VoiceAudio track={ts.voice.remoteAudio} listen={shouldListen(v.s, state.tid)} />
    </>
  );
}

/**
 * P28u r3 (K-P28u-r3-6, S-P28u-r3-2): gözetimsiz odada misafir katılınca / yeniden katılınca bir kez `control.request`
 * (makine kapısından, `requestControl`); yalnız o an kontrol sahibiysem. Devirde (handover) otomatik istek yok — karar yalnız
 * `guestJoins` değişiminde verilir (`autoControlDecision`). Ref temizlenmez: yeniden çizim / StrictMode ikinci istek üretmez.
 */
function useAutoControl(ts: ReturnType<typeof useTechSession>, controller: boolean, canControl: boolean) {
  const seen = useRef(0);
  const { guestJoins, unattended } = ts.state;
  const phase = ts.control.phase;
  const { requestControl } = ts;
  useEffect(() => {
    const r = autoControlDecision(seen.current, { joins: guestJoins, unattended: unattended !== null, controller, canControl, phase });
    seen.current = r.seen;
    if (r.fire) requestControl();
  }, [guestJoins, unattended, controller, canControl, phase, requestControl]);
}

/** P28c: yerim roster'dan; üye konsolunda `hello` gelmeden önce hiçbir yetki yok (sahip varsayılmaz). */
function mySeat(s: ReturnType<typeof useTechSession>["state"], isOwner: boolean): Seat {
  if (!isOwner && s.tid === null && s.techRole === null) return { owner: false, controller: false, observer: false };
  return seatOf(s.roster, s.tid, s.techRole);
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
