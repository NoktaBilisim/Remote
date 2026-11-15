"use client";

import {
  Expand,
  Hourglass,
  LoaderCircle,
  Maximize,
  Minimize,
  MonitorCog,
  ScanSearch,
  ScreenShareOff,
  ShieldAlert,
  ShieldUser,
  WifiOff,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnnotLayer, type DrawInput } from "@/components/collab/annot-layer";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { Menu } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/segmented";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { actualViewSize } from "@/lib/control/input";
import { useRemoteInput } from "@/lib/control/use-remote-input";
import type { AnnotState } from "@/lib/dc/annot";
import type { TechState } from "@/lib/webrtc/tech-machine";

const PEER_WINDOW_MS = 120_000;
/**
 * TEST-P7-2: sahne bu genişliğin altındaysa monitör / görünüm / tam ekran tek "Görünüm" menüsüne toplanır — şerit
 * kontrol sırasında tek satır kalır (1280 px pencerede sahne ~580 px). Üstünde hepsi şeritte satır içi.
 */
const COMPACT_BELOW_PX = 960;
type ViewMode = "fit" | "actual";

function Msg({
  icon,
  title,
  children,
  alert,
  panel,
  testId,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  alert?: boolean;
  panel?: boolean;
  testId?: string;
}) {
  return (
    <div
      role={alert ? "alert" : "status"}
      data-testid={testId}
      className={`flex max-w-md flex-col items-center gap-2 px-4 text-center text-on-stage ${panel ? "rounded-lg bg-stage/90 py-4 shadow-lg" : ""}`}
    >
      {icon}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="text-sm">{children}</div>}
    </div>
  );
}

/** P7 uzaktan kontrol: girdi yakalama + kırmızı çerçeve + uyarılar (AC-48, 49, 103 konsol eşi, 105). */
export interface StageControl {
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

/**
 * Konsol sahnesi (DESIGN §6.1 `console/stage.tsx`): `stage` zemini (iki temada koyu), uzak video,
 * durum mesajları ve üst katman uyarıları. `lobby` yuvası bekleyen varken lobi panelini gösterir.
 * P7: araçlar görüntünün ÜSTÜNDE değil, sahnenin üst şeridindedir (görüntünün hiçbir pikselini kapatmaz —
 * kontrol modunda üst kenardaki başlık çubuğu/menüler tıklanabilir kalır).
 */
export function Stage({
  state,
  stream,
  verifyCode,
  sessionCode,
  lobby,
  annot,
  tools,
  controlBar,
  monitors,
  monitorBusy = false,
  nativeSize = null,
  control,
}: {
  state: TechState;
  stream: MediaStream | null;
  verifyCode: string;
  sessionCode: string | null;
  lobby: ReactNode;
  /** P5 işaretleme: yalnız "Sığdır" görünümünde (koordinat = görünen içerik alanı). */
  annot?: { state: AnnotState; input: DrawInput | null } | null;
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
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const now = useNow();
  const [mode, setMode] = useState<ViewMode>("fit");
  const [full, setFull] = useState(false);
  const [compact, setCompact] = useState(true);
  /**
   * TEST-P7-2 (CI kök nedeni): sabit eşik (COMPACT_BELOW_PX) font metriğinden bağımsız değil — Linux'ta (DejaVu) kontrol
   * sırasında şerit 580 px'e sığmayıp iki satıra kırılıyordu. Şerit gerçekten kırılınca "Görünüm" etiketi görsel olarak
   * gizlenir (ikon + ok kalır; ad `aria-label`/`title`). Genişlik değişince yeniden ölçülür.
   */
  const [tight, setTight] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const [vid, setVid] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Tam ekranda düzen donar: genişleyen sahne düğmeyi menüden şeride taşıyıp odağı kaybettirmesin
    const ro = new ResizeObserver(([e]) => {
      if (!e || document.fullscreenElement === el) return;
      setCompact(e.contentRect.width < COMPACT_BELOW_PX);
      setTight(false); // yeni genişlikte yeniden ölç (aşağıdaki layout effect)
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Akış çözünürlüğü değişince (WebRTC uyarlaması) "%100" boyutu yeniden hesaplanır
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const on = () => setVid({ w: v.videoWidth, h: v.videoHeight });
    v.addEventListener("resize", on);
    v.addEventListener("loadedmetadata", on);
    return () => {
      v.removeEventListener("resize", on);
      v.removeEventListener("loadedmetadata", on);
    };
  }, []);
  const actualMode = mode === "actual";
  const size = actualMode ? actualViewSize(nativeSize, vid.w, vid.h) : null;
  const sw = size?.w;
  const sh = size?.h;
  // Boyut CSSOM ile verilir (CSP: style özniteliği nonce'suz kabul edilmez; element.style serbest)
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.style.width = sw ? `${sw}px` : "";
    v.style.height = sh ? `${sh}px` : "";
  }, [sw, sh]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current && box.current !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void box.current?.requestFullscreen().catch(() => undefined);
  };

