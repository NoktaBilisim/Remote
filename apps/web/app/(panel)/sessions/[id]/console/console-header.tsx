import type { SessionView } from "@remote/contracts/api/sessions";
import { ArrowLeft, CircleX, MonitorCog, MousePointer2, Power } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TechState } from "@/lib/webrtc/tech-machine";

const pill = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

function statusOf(state: TechState): { cls: string; label: string } {
  if (state.phase === "ended") return { cls: "bg-surface-muted text-fg-muted", label: t("c.st.ended") };
  if (state.reconnectSince !== null || state.peerLostSince !== null) return { cls: "bg-danger-surface text-danger", label: t("c.st.lost") };
  if (state.phase === "live") return { cls: "bg-success-surface text-success", label: t("c.st.live") };
  if (state.unattended) return { cls: "bg-primary-surface text-primary", label: t("un.c.connecting") };
  return state.pending.length
    ? { cls: "bg-warning-surface text-warning", label: t("c.st.lobby") }
    : { cls: "bg-primary-surface text-primary", label: t("c.st.waiting") };
}

/** Konsol üst barı: geri, müşteri, durum, kalan süre, doğrulama kodu (gözetimsizde yok), (tarayıcı modunda pasif kontrol), bitir/iptal. */
export function ConsoleHeader({
  session,
  state,
  name,
  now,
  controlHint,
  onConfirm,
  owner = true,
  voice,
}: {
  /** P28d (§8): sesli görüşme yuvası (`VoiceControls` + `VoiceAudio`); ana satırın altında ayrı satır (sağa yaslı). */
  voice?: ReactNode;
  /** P28c: oturum sahibi değilse "Oturumu bitir" yok (üye teknisyenler panelinden ayrılır). */
  owner?: boolean;
  session: SessionView;
  state: TechState;
  name: string;
  now: number | null;
  controlHint: string;
  onConfirm: () => void;
}) {
  const live = state.phase === "live";
  const status = statusOf(state);
  const until = live ? state.maxEndsAt : session.expiresAt;
  const left = until && now !== null ? formatRemaining(Date.parse(until) - now) : "—";
  // K12: gözetimsiz oturumda kod geçerliliği ve doğrulama kodu anlamsız (müşteri yok); canlıda en uzun süre kalır.
  // P28c (D-PC-5): sahip olmayan üyeye doğrulama kodu boş gelir → gösterilmez
  const codes = !state.unattended && session.techVerifyCode !== "";
  return (
    <header className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 xl:flex-nowrap">
        <Link
          href="/sessions"
          aria-label={t("c.back")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={state.unattended?.deviceName ?? name} />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-fg" data-testid="console-guest">
              {state.unattended?.deviceName ?? name}
            </h1>
            {state.unattended ? (
              <p className="flex items-center gap-1 text-xs font-medium text-primary" data-testid="console-unattended">
                <MonitorCog aria-hidden className="size-3.5" />
                {t("un.c.badge")}
              </p>
            ) : (
              <p className="text-xs text-fg-muted">{t(state.guest?.kind === "AGENT" ? "cl.kindAgent" : "c.kindBrowser")}</p>
            )}
          </div>
        </div>
        <span role="status" data-testid="console-status" className={`${pill} shrink-0 ${status.cls}`}>
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {status.label}
        </span>
        {state.phase !== "ended" && (live || codes) && (
          <div className="shrink-0 text-xs text-fg-muted">
            <span className="block">{live ? t("c.maxLeft") : t("c.codeLeft")}</span>
            <b className="text-sm tabular-nums text-fg" data-testid="console-left">
              {left}
            </b>
          </div>
        )}
        {codes && (
          <div className="shrink-0 text-xs text-fg-muted">
            <span className="block">{t("cs.verify")}</span>
            <CodeDisplay code={session.techVerifyCode} size="sm" testId="console-verify-code" />
          </div>
        )}
        <span className="flex-1" />
        {live && state.guest?.kind === "BROWSER" && <BrowserControlHint id={controlHint} />}
        {owner && <HeaderActions phase={state.phase} onConfirm={onConfirm} />}
      </div>
      {/* P28d düzeltme (test-raporu Y-1, O-1): ses yuvası kendi satırında — 1280 px'te ana satır (TEST-P4-4) ses yokkenki
          gibi kalır, 375 px'te bildirim sarılır. Görünür öğe yokken (yalnız <audio>) satır gizli, boş aralık bırakmaz. */}
      {voice && (
        <div className="flex min-w-0 items-center justify-end gap-2 [&:not(:has(button,p,span))]:hidden" data-testid="console-voice-row">
          {voice}
        </div>
      )}
    </header>
  );
}

/**
 * AC-34: tarayıcı modunda kontrol yok — buton pasif, nedeni yanında (AGENT'ta etkin akış: ControlButton, P7).
 * TEST-P4-4: dar masaüstünde (1280 px) açıklama satır kırarak daralır; "Oturumu bitir" aynı satırda kalır.
 */
function BrowserControlHint({ id }: { id: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button variant="secondary" disabled className="shrink-0" aria-describedby={id} data-testid="console-control">
        <MousePointer2 aria-hidden className="size-4" />
        {t("c.control")}
      </Button>
      <p id={id} className="min-w-20 max-w-48 text-xs text-fg-muted" data-testid="console-control-hint">
        {t("c.controlBrowser")}
      </p>
    </div>
  );
}

function HeaderActions({ phase, onConfirm }: { phase: TechState["phase"]; onConfirm: () => void }) {
  return (
    <>
      {phase === "live" && (
        <Button variant="danger" onClick={onConfirm} data-testid="console-end" className="shrink-0">
          <Power aria-hidden className="size-4" />
          {t("c.end")}
        </Button>
      )}
      {phase === "waiting" && (
        <Button variant="danger-ghost" onClick={onConfirm} data-testid="console-cancel" className="shrink-0">
          <CircleX aria-hidden className="size-4" />
          {t("c.cancel")}
        </Button>
      )}
    </>
  );
}
