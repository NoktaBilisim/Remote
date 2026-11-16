"use client";

import type { ServerOutbound, TechInbound } from "@remote/contracts/ws";
import { REC_DEVICE_OUTDATED_MESSAGE, REC_STATE_REASON_LABELS, REC_UNSUPPORTED_MESSAGE } from "@remote/contracts/api/recording";
import { CircleDot } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { t } from "@/lib/i18n";
import { useConsoleRec } from "@/lib/rec/use-console-rec";

const TONE = { quota: "warning", error: "danger" } as const;

/**
 * P28e konsol kayıt göstergesi + kaydedici bağlantısı (mimari-p28e §9; AC-382, 384, 448). Gösterge TÜM teknisyenlerde
 * (kaydedici olmasa da) sunucu `rec.state`'inden çizilir; yanıp sönmez (reduced-motion gereksiz). Teknisyen düğmesi yok.
 * Durunca neden `Alert` (kota → warning, hata → danger, diğer → info). Konsol kaydedemiyorsa (Safari) `unsupported` uyarısı;
 * gözetimsizde cihaz `record1` bildirmediyse "Cihaz istemcisi eski".
 */
export function RecIndicator({
  subscribe,
  send,
  stream,
  ended,
}: {
  subscribe: (fn: (m: ServerOutbound) => void) => () => void;
  send: (m: TechInbound) => void;
  stream: MediaStream | null;
  ended: boolean;
}) {
  const v = useConsoleRec({ subscribe, send, stream, ended });
  const stopped = !v.on && v.reason && v.reason !== "session_end" && v.reason !== "unavailable";
  if (!v.on && !stopped && !v.unsupported && !v.deviceOutdated) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="rec-console" data-on={v.on ? "true" : "false"}>
      {v.on && (
        <p
          role="status"
          data-testid="rec-console-on"
          data-basis={v.basis ?? undefined}
          className="inline-flex items-center gap-2 self-start rounded-full bg-danger-surface px-3 py-1 text-sm font-semibold text-control-frame"
        >
          <CircleDot aria-hidden className="size-4 shrink-0" />
          {t("rec.c.on")}
          {v.basis && (
            <span className="font-normal text-fg-muted">· {t(v.basis === "tenant_policy" ? "rec.c.policy" : "rec.c.consent")}</span>
          )}
        </p>
      )}
      {stopped && v.reason && (
        <Alert tone={TONE[v.reason as keyof typeof TONE] ?? "info"} testId="rec-console-stopped">
          {REC_STATE_REASON_LABELS[v.reason]}
        </Alert>
      )}
      {v.unsupported && (
        <Alert tone="warning" testId="rec-console-unsupported">
          {REC_UNSUPPORTED_MESSAGE}
        </Alert>
      )}
      {v.deviceOutdated && (
        <Alert tone="warning" testId="rec-console-outdated">
          {REC_DEVICE_OUTDATED_MESSAGE}
        </Alert>
      )}
    </div>
  );
}
