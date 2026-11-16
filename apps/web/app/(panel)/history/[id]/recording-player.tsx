"use client";

import type { RecordingView, RecordingViewResponse } from "@remote/contracts/api/recording";
import { LoaderCircle, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { gapsOf, RecPlayer, segmentsOf, type PlayerStatus } from "@/lib/rec/player";

const STEP = 5;
const clock = (sec: number) => formatDuration(Math.max(0, Math.floor(sec)));

/** Zaman çizgisi (görsel, `aria-hidden`): kayıtlı aralıklar dolu, boşluklar taralı (SVG desen; satır içi stil yok — CSP). */
function Timeline({ v, total, at }: { v: RecordingView; total: number; at: number }) {
  const pid = useId().replace(/:/g, "");
  const segs = segmentsOf(v.series);
  const gaps = gapsOf(segs, total);
  const x = (s: number) => `${total > 0 ? (s / total) * 100 : 0}%`;
  const w = (a: number, b: number) => `${total > 0 ? ((b - a) / total) * 100 : 0}%`;
  return (
    <svg aria-hidden className="h-3 w-full overflow-hidden rounded-sm text-fg-muted" data-testid="rec-timeline" data-gaps={gaps.length}>
      <defs>
        <pattern id={pid} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" />
        </pattern>
      </defs>
      {segs.map((g) => (
        <rect key={g.s} x={x(g.start)} width={w(g.start, g.end)} y="0" height="100%" className="fill-primary-surface" />
      ))}
      {gaps.map((g) => (
        <rect key={g.start} x={x(g.start)} width={w(g.start, g.end)} y="0" height="100%" fill={`url(#${pid})`} data-testid="rec-gap" />
      ))}
      <rect x="0" width={x(at)} y="40%" height="20%" className="fill-primary" />
    </svg>
  );
}

const STATUS_TEXT: Partial<Record<PlayerStatus, () => string>> = {
  loading: () => t("hr.p.loading"),
  throttled: () => t("hr.p.throttled"),
};

/**
 * P28e MSE oynatıcı (mimari-p28e §7, §9; AC-385, S-P28e-3/11). Yerel denetimler (indirme menüsü olan `controls` YOK),
 * `controlsList="nodownload"`, `disablePictureInPicture`, sağ tık kapalı. Klavye: Boşluk oynat/duraklat, ←/→ 5 sn.
 * 429 → "yükleniyor"; izleme belirteci düşerse "Devam et" (yeni POST /view yalnız tıklamayla). Kapanınca `revokeObjectURL`.
 */
export function RecordingPlayer({
  v,
  view,
  durationMs,
  onRenew,
  onClose,
}: {
  v: RecordingView;
  view: RecordingViewResponse;
  durationMs: number;
  onRenew: () => Promise<string | null>;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<RecPlayer | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const total = durationMs / 1000;
  const keysId = useId();

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const p = new RecPlayer({ rid: v.id, token: view.token, series: v.series, durationMs, video: el, onStatus: setStatus });
    player.current = p;
    const onTime = () => setAt(el.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      p.destroy();
      player.current = null;
    };
    // Belirteç yenilemesi oynatıcıyı yeniden kurmaz (`resume`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.id, v.series, durationMs]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };
  const seek = (sec: number) => {
    const el = video.current;
    if (el) el.currentTime = Math.min(Math.max(0, sec), Math.max(0, total - 0.1));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return; // kaydırıcı kendi okunu kullanır
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      seek(at + (e.key === "ArrowLeft" ? -STEP : STEP));
    }
  };
  const renew = async () => {
    const tk = await onRenew();
    if (tk) player.current?.resume(tk);
  };

  const note = STATUS_TEXT[status]?.();
  return (
    <section
      aria-label={t("hr.p.label")}
      aria-describedby={keysId}
      tabIndex={0}
      onKeyDown={onKey}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 outline-ring focus-visible:outline-2"
      data-testid="rec-player"
      data-status={status}
    >
      <div className="relative overflow-hidden rounded-md bg-stage">
        <video
          ref={video}
          className="aspect-video w-full object-contain"
          playsInline
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          onClick={toggle}
          data-testid="rec-video"
        />
        {note && (
          <p
            role="status"
            className="absolute inset-x-0 bottom-0 inline-flex items-center gap-2 bg-stage px-3 py-1 text-xs text-on-stage"
            data-testid="rec-player-note"
          >
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            {note}
          </p>
        )}
      </div>
      {status === "expired" && (
        <Alert tone="info" testId="rec-player-expired">
          <span className="flex flex-wrap items-center gap-2">
            {t("hr.p.expired")}
            <Button variant="secondary" onClick={() => void renew()} data-testid="rec-player-resume">
              <RotateCw aria-hidden className="size-4" />
              {t("hr.p.resume")}
            </Button>
          </span>
        </Alert>
      )}
      {status === "error" && (
        <Alert tone="danger" testId="rec-player-error">
          {t("hr.p.error")}
        </Alert>
      )}
      <Timeline v={v} total={total} at={at} />
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(total))}
        step={1}
        value={Math.floor(at)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label={t("hr.p.seek")}
        aria-valuetext={`${clock(at)} / ${clock(total)}`}
        className="h-11 w-full cursor-pointer accent-primary"
        data-testid="rec-seek"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => seek(at - STEP)} aria-label={t("hr.p.back")} className="px-3">
          <RotateCcw aria-hidden className="size-4" />
        </Button>
        <Button onClick={toggle} data-testid="rec-play" aria-label={playing ? t("hr.p.pause") : t("hr.p.play")} className="px-3">
          {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
        </Button>
        <Button variant="secondary" onClick={() => seek(at + STEP)} aria-label={t("hr.p.fwd")} className="px-3">
          <RotateCw aria-hidden className="size-4" />
        </Button>
        <span className="text-sm tabular-nums text-fg" data-testid="rec-clock">
          {clock(at)} / {clock(total)}
        </span>
        <Button variant="ghost" onClick={onClose} className="ml-auto" data-testid="rec-close">
          <X aria-hidden className="size-4" />
          {t("hr.p.close")}
        </Button>
      </div>
      <p id={keysId} className="text-xs text-fg-muted">
        {t("hr.p.gaps")} {t("hr.p.keys")}
      </p>
    </section>
  );
}
