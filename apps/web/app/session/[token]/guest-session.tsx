"use client";

import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ShareStrip } from "@/components/guest/share-strip";
import { GuestCollab, PipButton, usePip } from "@/components/guest/guest-collab";
import { TechsList } from "@/components/guest/techs-list";
import { useVoiceAnnounce, VoiceAnnounce, VoiceBar } from "@/components/guest/voice-bar";
import { VoiceRequestDialog } from "@/components/guest/voice-dialog";
import { Alert } from "@/components/ui/alert";
import { namesOf } from "@/lib/voice/console";
import type { GuestVoice, GuestVoiceView } from "@/lib/voice/guest";
import { guestBarModel } from "@/lib/voice/ui";
import type { TechRosterEntry } from "@remote/contracts/ws-multi";
import { chatAuthor } from "@/lib/multi/roster";
import { useCollab } from "@/lib/dc/use-collab";
import { useGuestRec } from "@/lib/rec/use-guest-rec";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import type { Collab } from "@/lib/dc/use-collab";
import type { GuestEnd as MachineEnd, GuestState } from "@/lib/webrtc/guest-machine";
import { useGuestSession, type GuestCred, type ShareResult } from "@/lib/webrtc/use-guest-session";
import { GuestEndScreen, type GuestEnd } from "../guest-ui";
import {
  GuestEndDialog,
  GuestLiveAlerts,
  GuestLobby,
  GuestPreview,
  GuestResuming,
  useResumeStore,
  ViewOnlyNote,
} from "./guest-session-parts";

const END_UI: Record<MachineEnd, GuestEnd> = {
  ended: "finished",
  rejected: "rejected",
  lobbyTimeout: "lobbyTimeout",
  cancelled: "cancelled",
  expired: "expired",
  left: "left",
  lost: "lost",
  error: "error",
  resumeFailed: "consumed",
};

interface GuestInfo {
  technicianName: string;
  customerName: string;
  /** Lobi kodu; F5 dönüşünde (lobiye girilmez) null. */
  admitCode: string | null;
}

interface GuestSessionProps {
  info: GuestInfo;
  verifyCode: string;
  sessionRef: string;
  cred: GuestCred;
  storeKey: string | null;
}

type ShareControls = { busy: boolean; shareErr: ShareResult | null; onStart: () => void; onStop: () => void };

/** Paylaşımı başlat/durdur: başlatma sürerken meşgul; reddedilir/desteklenmezse neden gösterilir (AC-28..30). */
function useShareControls(startShare: () => Promise<ShareResult>, stopShare: () => void): ShareControls {
  const [busy, setBusy] = useState(false);
  const [shareErr, setShareErr] = useState<ShareResult | null>(null);
  const onStart = async () => {
    setBusy(true);
    const r = await startShare();
    setBusy(false);
    setShareErr(r === "ok" ? null : r);
  };
  return { busy, shareErr, onStart, onStop: stopShare };
}

/**
 * Lobi (admitCode, AC-112/113) → tarayıcı modu oturumu (paylaş/durdur/yeniden, bitir; AC-28..33, 59).
 * `storeKey`: F5 dönüş kaydı (TEST-P4-1) — her yeni reconnectToken yazılır, oturum bitince silinir.
 */
export function GuestSession({ info: join, verifyCode, sessionRef, cred, storeKey }: GuestSessionProps) {
  const g = useGuestSession(cred, sessionRef);
  const { state, end } = g;
  const [chatOpen, setChatOpen] = useState(true);
  // P28b (§5.4a): SERVER odasında sunucu caps'ten `file_transfer`'ı çıkarır; dosya yolu `hello.fileMode` ile açılır,
  // teknisyende yetki yoksa sunucu `fsrv.status{REJECTED, FORBIDDEN}` döner (metin satırda).
  const server = g.fileMode === "SERVER";
  const filesAllowed = server || g.caps.includes("file_transfer");
  const collab = useCollab(g.channels, {
    inbound: "TO_CUSTOMER",
    filesAllowed,
    chatVisible: chatOpen,
    receiveAnnot: true,
    sendMeta: g.send,
    // P28c (§4.5): sohbet tüm teknisyen eşlerine yayılır
    chatHub: g.chatHub,
    maxFileMb: g.maxFileMb,
    fsrv: {
      mode: g.fileMode,
      sendWs: g.send,
      subscribe: g.subscribe,
      ready: state.phase === "live" && state.reconnectSince === null && state.techPresent,
    },
  });
  const pip = usePip();
  // P28e (§9, AC-381/382): rıza (bellek) ilk hello'da gider; gösterge + Kaydı durdur yalnız sunucu durumundan
  const rec = useGuestRec({ subscribe: g.subscribe, send: g.send, preview: g.preview });
  const now = useNow();
  const share = useShareControls(g.startShare, g.stopShare);
  const [confirm, setConfirm] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = state.share === "sharing" ? g.preview : null;
  }, [g.preview, state.share, pip.win]);

  useResumeStore(storeKey, state, join, verifyCode, sessionRef);

  if (state.phase === "ended") return <GuestEnded end={state.end} />;
  if (state.phase === "connecting" && state.resuming) return <GuestResuming />;
  if (state.phase !== "live")
    return (
      <GuestLobby
        state={state}
        now={now}
        admitCode={join.admitCode}
        technicianName={join.technicianName}
        verifyCode={verifyCode}
        onLeave={end}
      />
    );
  const live = { state, now, techName: join.technicianName, share, video, collab, pip, rec };
  const multi = { roster: g.roster, onRemove: g.removeTech, onDrawn: g.markDrawn };
  const dialog = { confirm, onConfirm: setConfirm, onEnd: end };
  const voice = { view: g.voiceView, api: g.voice };
  return <GuestLive {...live} {...dialog} multi={multi} voice={voice} filesAllowed={filesAllowed} onChatVisible={setChatOpen} />;
}

