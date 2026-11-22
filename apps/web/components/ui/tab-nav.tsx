"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const COLS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" };

/**
 * Alt çizgili sayfa alt menüsü (P10 Ayarlar alt menüsünden genelleştirildi, P11): bağlantı listesi, etkin sekme
 * `aria-current`, anında geçiş (animasyonsuz). Dar ekranda (< sm) eşit sütunlar, ikon üstte + etiket alt alta sarar →
 * kaydırma/kırpma yok, tüm sekmeler her genişlikte görünür. sm+ yatay tek satır; sekmeler sığmazsa (Ayarlar 11 sekme)
 * daralıp üst üste binmez, şerit kendi içinde yatay kayar (Vitrin 2026-11-17 düzeltmesi).
 * Akış (2026-11-23): etkin sekme alt çizgi `accent` + `accent-surface` zemin + Nokta mavisi ikon, metin `fg`; üst köşeler 12px.
 * P27: `exact` sekme yalnız yolu birebir eşleşince etkindir (üst yol bir başka sekmenin öneki olduğunda, ör. `/unattended`
 * ↔ `/unattended/codes`).
 */
export function TabNav({
  tabs,
  label,
  testId,
}: {
  tabs: readonly { href: string; label: string; Icon: LucideIcon; exact?: boolean }[];
  label: string;
  testId?: string;
}) {
  const pathname = usePathname();
  const list = useRef<HTMLUListElement>(null);
  // Kayan şeritte etkin sekme görünür alana alınır (yalnız şeridin kendi kaydırması; sayfa kaymaz)
  useEffect(() => {
    const ul = list.current;
    const cur = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !cur || ul.scrollWidth <= ul.clientWidth) return;
    const left = cur.getBoundingClientRect().left - ul.getBoundingClientRect().left + ul.scrollLeft;
    if (left < ul.scrollLeft || left + cur.offsetWidth > ul.scrollLeft + ul.clientWidth)
      ul.scrollLeft = left - (ul.clientWidth - cur.offsetWidth) / 2;
  }, [pathname]);
  return (
    <nav aria-label={label} className="mb-6 border-b border-border" data-testid={testId}>
      <ul ref={list} className={`-mb-px grid ${COLS[tabs.length] ?? "grid-cols-4"} sm:flex sm:gap-1 sm:overflow-x-auto`}>
        {tabs.map(({ href, label: text, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href} className="min-w-0 sm:shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-t-md border-b-2 px-1 py-1.5 text-center text-xs break-words hyphens-auto font-medium sm:flex-row sm:gap-2 sm:px-3 sm:py-0 sm:text-sm sm:whitespace-nowrap ${
                  active ? "border-accent bg-accent-surface text-fg" : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                <Icon aria-hidden className={`size-4 shrink-0 ${active ? "text-accent" : ""}`} />
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
