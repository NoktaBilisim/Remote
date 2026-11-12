"use client";

import { FileText, Inbox, Mail, ShieldCheck } from "lucide-react";
import { TabNav } from "@/components/ui/tab-nav";
import { t } from "@/lib/i18n";

/** Ayarlar alt menüsü (P10; P11 "Aydınlatma metni" eklendi). Görünüm ve davranış `ui/tab-nav.tsx`. */
export function SettingsTabs() {
  return (
    <TabNav
      label={t("set.nav")}
      testId="settings-tabs"
      tabs={[
        { href: "/settings/support-requests", label: t("set.tab.requests"), Icon: Inbox },
        { href: "/settings/smtp", label: t("set.tab.smtp"), Icon: Mail },
        { href: "/settings/security", label: t("set.tab.security"), Icon: ShieldCheck },
        { href: "/settings/consent-text", label: t("set.tab.consent"), Icon: FileText },
      ]}
    />
  );
}
