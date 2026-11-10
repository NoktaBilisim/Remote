"use client";

import type { PublicSessionStatusResponse, ResolveSessionResponse } from "@remote/contracts/api/sessions";
import { Info, ShieldAlert, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { CodeDisplay } from "@/components/ui/code-display";
import { api, ApiError } from "@/lib/api";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { GuestEndScreen, type GuestEnd } from "../guest-ui";

const POLL_MS = 2000;
const END: Partial<Record<PublicSessionStatusResponse["status"], GuestEnd>> = {
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  ENDED: "ended",
};

/** Karşılama (P2): teknisyen + doğrulama kodu → dolandırıcılık uyarısı → yer tutucu; 2 sn durum yoklaması (AC-8). */
export function GuestWelcome({ data }: { data: ResolveSessionResponse }) {
  const [end, setEnd] = useState<GuestEnd | null>(null);
  const now = useNow();
  const left = now === null ? null : Date.parse(data.expiresAt) - now;

  useEffect(() => {
    if (end) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let wait = POLL_MS;
      try {
        const r = await api<PublicSessionStatusResponse>(
          "GET",
          `/public/sessions/status?ref=${encodeURIComponent(data.sessionRef)}`,
        );
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
          <Avatar name={data.technician.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg" data-testid="guest-tech">{data.technician.name}</p>
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
        </div>
      </section>

      <section className="flex gap-3 rounded-lg border border-border bg-surface p-4 text-sm" data-testid="guest-next">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-semibold text-fg">{t("g.nextTitle")}</h2>
          <p className="mt-1 text-fg-muted">{t("g.nextBody")}</p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-fg-muted">
            <Timer aria-hidden className="size-4" />
            <span className="tabular-nums">{t("g.left", { time: left === null ? "—" : formatRemaining(left) })}</span>
          </p>
        </div>
      </section>
    </>
  );
}
