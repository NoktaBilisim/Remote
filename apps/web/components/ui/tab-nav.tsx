"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const COLS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

/**
 * Alt çizgili sayfa alt menüsü (P10 Ayarlar alt menüsünden genelleştirildi, P11): bağlantı listesi, etkin sekme
 * `aria-current`, anında geçiş (animasyonsuz). Dar ekranda (< sm) eşit sütunlar, ikon üstte + etiket alt alta sarar →
 * kaydırma/kırpma yok, tüm sekmeler her genişlikte görünür. sm+ yatay tek satır. En çok 4 sekme.
 */
export function TabNav({ tabs, label, testId }: { tabs: readonly { href: string; label: string; Icon: LucideIcon }[]; label: string; testId?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="mb-6 border-b border-border" data-testid={testId}>
      <ul className={`-mb-px grid ${COLS[tabs.length] ?? "grid-cols-4"} sm:flex sm:gap-1`}>
        {tabs.map(({ href, label: text, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-col items-center justify-center gap-1 border-b-2 px-2 py-1.5 text-center text-xs font-medium sm:flex-row sm:gap-2 sm:px-3 sm:py-0 sm:text-sm sm:whitespace-nowrap ${
                  active ? "border-primary text-primary" : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
