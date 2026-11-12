"use client";

import { useState } from "react";
import { initials } from "@/lib/format";

/**
 * Avatar: `src` varsa sabit boyutlu `<img>` (next/image değil — CSP, DESIGN §5), yüklenemezse veya yoksa baş harf rozeti
 * (std. §1.5). Ad her zaman yanında metin olarak yazıldığından dekoratiftir (`alt=""`, `aria-hidden`). Yükleme P12.
 */
export function Avatar({ name, size = "md", src, testId }: { name: string; size?: "sm" | "md" | "lg"; src?: string | null; testId?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const cls = size === "lg" ? "size-16 text-xl" : size === "sm" ? "size-8 text-xs" : "size-9 text-sm";
  if (src && broken !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        data-testid={testId}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(src)}
        className={`shrink-0 rounded-full bg-surface-muted object-cover ${cls}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-surface font-semibold text-primary ${cls}`}
    >
      {initials(name)}
    </span>
  );
}
