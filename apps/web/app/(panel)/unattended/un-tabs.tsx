"use client";

import { KeyRound, MonitorCog } from "lucide-react";
import { TabNav } from "@/components/ui/tab-nav";
import { t } from "@/lib/i18n";

/** Cihazlar / Kayıt kodları sekmeleri (`manage`); ikon bileşenleri istemci tarafında kalır (settings-tabs kalıbı). */
export function UnTabs() {
  return (
    <TabNav
      label={t("un.tabs")}
      testId="un-tabs"
      tabs={[
        { href: "/unattended", label: t("un.tab.devices"), Icon: MonitorCog, exact: true },
        { href: "/unattended/codes", label: t("un.tab.codes"), Icon: KeyRound },
      ]}
    />
  );
}
