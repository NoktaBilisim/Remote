"use client";

import { Database, Image as ImageIcon, MessageCircle, ShieldUser, Waypoints } from "lucide-react";
import { TabNav } from "@/components/ui/tab-nav";
import { t } from "@/lib/i18n";

/** Sistem ayarları alt menüsü (P11): MySQL (`Database`) · TURN (`Waypoints` — aktarma sunucusu) · Sistem logosu (`Image`, P12) ·
 * WhatsApp servisi (`MessageCircle`, P12b AC-196) · Super Admin'ler (`ShieldUser`, P15 AC-232). */
export function SystemTabs() {
  return (
    <TabNav
      label={t("sys.nav")}
      testId="system-tabs"
      tabs={[
        { href: "/admin/settings/mysql", label: t("sys.tab.mysql"), Icon: Database },
        { href: "/admin/settings/turn", label: t("sys.tab.turn"), Icon: Waypoints },
        { href: "/admin/settings/system-logo", label: t("sys.tab.logo"), Icon: ImageIcon },
        { href: "/admin/settings/whatsapp", label: t("sys.tab.whatsapp"), Icon: MessageCircle },
        { href: "/admin/settings/superadmins", label: t("sys.tab.superadmins"), Icon: ShieldUser },
      ]}
    />
  );
}
