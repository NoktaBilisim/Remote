import type { PERMISSION_MODULES } from "@remote/contracts/permissions";
import {
  Building2,
  History,
  Inbox,
  MonitorCog,
  MonitorSmartphone,
  MousePointerClick,
  Paperclip,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

type ModuleKey = (typeof PERMISSION_MODULES)[number]["key"];

/**
 * Yetki modülü → ikon (std. 1.8: aynı anlam için aynı ikon). Yan menü ve yetki tablosu bu tek kaynaktan okur;
 * `Record<ModuleKey, …>` tanıma eklenen modülün ikonsuz kalmasını derleme hatasına çevirir.
 */
export const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  sessions: MonitorSmartphone,
  remote_control: MousePointerClick,
  file_transfer: Paperclip,
  session_history: History,
  support_requests: Inbox,
  customers: Building2,
  // P27 (mimari-p27 §6): gözetimsiz cihazlar — ayarlı (yönetilen) bilgisayar anlamında MonitorCog
  unattended: MonitorCog,
  users: Users,
  settings: Settings,
  audit: ScrollText,
};
