"use client";

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
        <span
          aria-hidden
          className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors duration-150 ease-out ${
            checked ? "border-primary bg-primary" : "border-border bg-surface-muted"
          }`}
        >
          <span
            className={`size-5 rounded-full bg-surface shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none ${
              checked ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </span>
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
