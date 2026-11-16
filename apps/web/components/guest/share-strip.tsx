import { REC_GUEST_STOPPED_MESSAGE, REC_REVOKE_PAUSED_MESSAGE, REC_STATE_REASON_LABELS } from "@remote/contracts/api/recording";
import { CircleDot, CircleStop, Info, LoaderCircle, Power, ScreenShare, ScreenShareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

type StripState = "idle" | "sharing" | "stopped" | "reconnecting";

/** P28e (§9): kayıt göstergesi girdisi (`useGuestRec`); yoksa şerit kayıtsız çizilir. */
export interface StripRec {
  on: boolean;
  reason: keyof typeof REC_STATE_REASON_LABELS | null;
  revoking: boolean;
  paused: boolean;
  revoke: () => void;
}

/**
 * P28e (AC-382, S-P28e-2): "Kayıt yapılıyor" (kapatılamaz, `role=status`) + onaysız **Kaydı durdur**; durunca neden satırı.
 * `revoked` → "Kayıt durduruldu; o ana kadarki kısım saklanır"; 2 sn'de `off` gelmezse "Kayıt durdurulamadı, paylaşım duraklatıldı".
 */
function RecLine({ rec }: { rec: StripRec }) {
  if (rec.on)
    return (
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2" data-testid="rec-guest">
        <span role="status" className="inline-flex items-center gap-2 font-semibold text-control-frame" data-testid="rec-guest-on">
          <CircleDot aria-hidden className="size-4 shrink-0" />
          {t("rec.guest.on")}
        </span>
        {rec.paused && (
          <span role="alert" className="text-danger" data-testid="rec-guest-paused">
            {REC_REVOKE_PAUSED_MESSAGE}
          </span>
        )}
        <Button
          variant="danger-ghost"
          onClick={rec.revoke}
          loading={rec.revoking}
          aria-describedby="rec-stop-hint"
          className="ml-auto"
          data-testid="rec-guest-stop"
        >
          {!rec.revoking && <CircleStop aria-hidden className="size-4" />}
          {t("rec.guest.stop")}
        </Button>
        <span id="rec-stop-hint" className="sr-only">
          {t("rec.guest.stopHint")}
        </span>
      </div>
    );
  if (!rec.reason || rec.reason === "unavailable") return null;
  return (
    <p className="inline-flex w-full items-center gap-2 text-fg-muted" role="status" data-testid="rec-guest-off" data-reason={rec.reason}>
      <Info aria-hidden className="size-4 shrink-0" />
      {rec.reason === "revoked" ? REC_GUEST_STOPPED_MESSAGE : REC_STATE_REASON_LABELS[rec.reason]}
    </p>
  );
}

/** Müşteri üst şeridi (DESIGN.md §6.1): paylaşılıyor / durdu / koptu + eylemler. Yapışkan, her genişlikte görünür. */
export function ShareStrip({
  state,
  techName,
  busy,
  onStart,
  onStop,
  onEnd,
  rec,
}: {
  state: StripState;
  techName: string;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onEnd: () => void;
  rec?: StripRec;
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
      {rec && <RecLine rec={rec} />}
    </div>
  );
}
