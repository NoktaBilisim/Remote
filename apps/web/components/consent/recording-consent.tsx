"use client";

import { REC_CONSENT_LINE } from "@remote/contracts/ws-rec";
import { Video } from "lucide-react";
import { useId } from "react";
import { recordingOffered } from "@/lib/rec/consent-choice";
import { t } from "@/lib/i18n";

/**
 * P28e (mimari-p28e §9, AC-381, AC-384): onay ekranında ayrı, VARSAYILAN İŞARETSİZ kayıt rızası kutusu. Tek bileşen: join
 * formu (kod/bağlantı) ve web talep formu. `consentText.recording` yoksa / `offered` değilse / SHA derlemedeki cümleye
 * uymuyorsa hiç çizilmez. Aydınlatma onayından bağımsızdır; seçim yalnız bellekte (çağıran `setRecConsent` ile yazar).
 */
export function RecordingConsent({
  consentText,
  checked,
  disabled,
  onChange,
}: {
  consentText: unknown;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const hint = useId();
  if (!recordingOffered(consentText)) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-canvas p-3" data-testid="rec-consent-box">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hint}
          data-testid="rec-consent"
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
        />
        <span className="inline-flex items-start gap-2">
          <Video aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          {REC_CONSENT_LINE}
        </span>
      </label>
      <p id={hint} className="text-xs text-fg-muted">
        {t("rec.consent.hint")}
      </p>
    </div>
  );
}
