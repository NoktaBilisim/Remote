"use client";

import type { ReactNode } from "react";

/** Segment filtre (DESIGN.md §6.1). aria-pressed düğme grubu; anında geçiş (animasyonsuz). İsteğe bağlı `icon` (aria-hidden lucide). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  size = "default",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number; icon?: ReactNode }[];
  onChange: (v: T) => void;
  /** Tüm grup geçici olarak kullanılamaz (ör. bekleyen istek); neden çağıranın görünür metninde yazılır. */
  disabled?: boolean;
  /**
   * `field`: form alanlarıyla aynı satırda dış yükseklik alanla eşit (`min-h-11`, 44 px) — iç boşluk yok, düğmeler
   * çerçeveyi örter (`-my-px`), dokunma hedefi yine 44 px. Varsayılan: iç boşluklu hap grubu (54 px).
   */
  size?: "default" | "field";
}) {
  const field = size === "field";
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex rounded-md border border-border bg-surface shadow-sm ${field ? "min-h-11" : "p-1"}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`inline-flex min-h-11 cursor-pointer items-center disabled:cursor-not-allowed disabled:opacity-60 gap-1.5 px-3 text-sm font-medium ${
              field ? "-my-px first:-ml-px first:rounded-l-md last:-mr-px last:rounded-r-md" : "rounded-sm"
            } ${active ? "bg-primary-surface text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && <span className="tabular-nums">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
