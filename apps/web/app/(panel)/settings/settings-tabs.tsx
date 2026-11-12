"use client";

import { Inbox, Mail, ShieldCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type MessageKey } from "@/lib/i18n";

const tabs: { href: string; label: MessageKey; Icon: LucideIcon }[] = [
  { href: "/settings/support-requests", label: "set.tab.requests", Icon: Inbox },
  { href: "/settings/smtp", label: "set.tab.smtp", Icon: Mail },
  { href: "/settings/security", label: "set.tab.security", Icon: ShieldCheck },
];

/**
 * Ayarlar alt menüsü (P10): bağlantı listesi, etkin sekme `aria-current`, anında geçiş. Dar ekranda (< sm) üç eşit sütun,
 * ikon üstte + etiket alt alta sarar → kaydırma/kırpma yok, tüm sekmeler ve etkin sekme her genişlikte görünür
 * (P10 test raporu bulgu 2). sm+ yatay, tek satır.
 */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label={t("set.nav")} className="mb-6 border-b border-border" data-testid="settings-tabs">
      <ul className="-mb-px grid grid-cols-3 sm:flex sm:gap-1">
        {tabs.map(({ href, label, Icon }) => {
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
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
