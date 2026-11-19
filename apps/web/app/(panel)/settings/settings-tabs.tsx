"use client";

import {
  CalendarClock,
  FileText,
  FolderLock,
  Image as ImageIcon,
  Inbox,
  Mail,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import { TabNav } from "@/components/ui/tab-nav";
import { t } from "@/lib/i18n";

/** Ayarlar alt menüsü (P10; P11 "Aydınlatma metni", P12 "Logo", P14b "Genel", P18 "Mesai saatleri" eklendi). Görünüm ve davranış `ui/tab-nav.tsx`. */
export function SettingsTabs() {
  return (
    <TabNav
      label={t("set.nav")}
      testId="settings-tabs"
      tabs={[
        { href: "/settings/general", label: t("set.tab.general"), Icon: SlidersHorizontal },
        { href: "/settings/support-requests", label: t("set.tab.requests"), Icon: Inbox },
        { href: "/settings/business-hours", label: t("set.tab.hours"), Icon: CalendarClock },
        { href: "/settings/smtp", label: t("set.tab.smtp"), Icon: Mail },
        { href: "/settings/sms", label: t("set.tab.sms"), Icon: MessageSquareText },
        { href: "/settings/files", label: t("set.tab.files"), Icon: FolderLock },
        { href: "/settings/recording", label: t("set.tab.recording"), Icon: Video },
        { href: "/settings/security", label: t("set.tab.security"), Icon: ShieldCheck },
        { href: "/settings/consent-text", label: t("set.tab.consent"), Icon: FileText },
        { href: "/settings/logo", label: t("set.tab.logo"), Icon: ImageIcon },
      ]}
    />
  );
}
