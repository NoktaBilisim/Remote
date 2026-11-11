"use client";

import { History, House, MonitorSmartphone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type MessageKey } from "@/lib/i18n";

// Yalnız mevcut sayfalar; yeni modül eklendiğinde buraya ikonuyla eklenir (std. 1.8)
// `perm`: öğe yalnız bu yetki varsa görünür (arka uç da her uçta denetler).
const items: { href: string; label: MessageKey; Icon: LucideIcon; perm?: string }[] = [
  { href: "/", label: "panel.home", Icon: House },
  { href: "/sessions", label: "nav.sessions", Icon: MonitorSmartphone, perm: "sessions.view" },
  { href: "/history", label: "nav.history", Icon: History, perm: "session_history.view" },
];

export function SideNav({ permissions }: { permissions: readonly string[] }) {
  const pathname = usePathname();
  const visible = items.filter((i) => !i.perm || permissions.includes(i.perm));
  return (
    <nav aria-label={t("panel.nav")} className="px-2 py-2 md:py-4">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {visible.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium whitespace-nowrap ${
                  active ? "bg-surface-muted text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
                }`}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
