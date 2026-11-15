import { SearchX } from "lucide-react";
import { LinkEmpty } from "@/components/list-page";
import { t } from "@/lib/i18n";

/** Sayfa numarası son sayfanın ötesindeyse boş durum + "İlk sayfaya dön" bağlantısı (kullanıcılar, firmalar). */
export function BeyondEmpty({ pages, testId, href }: { pages: number; testId: string; href: string }) {
  return (
    <LinkEmpty
      Icon={SearchX}
      title={t("us.beyond", { pages })}
      body={t("us.beyondBody")}
      testId={testId}
      href={href}
      label={t("h.firstPage")}
    />
  );
}
