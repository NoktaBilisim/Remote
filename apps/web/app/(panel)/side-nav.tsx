"use client";

import {
  Building,
  Building2,
  History,
  House,
  Inbox,
  MonitorSmartphone,
  ScrollText,
  ServerCog,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LobbyCountBadge } from "@/components/lobby-notifier";
import { RequestCountBadge } from "@/components/request-notifier";
import { t, type MessageKey } from "@/lib/i18n";

// Yalnız mevcut sayfalar; yeni modül eklendiğinde buraya ikonuyla eklenir (std. 1.8)
// `perm`: öğe yalnız bu yetki varsa görünür (arka uç da her uçta denetler).
// `superAdmin`: yalnız SUPER_ADMIN rolü (toggle değil; arka uç da rol denetler).
const items: { href: string; label: MessageKey; Icon: LucideIcon; perm?: string; superAdmin?: boolean; match?: string }[] = [
  { href: "/", label: "panel.home", Icon: House },
  { href: "/sessions", label: "nav.sessions", Icon: MonitorSmartphone, perm: "sessions.view" },
  { href: "/requests", label: "nav.requests", Icon: Inbox, perm: "support_requests.view" },
  { href: "/customers", label: "nav.customers", Icon: Building2, perm: "customers.view" },
  { href: "/history", label: "nav.history", Icon: History, perm: "session_history.view" },
  { href: "/users", label: "nav.users", Icon: Users, perm: "users.view" },
  { href: "/settings/support-requests", label: "nav.settings", Icon: Settings, perm: "settings.edit", match: "/settings" },
  { href: "/audit", label: "nav.audit", Icon: ScrollText, perm: "audit.view" },
  { href: "/admin/tenants", label: "nav.tenants", Icon: Building, superAdmin: true },
  { href: "/admin/settings/mysql", label: "nav.system", Icon: ServerCog, superAdmin: true, match: "/admin/settings" },
];

export function SideNav({ permissions, role }: { permissions: readonly string[]; role: string }) {
  const pathname = usePathname();
  const visible = items.filter((i) => (!i.perm || permissions.includes(i.perm)) && (!i.superAdmin || role === "SUPER_ADMIN"));
  return (
    <nav aria-label={t("panel.nav")} className="px-2 py-2 md:py-4">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {visible.map(({ href, label, Icon, match }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(match ?? href);
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
                {href === "/sessions" && <LobbyCountBadge />}
                {href === "/requests" && <RequestCountBadge />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
