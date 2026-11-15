"use client";

import { Building, ChevronLeft, ChevronRight, House, ServerCog, ShieldBan, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LobbyCountBadge } from "@/components/lobby-notifier";
import { RequestCountBadge } from "@/components/request-notifier";
import { t, type MessageKey } from "@/lib/i18n";
import { MODULE_ICONS as M } from "@/lib/module-icons";

// Yalnız mevcut sayfalar; yeni modül eklendiğinde buraya ikonuyla eklenir (std. 1.8). Modül sayfalarının ikonu yetki
// tablosuyla aynı tek kaynaktan (`lib/module-icons.ts`).
// `perm`: öğe yalnız bu yetki varsa görünür (arka uç da her uçta denetler).
// `anyPerm`: öğe bu yetkilerden biri varsa görünür (P27 gözetimsiz cihazlar: connect ∨ manage).
// `superAdmin`: yalnız SUPER_ADMIN rolü (toggle değil; arka uç da rol denetler).
type NavItem = {
  href: string;
  label: MessageKey;
  Icon: LucideIcon;
  perm?: string;
  anyPerm?: string[];
  superAdmin?: boolean;
  match?: string;
};
const items: NavItem[] = [
  { href: "/", label: "panel.home", Icon: House },
  { href: "/sessions", label: "nav.sessions", Icon: M.sessions, perm: "sessions.view" },
  { href: "/requests", label: "nav.requests", Icon: M.support_requests, perm: "support_requests.view" },
  // P15 (AC-235): Engellenenler — engel (yasak) anlamında ShieldBan
  { href: "/request-blocks", label: "nav.blocks", Icon: ShieldBan, perm: "support_requests.block" },
  { href: "/customers", label: "nav.customers", Icon: M.customers, perm: "customers.view" },
  { href: "/unattended", label: "nav.unattended", Icon: M.unattended, anyPerm: ["unattended.connect", "unattended.manage"] },
  { href: "/history", label: "nav.history", Icon: M.session_history, perm: "session_history.view" },
  { href: "/users", label: "nav.users", Icon: M.users, perm: "users.view" },
  { href: "/settings/support-requests", label: "nav.settings", Icon: M.settings, perm: "settings.edit", match: "/settings" },
  { href: "/audit", label: "nav.audit", Icon: M.audit, perm: "audit.view" },
  { href: "/admin/tenants", label: "nav.tenants", Icon: Building, superAdmin: true },
  { href: "/admin/settings/mysql", label: "nav.system", Icon: ServerCog, superAdmin: true, match: "/admin/settings" },
];

export function SideNav({ permissions, role }: { permissions: readonly string[]; role: string }) {
  const pathname = usePathname();
  const visible = items.filter(
    (i) =>
      (!i.perm || permissions.includes(i.perm)) &&
      (!i.anyPerm || i.anyPerm.some((p) => permissions.includes(p))) &&
      (!i.superAdmin || role === "SUPER_ADMIN"),
  );
  const listRef = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  // AC-222: dar ekranda menü yatay kayar. Etkin öğe açılışta/rota değişince görünür alana alınır (animasyonsuz —
  // menü günde çok kez kullanılır, std. 1.8); kaydırılabilir yön kenar maskesi + aria-hidden ok ile belirtilir.
  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const update = () => {
      const max = ul.scrollWidth - ul.clientWidth;
      const next = { start: max > 1 && ul.scrollLeft > 1, end: max > 1 && ul.scrollLeft < max - 1 };
      setMore((m) => (m.start === next.start && m.end === next.end ? m : next));
    };
    // scrollIntoView yerine yalnız yatay "nearest": sayfa dikeyde kaymaz, md+ dikey menüde hiçbir şey yapılmaz
    const active = ul.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && ul.scrollWidth > ul.clientWidth) {
      const a = active.getBoundingClientRect();
      const box = ul.getBoundingClientRect();
      // kenar maskesi (2.5rem, globals.css .scroll-hint-x) etkin öğeyi soldurmasın
      const pad = 2.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      if (a.left < box.left + pad) ul.scrollLeft += a.left - box.left - pad;
      else if (a.right > box.right - pad) ul.scrollLeft += a.right - box.right + pad;
    }
    update();
    ul.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(ul);
    return () => {
      ul.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [pathname]);

  return (
    <nav aria-label={t("panel.nav")} className="relative px-2 py-2 md:py-4" data-testid="side-nav">
      {/* CI 390 px taşması (2 px): rozetlerin sr-only metni position:absolute — içerme bloğu kaydırma kapsayıcısı (relative)
      olmazsa kayan şeridin dışındaki öğede belgeyi taşırır (Linux'ta geniş font). relative → kırpılır. */}
      <ul
        ref={listRef}
        data-more-start={more.start || undefined}
        data-more-end={more.end || undefined}
        className="scroll-hint-x relative flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
      >
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
      {more.start && (
        <ChevronLeft
          aria-hidden
          data-testid="nav-scroll-hint-start"
          className="pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2 text-fg-muted md:hidden"
        />
      )}
      {more.end && (
        <ChevronRight
          aria-hidden
          data-testid="nav-scroll-hint-end"
          className="pointer-events-none absolute top-1/2 right-0 size-4 -translate-y-1/2 text-fg-muted md:hidden"
        />
      )}
    </nav>
  );
}
