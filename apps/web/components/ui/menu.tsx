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
  ariaLabel,
  labelClassName,
  title,
  onOpen,
  variant = "default",
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
  /** P9: tetikleyicinin erişilebilir adı görünür etiketten farklıysa (ör. "Etkin firma: X. Firma değiştir"). */
  ariaLabel?: string;
  /** P9: görünür etiketin sınıfı (ör. dar ekranda `sr-only`, uzun adda `truncate`). */
  labelClassName?: string;
  /** P9: tetikleyicinin ipucu (ör. dar ekranda kısaltılan etkin firma adının tamamı). */
  title?: string;
  /** P9: menü her açıldığında (ör. listeyi tembel yükleme). */
  onOpen?: () => void;
  /** P12: `avatar` = çerçevesiz yuvarlak tetikleyici (yalnız `icon`; etiket `sr-only`, ok yok) — hesap menüsü. */
  variant?: "default" | "avatar";
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
    <details
      ref={ref}
      className="relative"
      data-testid={testId}
      onKeyDown={(e) => e.key === "Escape" && closeMenu(e.currentTarget)}
      onToggle={(e) => {
        if (e.currentTarget.open) onOpen?.();
      }}
    >
      {variant === "avatar" ? (
        <summary
          title={title}
          className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
          aria-label={ariaLabel}
        >
          {icon}
          <span className="sr-only">{label}</span>
        </summary>
      ) : (
        <summary
          title={title}
          className="inline-flex min-h-11 max-w-full cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium whitespace-nowrap text-fg hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
          aria-label={ariaLabel}
        >
          {icon}
          {labelClassName ? <span className={labelClassName}>{label}</span> : label}
          {busy}
          <ChevronDown aria-hidden className="size-4 shrink-0" />
        </summary>
      )}
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
