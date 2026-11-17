"use client";

import { Headphones, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, PhoneOutgoing, Volume2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { VoiceView } from "@/lib/voice/console";
import { noticeText } from "@/lib/voice/ui";

const pillCls = "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap";
const iconBase =
  "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border bg-surface transition-transform duration-150 ease-out active:scale-[0.97]";
const iconCls = {
  secondary: `${iconBase} border-border text-fg hover:bg-surface-muted`,
  danger: `${iconBase} border-danger/40 text-danger hover:bg-danger-surface`,
};
const hintCls = "min-w-20 max-w-48 text-xs text-fg-muted";

export interface VoiceActions {
  onRequest: () => void;
  onJoin: () => void;
  onEnd: () => void;
  onMute: (on: boolean) => void;
}

/**
 * P28d konsol üst çubuğu sesli görüşme yuvası (mimari-p28d r2 §8; AC-373, 374, 378, 379). Görünüm kararı `consoleVoiceView`'dan;
 * bu bileşen yalnız çizer. 1280 px tek satır (TEST-P4-4): konuşurken "Sessize al" / "Görüşmeyi bitir" ikon-only (aria-label +
 * `title` ipucu), bildirim metni `BrowserControlHint` gibi daralır. Geri sayımda canlı bölge yok (her saniye okunmaz).
 */
export function VoiceControls({ view, unsupportedText, ...a }: { view: VoiceView; unsupportedText: string } & VoiceActions) {
  const hint = useId();
  if (view.kind === "hidden") return null;
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2" data-testid="voice-controls" data-view={view.kind}>
      <ViewBody view={view} hint={hint} unsupportedText={unsupportedText} {...a} />
    </div>
  );
}

function ViewBody({ view, hint, unsupportedText, ...a }: { view: VoiceView; hint: string; unsupportedText: string } & VoiceActions) {
  switch (view.kind) {
    case "hidden":
      return null;
    case "unsupported":
    case "unattended":
      return (
        <>
          <Button variant="secondary" disabled aria-describedby={hint} className="shrink-0" data-testid="voice-call">
            <Phone aria-hidden className="size-4" />
            {t("vc.call")}
          </Button>
          <p id={hint} className={hintCls} data-testid="voice-notice">
            {view.kind === "unsupported" ? unsupportedText : t("vc.unattended")}
          </p>
        </>
      );
    case "noPerm":
      return (
        <p className={`flex items-center gap-1.5 ${hintCls}`} data-testid="voice-no-perm">
          <Headphones aria-hidden className="size-4 shrink-0" />
          {t("vc.noPerm")}
        </p>
      );
    case "listening":
      return (
        <span className={`${pillCls} bg-primary-surface text-primary`} data-testid="voice-listening">
          <Headphones aria-hidden className="size-3.5" />
          {t("vc.listening")}
        </span>
      );
    case "idle":
    case "canJoin": {
      const join = view.kind === "canJoin";
      const blocked = view.kind === "idle" && view.blocked;
      return (
        <>
          <Button
            variant="secondary"
            loading={view.busy}
            disabled={blocked}
            aria-describedby={view.notice ? hint : undefined}
            onClick={join ? a.onJoin : a.onRequest}
            className="shrink-0"
            data-testid={join ? "voice-join" : "voice-call"}
          >
            {!view.busy && (join ? <PhoneIncoming aria-hidden className="size-4" /> : <Phone aria-hidden className="size-4" />)}
            {t(join ? "vc.join" : "vc.call")}
          </Button>
          {view.notice && (
            <p id={hint} className={hintCls} data-testid="voice-notice" data-kind={view.notice.kind}>
              {noticeText(view.notice.kind, unsupportedText)}
            </p>
          )}
        </>
      );
    }
    case "waiting":
      return (
        <span className={`${pillCls} bg-warning-surface text-warning tabular-nums`} data-testid="voice-waiting">
          <PhoneOutgoing aria-hidden className="size-3.5" />
          {t("vc.waiting", { left: formatRemaining(view.leftMs) })}
        </span>
      );
    case "otherPending":
      return (
        <p className={`flex items-center gap-1.5 ${hintCls}`} data-testid="voice-other-pending">
          <PhoneOutgoing aria-hidden className="size-4 shrink-0" />
          {t("vc.otherPending")}
        </p>
      );
    case "talking": {
      const muteLabel = t(view.muted ? "vc.unmuteMic" : "vc.mute");
      return (
        <>
          <span
            role="status"
            aria-live="polite"
            className={`${pillCls} ${view.muted ? "bg-surface-muted text-fg-muted" : "bg-success-surface text-success"}`}
            data-testid="voice-mic-state"
            data-muted={view.muted}
          >
            {view.muted ? <MicOff aria-hidden className="size-3.5" /> : <Mic aria-hidden className="size-3.5" />}
            {t(view.muted ? "vc.micMuted" : "vc.micOn")}
          </span>
          <button
            type="button"
            aria-label={muteLabel}
            title={muteLabel}
            onClick={() => a.onMute(!view.muted)}
            className={iconCls.secondary}
            data-testid="voice-mute"
          >
            {view.muted ? <Mic aria-hidden className="size-4" /> : <MicOff aria-hidden className="size-4" />}
          </button>
          <button
            type="button"
            aria-label={t("vc.end")}
            title={t("vc.end")}
            onClick={a.onEnd}
            className={iconCls.danger}
            data-testid="voice-end"
          >
            <PhoneOff aria-hidden className="size-4" />
          </button>
        </>
      );
    }
  }
}

/**
 * Uzak ses (her zaman monte; `<audio>` denetimsiz → görünmez). Yalnız `listen` (ben ∈ listeners, Y-PD-3) iken sessiz değil ve
 * çalar; aksi hâlde `muted` + duraklatılmış. Tarayıcı otomatik oynatmayı engellerse (`NotAllowedError`) "Sesi aç" yedeği —
 * izleyicide kullanıcı hareketi olmadığından asıl gerekli yer orası. Tüm `play()` retleri yakalanır (konsol uyarısı yok).
 */
export function VoiceAudio({ track, listen }: { track: MediaStreamTrack | null; listen: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const last = useRef<MediaStreamTrack | null>(null);
  const [blockedFor, setBlockedFor] = useState<MediaStreamTrack | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (last.current !== track) {
      last.current = track;
      el.srcObject = track ? new MediaStream([track]) : null;
    }
    el.muted = !listen;
    if (!track || !listen) return void el.pause();
    el.play().then(
      () => setBlockedFor(null),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === "NotAllowedError") setBlockedFor(track);
      },
    );
  }, [track, listen]);

  const blocked = listen && track !== null && blockedFor === track;
  const resume = () =>
    void ref.current?.play().then(
      () => setBlockedFor(null),
      () => undefined,
    );
  return (
    <>
      <audio ref={ref} data-testid="voice-audio" data-listen={listen} />
      {blocked && (
        <Button variant="secondary" onClick={resume} title={t("vc.playBlockedHint")} className="shrink-0" data-testid="voice-play">
          <Volume2 aria-hidden className="size-4" />
          {t("vc.playBlocked")}
        </Button>
      )}
    </>
  );
}
