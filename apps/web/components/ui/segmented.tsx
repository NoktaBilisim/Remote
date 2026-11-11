"use client";

import type { ReactNode } from "react";

/** Segment filtre (DESIGN.md §6.1). aria-pressed düğme grubu; anında geçiş (animasyonsuz). İsteğe bağlı `icon` (aria-hidden lucide). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-border bg-surface p-1 shadow-sm">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-sm font-medium ${
              active ? "bg-primary-surface text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
            }`}
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
