"use client";

import { formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";

/** ACTIVE oturumun canlı süresi (sunucu durationSec=null döner; mimari-api P8 §1). Hidrasyona kadar "sürüyor". */
export function LiveDuration({ startedAt }: { startedAt: string }) {
  const now = useNow(1000);
  if (now === null) return <>{t("h.live")}</>;
  return (
    <span data-testid="live-duration">
      {formatDuration((now - Date.parse(startedAt)) / 1000)} · {t("h.live")}
    </span>
  );
}
