"use client";

import { ShieldAlert, ShieldUser } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { AnnotLayer, type DrawInput } from "@/components/collab/annot-layer";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { useRemoteInput } from "@/lib/control/use-remote-input";
import type { AnnotState } from "@/lib/dc/annot";
import type { TechState } from "@/lib/webrtc/tech-machine";
import { useFullscreen, useStageVideo, useStripFit } from "./stage-hooks";
import { stageOverlay } from "./stage-overlay";
import { StageStrip, type ViewMode } from "./stage-strip";

type StageAnnot = { state: AnnotState; input: DrawInput | null } | null;

/** P7 uzaktan kontrol: girdi yakalama + kırmızı çerçeve + uyarılar (AC-48, 49, 103 konsol eşi, 105). */
interface StageControl {
  /** Kontrol izni var ve teknisyen bırakmadı (görüntü yoksa yine yakalanmaz). */
  active: boolean;
  channel: RTCDataChannel | null;
  /** Ctrl+Alt+Shift: klavye yakalamasından çık (odak "Kontrolü bırak"a). */
  onKeyboardRelease: () => void;
  elevated: boolean;
  secureDesktop: boolean;
  /** K8 / S7-9: müşteri istemcisi yönetici olarak çalışıyor — kalıcı uyarı (kontrolü engellemez). */
  selfElevated: boolean;
  /** Kontrol müşteri kopması yüzünden kapandıysa "Bağlantı koptu" katmanında da yazılır (şerit o sırada gizli). */
  endedNote?: string | null;
}

interface StageProps {
  state: TechState;
  stream: MediaStream | null;
  verifyCode: string;
  sessionCode: string | null;
  lobby: ReactNode;
  /** P5 işaretleme: yalnız "Sığdır" görünümünde (koordinat = görünen içerik alanı). */
  annot?: StageAnnot;
  tools?: ReactNode;
  /** P7: kontrol düğmesi + monitör seçimi (şeritte, görüntü olmasa da görünür). */
  controlBar?: ReactNode;
  /** P7: monitör seçimi (dar sahnede "Görünüm" menüsünde). */
  monitors?: ReactNode;
  /** Monitör isteği müşteride bekliyor (menü kapalıyken tetikleyicide gösterge). */
  monitorBusy?: boolean;
  /** Görüntülenen müşteri monitörünün piksel boyutu: "%100" bununla 1:1 çizilir (TEST-P7-1). */
  nativeSize?: { w: number; h: number } | null;
  control?: StageControl | null;
}

/**
 * Konsol sahnesi (DESIGN §6.1 `console/stage.tsx`): `stage` zemini (iki temada koyu), uzak video,
 * durum mesajları ve üst katman uyarıları. `lobby` yuvası bekleyen varken lobi panelini gösterir.
 * P7: araçlar görüntünün ÜSTÜNDE değil, sahnenin üst şeridindedir (görüntünün hiçbir pikselini kapatmaz —
 * kontrol modunda üst kenardaki başlık çubuğu/menüler tıklanabilir kalır).
 */
export function Stage(p: StageProps) {
  const { state, controlBar, monitors, control } = p;
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const now = useNow();
  const [mode, setMode] = useState<ViewMode>("fit");
  const actual = mode === "actual";
  useStageVideo(ref, p.stream, p.nativeSize ?? null, actual);
  const { compact, tight, stripRef } = useStripFit(box);
  const { full, toggleFull } = useFullscreen(box);

  const live = state.phase === "live";
  const overlay = stageOverlay({
    state,
    now,
    lobby: p.lobby,
    verifyCode: p.verifyCode,
    sessionCode: p.sessionCode,
    endedNote: control?.endedNote,
    secureDesktop: control?.secureDesktop,
  });
  const showing = live && state.share === "sharing" && state.peerLostSince === null;
  const capturing = Boolean(control?.active && showing && !control.secureDesktop && state.reconnectSince === null);
  useRemoteInput({
    active: capturing,
    channel: control?.channel ?? null,
    target: scroll,
    video: ref,
    fullscreen: full,
    onKeyboardRelease: () => control?.onKeyboardRelease(),
  });
  const strip = showing || (controlBar && live && state.peerLostSince === null && state.reconnectSince === null);

  return (
    <section
      ref={box}
      id="sahne"
      aria-label={t("cs.label")}
      data-testid="stage"
      data-share={state.share}
      data-mode={mode}
      data-fullscreen={full}
      data-control={capturing ? "on" : "off"}
      className="relative flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-lg bg-stage"
    >
      {strip && (
        <StageStrip
          stripRef={stripRef}
          compact={compact}
          tight={tight}
          showing={showing}
          capturing={capturing}
          tools={p.tools}
          controlBar={controlBar}
          shareMethod={state.shareMethod}
          monitors={monitors}
          monitorBusy={p.monitorBusy ?? false}
          mode={mode}
          onMode={setMode}
          full={full}
          onToggleFull={toggleFull}
        />
      )}
      <StageBanners selfElevated={control?.selfElevated} elevated={showing && control?.elevated} />
      <StageView
        videoRef={ref}
        scrollRef={scroll}
        capturing={capturing}
        showing={showing}
        actual={actual}
        guestName={state.guest?.name ?? t("c.customer")}
        annot={p.annot}
        overlay={overlay}
      />
    </section>
  );
}