  // Her çizimden sonra (boyamadan önce): şerit öğeleri tek satırda mı? `display:contents` sarmalayıcıların çocukları, mutlak
  // konumlu (sr-only) öğeler hariç. Kırılıyorsa etiketi daralt — yalnız false→true (döngü yok).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bilinçli: şerit içeriği (controlBar/monitors düğümleri) her çizimde değişebilir; `tight` korur, döngü yok
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el || tight) return;
    const items = [...el.children].flatMap((c) => (getComputedStyle(c).display === "contents" ? [...c.children] : [c]));
    const rects = items.filter((c) => getComputedStyle(c).position !== "absolute").map((c) => c.getBoundingClientRect());
    const first = rects[0];
    if (first && rects.some((r) => r.top >= first.bottom - 1)) setTight(true);
  });

  const live = state.phase === "live";
  const spin = <LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />;
  let overlay: ReactNode = null;
  if (state.reconnectSince !== null)
    overlay = (
      <Msg alert icon={<WifiOff aria-hidden className="size-8" />} title={t("cs.selfLost")}>
        {t("cs.selfLostBody")}
      </Msg>
    );
  else if (state.phase === "connecting") overlay = <Msg icon={spin} title={t("cs.connecting")} />;
  else if (state.phase === "waiting" && state.pending.length > 0) overlay = lobby;
  else if (state.phase === "waiting")
    overlay = (
      <Msg icon={<Hourglass aria-hidden className="size-8" />} title={t("cs.waitingTitle")}>
        <p>{t("cs.waitingBody")}</p>
        <p className="mt-2">
          {t("cs.verify")} <CodeDisplay code={verifyCode} size="sm" />
        </p>
        {sessionCode && (
          <p className="mt-1">
            {t("cs.sessionCode")} <CodeDisplay code={sessionCode} size="sm" />
          </p>
        )}
      </Msg>
    );
  else if (live && state.peerLostSince !== null)
    overlay = (
      <Msg alert icon={<WifiOff aria-hidden className="size-8" />} title={t("cs.peerLost")}>
        {t("cs.peerLostBody", { time: now === null ? "—" : formatRemaining(state.peerLostSince + PEER_WINDOW_MS - now) })}
        {control?.endedNote && (
          <p className="mt-2 font-medium" data-testid="stage-control-ended">
            {control.endedNote}
          </p>
        )}
      </Msg>
    );
  else if (live && state.share === "unknown")
    overlay = (
      <Msg icon={spin} title={t("cs.notShared")}>
        {t("cs.notSharedBody")}
      </Msg>
    );
  else if (live && state.share === "stopped")
    overlay = (
      <Msg icon={<ScreenShareOff aria-hidden className="size-8" />} title={t("cs.stopped")}>
        {t("cs.stoppedBody")}
      </Msg>
    );
  else if (live && control?.secureDesktop)
    overlay = (
      <Msg alert panel testId="stage-secure" icon={<ShieldAlert aria-hidden className="size-8" />} title={t("p7.secureTitle")}>
        {t("p7.secureBody")}
      </Msg>
    );

  const showing = live && state.share === "sharing" && state.peerLostSince === null;
  const actual = actualMode;
  const capturing = Boolean(control?.active && showing && !control.secureDesktop && state.reconnectSince === null);
  useRemoteInput({
    active: capturing,
    channel: control?.channel ?? null,
    target: scroll,
    video: ref,
    fullscreen: full,
    onKeyboardRelease: () => control?.onKeyboardRelease(),
  });
  const viewSeg = (
    <Segmented<ViewMode>
      label={t("cs.view")}
      value={mode}
      onChange={setMode}
      options={[
        { value: "fit", label: t("cs.fit"), icon: <Expand aria-hidden className="size-4" /> },
        { value: "actual", label: t("cs.actual"), icon: <ScanSearch aria-hidden className="size-4" /> },
      ]}
    />
  );
  const fullBtn = (
    <Button variant="secondary" onClick={toggleFull} aria-pressed={full} data-testid="stage-fullscreen">
      {full ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
      {full ? t("cs.exitFullscreen") : t("cs.fullscreen")}
    </Button>
  );
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
        // Araç şeridi görüntünün dışında (QA görsel bulgu: P5'te sağ üstte görüntünün ~60 px'ini kapatıyordu)
        <div
          ref={stripRef}
          className="relative z-20 flex flex-wrap items-center gap-2 border-b border-border bg-surface p-2"
          data-testid="stage-tools"
          data-compact={compact}
          data-tight={tight}
        >
          {/* Kontrol sırasında işaretleme zaten pasif: şeritte yer kaplamaz (TEST-P7-2) */}
          {showing && !actual && !capturing && tools}
          {controlBar}
          {!compact && monitors}
          {showing && !compact && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {viewSeg}
              {fullBtn}
            </div>
          )}
          {compact && (showing || monitors) && (
            <div className="ml-auto shrink-0">
              <Menu
                label={t("cs.viewMenu")}
                icon={<MonitorCog aria-hidden className="size-4" />}
                labelClassName={tight ? "sr-only" : undefined}
                title={tight ? t("cs.viewMenu") : undefined}
                testId="stage-view-menu"
                align="end"
                busy={
                  monitorBusy ? (
                    <>
                      <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                      <span className="sr-only">{t("cs.viewMenuBusy")}</span>
                    </>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-3 p-2">
                  {monitors}
                  {showing && viewSeg}
                  {showing && fullBtn}
                </div>
              </Menu>
            </div>
          )}
        </div>
      )}
      {control?.selfElevated && (
        <p
          role="status"
          data-testid="stage-self-elevated"
          className="flex items-center justify-center gap-2 bg-warning-surface px-3 py-2 text-sm font-medium text-warning"
        >
          <ShieldUser aria-hidden className="size-4 shrink-0" />
          {t("p7.selfElevated")}
        </p>
      )}
      {showing && control?.elevated && (
        <p
          role="status"
          data-testid="stage-elevated"
          className="flex items-center justify-center gap-2 bg-warning-surface px-3 py-2 text-sm font-medium text-warning"
        >
          <ShieldAlert aria-hidden className="size-4 shrink-0" />
          {t("p7.elevated")}
        </p>
      )}
      {/* Kontrol aktifken kırmızı çerçeve (control-frame, iki temada sabit); kalınlık hep 4 px → kayma yok */}
      <div
        data-testid="stage-view"
        className={`relative flex min-h-[50vh] flex-1 items-center justify-center border-4 p-4 ${capturing ? "border-control-frame" : "border-transparent"}`}
      >
        {/* %100: doğal boyut + kaydırma (klavyeyle odaklanıp ok tuşlarıyla kaydırılır); Sığdır: object-contain.
            Kontrol: aynı kap odaklanabilir "application" olur; fare/klavye uzak ekrana gider (lib/control). */}
        <div
          ref={scroll}
          data-testid="stage-scroll"
          tabIndex={capturing || (showing && actual) ? 0 : undefined}
          role={capturing ? "application" : showing && actual ? "region" : undefined}
          aria-label={capturing ? t("p7.region") : showing && actual ? t("cs.scroll") : undefined}
          className={`absolute inset-0 ${actual ? "overflow-auto" : "overflow-hidden"} ${capturing || actual ? "focus-visible:-outline-offset-2" : ""} ${capturing ? "cursor-default touch-none select-none" : ""}`}
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
          {showing && !actual && annot && (
            <AnnotLayer video={ref} state={annot.state} input={capturing ? null : annot.input} label={t("p5.a.layer")} />
          )}
        </div>
        {overlay && <div className="relative z-10 flex w-full items-center justify-center">{overlay}</div>}
      </div>
    </section>
  );
}