interface GuestLiveProps {
  state: GuestState;
  now: number | null;
  techName: string;
  share: ShareControls;
  video: RefObject<HTMLVideoElement | null>;
  collab: Collab;
  pip: ReturnType<typeof usePip>;
  rec: ReturnType<typeof useGuestRec>;
  filesAllowed: boolean;
  onChatVisible: (v: boolean) => void;
  confirm: boolean;
  onConfirm: (v: boolean) => void;
  onEnd: () => void;
  /** P28c: bağlı teknisyenler (multi1 roster; eski sunucuda null → liste yok). */
  multi: { roster: TechRosterEntry[] | null; onRemove: (tid: string) => void; onDrawn: (tids: string[]) => void };
  /** P28d: sesli görüşme (görünüm + `GuestVoice`; mikrofon yalnız `accept()` tıklamasında, K-PD-2). */
  voice: { view: GuestVoiceView; api: GuestVoice };
}

/** Canlı oturum: paylaşım şeridi, uyarılar, önizleme (+PiP), sohbet/dosyalar, yalnız izleme notu, bitir onayı (AC-28..33, 59). */
function GuestLive(p: GuestLiveProps) {
  const { state, share, collab, pip, onConfirm } = p;
  const strip = state.reconnectSince !== null ? "reconnecting" : state.share;
  // P28d (Y-PD-3): yeni dinleyici duyurusundaki "Çıkar" teknisyen listesinin onayını açar
  const [removeTid, setRemoveTid] = useState<string | null>(null);
  return (
    <div className="-mx-4 -mt-2 flex flex-col gap-4">
      <ShareStrip
        state={strip}
        techName={p.techName}
        busy={share.busy}
        onStart={share.onStart}
        onStop={share.onStop}
        onEnd={() => onConfirm(true)}
        rec={p.rec}
      />
      <div className="flex flex-col gap-4 px-4">
        <GuestLiveAlerts state={state} now={p.now} shareErr={share.shareErr} busy={share.busy} onRetry={share.onStart} />
        <GuestVoiceSlot voice={p.voice} roster={p.multi.roster ?? []} onRemove={setRemoveTid} />
        <section aria-labelledby="on-t" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h1 id="on-t" className="text-lg font-semibold text-fg">
            {t("gs.previewTitle")}
          </h1>
          <GuestPreview video={p.video} share={state.share} annot={collab.annot} pipWin={pip.win} />
          {state.share === "sharing" && <PipButton pip={pip} />}
        </section>
        {p.multi.roster && (
          <TechsList
            roster={p.multi.roster}
            onRemove={p.multi.onRemove}
            onDrawn={p.multi.onDrawn}
            confirmTid={removeTid}
            onConfirmTid={setRemoveTid}
          />
        )}
        <GuestCollab
          collab={collab}
          filesAllowed={p.filesAllowed}
          techName={p.techName}
          onChatVisible={p.onChatVisible}
          authorOf={p.multi.roster ? (by) => chatAuthor(by, p.multi.roster ?? [], p.techName) : undefined}
        />
        <ViewOnlyNote />
      </div>
      <GuestEndDialog
        open={p.confirm}
        onClose={() => onConfirm(false)}
        onEnd={() => {
          onConfirm(false);
          p.onEnd();
        }}
      />
    </div>
  );
}

/**
 * P28d müşteri sesli görüşme: istek diyaloğu, görüşme çubuğu, yeni dinleyici duyurusu (assertive bölge her zaman monte),
 * mikrofon açılamadı uyarısı (V-PD-1). Adlar yalnız sunucu roster'ından (D-PD-3).
 */
function GuestVoiceSlot({
  voice,
  roster,
  onRemove,
}: {
  voice: GuestLiveProps["voice"];
  roster: readonly TechRosterEntry[];
  onRemove: (tid: string) => void;
}) {
  const { view, api } = voice;
  const ann = useVoiceAnnounce(view);
  const items = ann.tids.flatMap((tid) => {
    const e = roster.find((x) => x.tid === tid);
    return e ? [{ tid, name: e.name, owner: e.owner }] : [];
  });
  return (
    <>
      <VoiceAnnounce seq={ann.seq} items={items} onRemove={onRemove} />
      <VoiceBar model={guestBarModel(view, roster)} onMute={(on) => api.setMuted(on)} onEnd={() => api.end()} />
      {view.note === "device" && (
        <Alert tone="warning" testId="voice-device">
          {t("vg.device")}
        </Alert>
      )}
      {view.note === "unconfirmed" && (
        <Alert tone="info" testId="voice-unconfirmed">
          {t("vg.unconfirmed")}
        </Alert>
      )}
      <VoiceRequestDialog
        request={view.request}
        listenerNames={view.request ? namesOf(view.request.listeners, roster) : []}
        onAccept={() => api.accept()}
        onReject={() => api.reject()}
      />
    </>
  );
}

/** Bitiş ekranı; lobi zaman aşımı / bağlantı kaybında "Yeniden katıl". */
function GuestEnded({ end }: { end: MachineEnd | null }) {
  const kind = END_UI[end ?? "ended"];
  const again = kind === "lobbyTimeout" || kind === "lost";
  return (
    <GuestEndScreen
      kind={kind}
      action={
        again ? (
          <Button variant="secondary" onClick={() => location.reload()}>
            <RotateCw aria-hidden className="size-4" />
            {t("g.rejoin")}
          </Button>
        ) : undefined
      }
    />
  );
}
