import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import type { ConsentTextSettings } from "@/lib/admin-settings/contract";
import { t } from "@/lib/i18n";
import { getMe, serverGet } from "@/lib/server-api";

/**
 * P22 (AC-291, mimari-p22 §8.4): genel ayarlar üstünde aydınlatma metni sohbet paragrafı bandı — yalnız `settings.edit`
 * sahibine ve sunucu `chatParagraphMissing` derken. Paragraf eklenip kaydedilince bayrak düşer, bant kalkar. Okuma hatası
 * sayfayı bozmaz (bant çizilmez; ayrıntı aydınlatma metni sayfasında).
 */
export async function ChatParagraphBanner() {
  const me = await getMe();
  if (me.kind !== "ok" || !(me.me.permissions as readonly string[]).includes("settings.edit")) return null;
  if (me.me.user.role === "SUPER_ADMIN" && !me.me.actingTenant) return null;
  const res = await serverGet<ConsentTextSettings>("/settings/consent-text");
  if (res.kind !== "ok" || !res.data.chatParagraphMissing) return null;
  return (
    <div className="mt-6 flex max-w-3xl flex-col items-start gap-2" data-testid="general-chat-missing">
      <Alert tone="warning">{t("p22.ct.missing")}</Alert>
      <Link
        href="/settings/consent-text"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <ArrowRight aria-hidden className="size-4" />
        {t("p22.ct.goto")}
      </Link>
    </div>
  );
}