/** K8 / S7-9 kalıcı yönetici uyarısı ve yükseltilmiş ön plan uyarısı (kontrolü engellemez). */
function StageBanners({ selfElevated, elevated }: { selfElevated: boolean | undefined; elevated: boolean | undefined }) {
  const cls = "flex items-center justify-center gap-2 bg-warning-surface px-3 py-2 text-sm font-medium text-warning";
  return (
    <>
      {selfElevated && (
        <p role="status" data-testid="stage-self-elevated" className={cls}>
          <ShieldUser aria-hidden className="size-4 shrink-0" />
          {t("p7.selfElevated")}
        </p>
      )}
      {elevated && (
        <p role="status" data-testid="stage-elevated" className={cls}>
          <ShieldAlert aria-hidden className="size-4 shrink-0" />
          {t("p7.elevated")}
        </p>
      )}
    </>
  );
}

/** Görüntü alanı: video (+ işaretleme katmanı) ve üst katman mesajı. */
function StageView({
  videoRef,
  scrollRef,
  capturing,
  showing,
  actual,
  guestName,
  annot,
  overlay,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  capturing: boolean;
  showing: boolean;
  actual: boolean;
  guestName: string;
  annot: StageAnnot | undefined;
  overlay: ReactNode;
}) {
  const region = showing && actual;
  const frame = capturing ? "border-control-frame" : "border-transparent";
  return (
    // Kontrol aktifken kırmızı çerçeve (control-frame, iki temada sabit); kalınlık hep 4 px → kayma yok
    <div data-testid="stage-view" className={`relative flex min-h-[50vh] flex-1 items-center justify-center border-4 p-4 ${frame}`}>
      {/* %100: doğal boyut + kaydırma (klavyeyle odaklanıp ok tuşlarıyla kaydırılır); Sığdır: object-contain.
          Kontrol: aynı kap odaklanabilir "application" olur; fare/klavye uzak ekrana gider (lib/control). */}
      <div ref={scrollRef} data-testid="stage-scroll" {...scrollAttrs(capturing, region)} className={scrollClass(capturing, actual)}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          data-testid="console-video"
          aria-label={t("cs.video", { name: guestName })}
          className={`${actual ? "size-auto max-w-none" : "size-full object-contain"} ${showing ? "" : "invisible"}`}
        />
        {showing && !actual && annot && (
          <AnnotLayer video={videoRef} state={annot.state} input={capturing ? null : annot.input} label={t("p5.a.layer")} />
        )}
      </div>
      {overlay && <div className="relative z-10 flex w-full items-center justify-center">{overlay}</div>}
    </div>
  );
}

/** Kaydırma kabı: kontrolde odaklanabilir "application", "%100" görünümde odaklanabilir "region", aksi halde düz kap. */
function scrollAttrs(capturing: boolean, region: boolean) {
  if (capturing) return { tabIndex: 0, role: "application", "aria-label": t("p7.region") };
  if (region) return { tabIndex: 0, role: "region", "aria-label": t("cs.scroll") };
  return {};
}

function scrollClass(capturing: boolean, actual: boolean) {
  const overflow = actual ? "overflow-auto" : "overflow-hidden";
  const focus = capturing || actual ? "focus-visible:-outline-offset-2" : "";
  return `absolute inset-0 ${overflow} ${focus} ${capturing ? "cursor-default touch-none select-none" : ""}`;
}
