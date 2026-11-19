import { Hourglass, LoaderCircle, MonitorCog, ScreenShareOff, ShieldAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { CodeDisplay } from "@/components/ui/code-display";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TechState } from "@/lib/webrtc/tech-machine";

const PEER_WINDOW_MS = 120_000;

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

const spin = () => <LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />;

export interface OverlayInput {
  state: TechState;
  now: number | null;
  lobby: ReactNode;
  verifyCode: string;
  sessionCode: string | null;
  /** Kontrol müşteri kopması yüzünden kapandıysa "Bağlantı koptu" katmanında da yazılır. */
  endedNote: string | null | undefined;
  secureDesktop: boolean | undefined;
}

/** Sahne üst katman mesajı (öncelik sırasıyla ilk eşleşen); yoksa null. */
export function stageOverlay(o: OverlayInput): ReactNode {
  const { state } = o;
  if (state.reconnectSince !== null)
    return (
      <Msg alert icon={<WifiOff aria-hidden className="size-8" />} title={t("cs.selfLost")}>
        {t("cs.selfLostBody")}
      </Msg>
    );
  if (state.phase === "connecting") return <Msg icon={spin()} title={t("cs.connecting")} />;
  if (state.phase === "waiting" && state.pending.length > 0) return o.lobby;
  if (state.phase === "waiting") return waitingMsg(o);
  return state.phase === "live" ? liveOverlay(o) : null;
}

function waitingMsg({ state, verifyCode, sessionCode }: OverlayInput) {
  // P27 (mimari-p27 §4.6, K12): gözetimsiz odada müşteri yok — ACTIVE öncesi "Cihaz bağlanıyor…", kod/müşteri metni yok.
  // P28u r3 (r3.6): onay beklemesi yok — cihaz kullanıcısına sorulmadan açılır.
  if (state.unattended)
    return (
      <Msg testId="stage-unattended-wait" icon={<MonitorCog aria-hidden className="size-8" />} title={t("un.c.connecting")}>
        {t("un.c.connectingBody")}
      </Msg>
    );
  return (
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
}

function liveOverlay({ state, now, endedNote, secureDesktop }: OverlayInput): ReactNode {
  if (state.peerLostSince !== null)
    return (
      <Msg alert icon={<WifiOff aria-hidden className="size-8" />} title={t("cs.peerLost")}>
        {t("cs.peerLostBody", { time: now === null ? "—" : formatRemaining(state.peerLostSince + PEER_WINDOW_MS - now) })}
        {endedNote && (
          <p className="mt-2 font-medium" data-testid="stage-control-ended">
            {endedNote}
          </p>
        )}
      </Msg>
    );
  if (state.share === "unknown")
    return (
      <Msg icon={spin()} title={t("cs.notShared")}>
        {t("cs.notSharedBody")}
      </Msg>
    );
  if (state.share === "stopped") return stoppedMsg(state.shareFail);
  if (secureDesktop)
    return (
      <Msg alert panel testId="stage-secure" icon={<ShieldAlert aria-hidden className="size-8" />} title={t("p7.secureTitle")}>
        {t("p7.secureBody")}
      </Msg>
    );
  return null;
}

function stoppedMsg(shareFail: string | null) {
  return shareFail ? (
    // P15 (AC-234): istemci neden kodu bildirdiyse Türkçe etiket (bilinmeyen kod ham) + yöntem
    <Msg alert testId="stage-share-failed" icon={<ScreenShareOff aria-hidden className="size-8" />} title={t("cs.shareFailed")}>
      <p data-testid="stage-share-reason">{t("cs.shareFailReason", { reason: shareFail })}</p>
      <p className="mt-1">{t("cs.stoppedBody")}</p>
    </Msg>
  ) : (
    <Msg icon={<ScreenShareOff aria-hidden className="size-8" />} title={t("cs.stopped")}>
      {t("cs.stoppedBody")}
    </Msg>
  );
}
