"use client";

import type { JoinSessionResponse, PublicSessionStatusResponse } from "@remote/contracts/api/sessions";
import { Flag, MonitorX, ShieldAlert, Timer } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/avatar";
import { CodeDisplay } from "@/components/ui/code-display";
import { api, ApiError } from "@/lib/api";
import { agentOsOf, isScreenShareSupported, readSupportEnv } from "@/lib/device-support";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { GuestEndScreen, type GuestEnd } from "../guest-ui";
import { AgentDownload } from "./agent-download";
import { AgentSkeleton, useAgentOffer } from "./agent-offer";
import { JoinForm, type ResolveData } from "./join-form";

const POLL_MS = 2000;
const noop = () => () => undefined;
const END: Partial<Record<PublicSessionStatusResponse["status"], GuestEnd>> = {
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  ENDED: "ended",
};

/**
 * Karşılama: teknisyen + doğrulama kodu → dolandırıcılık uyarısı → ad + aydınlatma onayı → iki yol: Windows'ta Hızlı Destek
 * (önerilen) / tarayıcıdan yalnız görüntü; macOS ve Linux x86_64'te aynı düzen, indirme availability'ye bağlı (P28f AC-396,
 * AC-390; P28g AC-403); diğer cihazlarda yalnız tarayıcı (DESIGN §8, AC-27); 2 sn durum yoklaması (AC-8).
 */
export function GuestWelcome({
  data,
  abuseEmail,
  onJoined,
}: {
  data: ResolveData;
  abuseEmail: string | null;
  onJoined: (r: JoinSessionResponse & { customerName: string }) => void;
}) {
  const [end, setEnd] = useState<GuestEnd | null>(null);
  const now = useNow();
  const left = now === null ? null : Date.parse(data.expiresAt) - now;
  // AC-33: sunucuda bilinmez (null) → form; istemcide mobil/API yoksa form yerine "desteklenmiyor"
  const supported = useSyncExternalStore(
    noop,
    () => isScreenShareSupported(readSupportEnv()),
    () => null,
  );
  // AC-27 / P28f AC-396 / P28g AC-403: indirme Windows, macOS ve Linux x86_64 masaüstünde; sunucuda bilinmez → yalnız tarayıcı (hidrasyon sonrası)
  const deviceOs = useSyncExternalStore(
    noop,
    () => agentOsOf(readSupportEnv()),
    () => null,
  );
  const agent = useAgentOffer(deviceOs);

  useEffect(() => {
    if (end) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let wait = POLL_MS;
      try {
        const r = await api<PublicSessionStatusResponse>("GET", `/public/sessions/status?ref=${encodeURIComponent(data.sessionRef)}`);
        const next = END[r.status];
        if (next && !stopped) return setEnd(next);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && !stopped) return setEnd("notFound");
        if (e instanceof ApiError && e.retryAfter) wait = e.retryAfter * 1000;
        // Ağ hatası: sessizce yeniden dener (ekran bilgisi hâlâ geçerli)
      }
      if (!stopped) timer = setTimeout(poll, wait);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [data.sessionRef, end]);

  const shown = end ?? (left !== null && left <= 0 ? "expired" : null);
  if (shown) return <GuestEndScreen kind={shown} />;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold text-fg">{t("g.title")}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t("g.subtitle", { tenant: data.tenant.name })}</p>
      </div>

      <section
        aria-label={t("g.verify")}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={data.technician.name} size="lg" src={data.technician.avatarUrl} testId="guest-tech-avatar" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg" data-testid="guest-tech">
              {data.technician.name}
            </p>
            <p className="truncate text-sm text-fg-muted">{t("g.techRole", { tenant: data.tenant.name })}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1 sm:items-end sm:text-right">
          <p className="text-sm text-fg-muted">{t("g.verify")}</p>
          <CodeDisplay code={data.techVerifyCode} testId="guest-verify-code" />
          <p className="text-xs text-fg-muted">{t("g.verifyHint")}</p>
        </div>
      </section>

      <section
        data-testid="fraud-warning"
        className="flex gap-3 rounded-lg border border-warning/30 bg-warning-surface p-4 text-sm text-fg"
      >
        <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <div>
          <h2 className="font-semibold text-warning">{t("g.fraudTitle")}</h2>
          <p className="mt-1">{t("g.fraudBody")}</p>
          {abuseEmail && (
            <a href={`mailto:${abuseEmail}`} className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-medium text-warning underline">
              <Flag aria-hidden className="size-4" />
              {t("g.abuse")}
            </a>
          )}
        </div>
      </section>

      {supported === false ? (
        <>
          {agent.state !== "none" && (
            <section aria-labelledby="yol-t" className="flex flex-col gap-3">
              <h2 id="yol-t" className="text-lg font-semibold text-fg">
                {t("gj.howTitle")}
              </h2>
              {agent.state === "loading" ? (
                <AgentSkeleton />
              ) : (
                <AgentDownload
                  sessionRef={data.sessionRef}
                  verifyCode={data.techVerifyCode}
                  os={agent.os}
                  testBuild={agent.testBuild}
                  onEnd={setEnd}
                />
              )}
            </section>
          )}
          <section
            role="status"
            aria-labelledby="desteklenmiyor-t"
            data-testid="guest-unsupported"
            className="flex gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm"
          >
            <MonitorX aria-hidden className="mt-0.5 size-6 shrink-0 text-fg-muted" />
            <div>
              <h2 id="desteklenmiyor-t" className="font-semibold text-fg">
                {t("g.unsupportedTitle")}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">{t("g.unsupportedBody")}</p>
            </div>
          </section>
        </>
      ) : (
        <JoinForm data={data} agent={agent} onJoined={onJoined} onEnd={setEnd} />
      )}
      <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted" data-testid="guest-next">
        <Timer aria-hidden className="size-4" />
        <span className="tabular-nums">{t("g.left", { time: left === null ? "—" : formatRemaining(left) })}</span>
      </p>
    </>
  );
}
