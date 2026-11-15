import { CircleStop, LoaderCircle, Power, ScreenShare, ScreenShareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

type StripState = "idle" | "sharing" | "stopped" | "reconnecting";

/** Müşteri üst şeridi (DESIGN.md §6.1): paylaşılıyor / durdu / koptu + eylemler. Yapışkan, her genişlikte görünür. */
export function ShareStrip({
  state,
  techName,
  busy,
  onStart,
  onStop,
  onEnd,
}: {
  state: StripState;
  techName: string;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onEnd: () => void;
}) {
  const warn = state !== "sharing";
  return (
    <div
      data-testid="share-strip"
      data-state={state}
      role={state === "reconnecting" ? "alert" : "status"}
      className={`sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm ${
        warn ? "border-warning/30 bg-warning-surface text-fg" : "border-success/30 bg-success-surface text-fg"
      }`}
    >
      <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
        {state === "sharing" && (
          <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
        )}
        {state === "reconnecting" && (
          <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-warning motion-reduce:animate-none" />
        )}
        {(state === "stopped" || state === "idle") && <ScreenShareOff aria-hidden className="size-4 shrink-0 text-warning" />}
        {t(`gs.strip.${state}`)}
      </span>
      {state === "sharing" && <span className="text-fg-muted">{t("gs.strip.viewer", { name: techName })}</span>}
      {state === "reconnecting" && <span className="text-fg-muted">{t("gs.strip.keepOpen")}</span>}
      <span className="ml-auto flex flex-wrap gap-2">
        {state === "sharing" && (
          <Button variant="secondary" onClick={onStop} data-testid="share-stop">
            <CircleStop aria-hidden className="size-4" />
            {t("gs.stop")}
          </Button>
        )}
        {(state === "idle" || state === "stopped") && (
          <Button onClick={onStart} loading={busy} data-testid="share-start">
            {!busy && <ScreenShare aria-hidden className="size-4" />}
            {state === "idle" ? t("gs.start") : t("gs.restart")}
          </Button>
        )}
        {state !== "reconnecting" && (
          <Button variant="danger-ghost" onClick={onEnd} data-testid="guest-end">
            <Power aria-hidden className="size-4" />
            {t("gs.end")}
          </Button>
        )}
      </span>
    </div>
  );
}
