"use client";

import { Database, Waypoints } from "lucide-react";
import { TabNav } from "@/components/ui/tab-nav";
import { t } from "@/lib/i18n";

/** Sistem ayarları alt menüsü (P11): MySQL (`Database`) · TURN (`Waypoints` — aktarma sunucusu). */
export function SystemTabs() {
  return (
    <TabNav
      label={t("sys.nav")}
      testId="system-tabs"
      tabs={[
        { href: "/admin/settings/mysql", label: t("sys.tab.mysql"), Icon: Database },
        { href: "/admin/settings/turn", label: t("sys.tab.turn"), Icon: Waypoints },
      ]}
    />
  );
}
