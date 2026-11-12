"use client";

import { Lock } from "lucide-react";
import { useId } from "react";

/**
 * Aç/kapa anahtarı (DESIGN.md §6.1 `ui/switch.tsx`; ilk kullanım P8b-1 bildirim kanalları). `role="switch"` +
 * `aria-checked`, etiket görünür ve tıklanabilir, min 44 px dokunma hedefi; durum yalnız renkle değil metinle de
 * ("Açık"/"Kapalı"). Hareket yalnız transform (topuz), reduced-motion'da anında. `description` aria-describedby.
 */
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  description,
  onText,
  offText,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  description?: string;
  onText: string;
  offText: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className="group inline-flex min-h-11 shrink-0 cursor-pointer items-center disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Track checked={checked} />
      </button>
      <div className="flex min-h-11 min-w-0 flex-col justify-center">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-fg">
          <span id={`${id}-l`}>{label}</span> <span className="font-normal text-fg-muted">· {checked ? onText : offText}</span>
        </label>
        {description && (
          <p id={`${id}-d`} className="text-xs text-fg-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** Görsel ray + topuz (ortak). `mixed`: topuz ortada, ray `fg-muted` (kısmi grup). Yalnız transform animasyonlu. */
function Track({ checked }: { checked: boolean | "mixed" }) {
  const rail = checked === true ? "border-primary bg-primary" : checked === "mixed" ? "border-fg-muted bg-fg-muted" : "border-border bg-surface-muted";
  const knob = checked === true ? "translate-x-5" : checked === "mixed" ? "translate-x-2.5" : "translate-x-0.5";
  return (
    <span aria-hidden className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors duration-150 ease-out ${rail}`}>
      <span className={`size-5 rounded-full bg-surface shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none ${knob}`} />
    </span>
  );
}

/**
 * P9 kompakt anahtar (yetki matrisi): görünür etiket hücre/sütun başlığındadır, ad `aria-label` ile verilir.
 * `checked="mixed"` → `aria-checked="mixed"` (grup "Tümünü aç/kapat" kısmi). `locked`: sahip olunmayan yetki —
 * `aria-disabled` (odaklanabilir kalır, ekran okuyucu nedeni `aria-describedby` ile okur), yanında `Lock` ikonu;
 * tıklama yok sayılır. `disabled`: geçici pasif (kayıt sürerken). Dokunma hedefi 44×44 px.
 */
export function ToggleSwitch({
  label,
  checked,
  onChange,
  disabled = false,
  locked = false,
  lockedReasonId,
  testId,
}: {
  label: string;
  checked: boolean | "mixed";
  onChange: () => void;
  disabled?: boolean;
  locked?: boolean;
  /** Kilit açıklamasının (görünür veya sr-only metin) id'si. */
  lockedReasonId?: string;
  testId?: string;
}) {
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-disabled={locked || undefined}
        aria-describedby={locked ? lockedReasonId : undefined}
        disabled={disabled}
        data-locked={locked || undefined}
        data-testid={testId}
        onClick={() => {
          if (!locked) onChange();
        }}
        className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-60 ${
          locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        <Track checked={checked} />
      </button>
      {locked && <Lock aria-hidden className="-ml-1 size-3.5 text-fg-muted" />}
    </span>
  );
}
