"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Açılır menü (DESIGN §6 `ui/menu.tsx`): native `<details>` — Enter/Space açar, Esc ve dış tıklama kapatır, odak
 * tetikleyiciye döner. Anında açılır (sık kullanılan menü, animasyonsuz — DESIGN §3). Panel tetikleyicinin altında,
 * `align="end"` iken sağa hizalı (dar ekranda taşmasın). Öğe seçince kapatmak için `closeMenu(e.currentTarget)`.
 */
/** Öğenin içinde bulunduğu menüyü kapatır ve odağı tetikleyiciye döndürür. */
export function closeMenu(from: Element | null) {
  const d = from?.closest("details");
  if (!d) return;
  d.open = false;
  d.querySelector("summary")?.focus();
}

export function Menu({
  label,
  icon,
  testId,
  align = "start",
  busy,
  panelLabel,
  children,
}: {
  label: string;
  icon: ReactNode;
  testId?: string;
  align?: "start" | "end";
  /** Tetikleyicide görünür ek gösterge (ör. bekleyen istek); ekran okuyucu metni ayrıca verilmelidir. */
  busy?: ReactNode;
  /** Panel `role=group` etiketi; verilmezse `label`. */
  panelLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const out = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, []);
  return (
    <details ref={ref} className="relative" data-testid={testId} onKeyDown={(e) => e.key === "Escape" && closeMenu(e.currentTarget)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium whitespace-nowrap text-fg hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        {icon}
        {label}
        {busy}
        <ChevronDown aria-hidden className="size-4" />
      </summary>
      <div
        role="group"
        aria-label={panelLabel ?? label}
        className={`absolute top-full z-30 mt-1 min-w-64 rounded-md border border-border bg-surface p-1 shadow-lg ${align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left"}`}
      >
        {children}
      </div>
    </details>
  );
}
