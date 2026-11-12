"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useRequestNotifier } from "@/components/request-notifier";
import { t } from "@/lib/i18n";

/** Yeni talep sesi aç/kapa (AC-149) — tercih tarayıcıda saklanır; ses engellense de görsel bildirim sürer. */
export function SoundToggle() {
  const { sound, setSound, enabled } = useRequestNotifier();
  if (!enabled) return null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={sound}
      onClick={() => setSound(!sound)}
      data-testid="sound-toggle"
      className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-surface-muted"
    >
      {sound ? <Volume2 aria-hidden className="size-4" /> : <VolumeX aria-hidden className="size-4" />}
      {t("rq.sound")}
      <span className="text-fg-muted">{sound ? t("rq.on") : t("rq.off")}</span>
    </button>
  );
}
