import { MessageSquare, Paperclip } from "lucide-react";
import { t } from "@/lib/i18n";

/** Sohbet / Dosyalar sekme seçenekleri (konsol yan paneli ve müşteri sayfası ortak; okunmamış sayısı sohbet sekmesinde). */
export function chatFilesOptions(unread: number) {
  return [
    {
      value: "chat" as const,
      label: t("p5.tab.chat"),
      icon: <MessageSquare aria-hidden className="size-4" />,
      ...(unread ? { count: unread } : {}),
    },
    { value: "files" as const, label: t("p5.tab.files"), icon: <Paperclip aria-hidden className="size-4" /> },
  ];
}
