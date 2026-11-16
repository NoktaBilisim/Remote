"use client";

import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ShareStrip } from "@/components/guest/share-strip";
import { GuestCollab, PipButton, usePip } from "@/components/guest/guest-collab";
import { useCollab } from "@/lib/dc/use-collab";
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
    maxFileMb: g.maxFileMb,
    fsrv: {
      mode: g.fileMode,
      sendWs: g.send,
      subscribe: g.subscribe,
      ready: state.phase === "live" && state.reconnectSince === null && state.techPresent,
    },
  });
  const pip = usePip();
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
  const live = { state, now, techName: join.technicianName, share, video, collab, pip };
  const dialog = { confirm, onConfirm: setConfirm, onEnd: end };
  return <GuestLive {...live} {...dialog} filesAllowed={filesAllowed} onChatVisible={setChatOpen} />;
}

interface GuestLiveProps {
  state: GuestState;
  now: number | null;
  techName: string;
  share: ShareControls;
  video: RefObject<HTMLVideoElement | null>;
  collab: Collab;
  pip: ReturnType<typeof usePip>;
  filesAllowed: boolean;
  onChatVisible: (v: boolean) => void;
  confirm: boolean;
  onConfirm: (v: boolean) => void;
  onEnd: () => void;
}

/** Canlı oturum: paylaşım şeridi, uyarılar, önizleme (+PiP), sohbet/dosyalar, yalnız izleme notu, bitir onayı (AC-28..33, 59). */
function GuestLive(p: GuestLiveProps) {
  const { state, share, collab, pip, onConfirm } = p;
  const strip = state.reconnectSince !== null ? "reconnecting" : state.share;
  return (
    <div className="-mx-4 -mt-2 flex flex-col gap-4">
      <ShareStrip
        state={strip}
        techName={p.techName}
        busy={share.busy}
        onStart={share.onStart}
        onStop={share.onStop}
        onEnd={() => onConfirm(true)}
      />
      <div className="flex flex-col gap-4 px-4">
        <GuestLiveAlerts state={state} now={p.now} shareErr={share.shareErr} busy={share.busy} onRetry={share.onStart} />
        <section aria-labelledby="on-t" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <h1 id="on-t" className="text-lg font-semibold text-fg">
            {t("gs.previewTitle")}
          </h1>
          <GuestPreview video={p.video} share={state.share} annot={collab.annot} pipWin={pip.win} />
          {state.share === "sharing" && <PipButton pip={pip} />}
        </section>
        <GuestCollab collab={collab} filesAllowed={p.filesAllowed} techName={p.techName} onChatVisible={p.onChatVisible} />
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
