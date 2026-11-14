import { BellRing } from "lucide-react";
import Link from "next/link";
import { t } from "@/lib/i18n";

/*
 * "Müşteri bekliyor (n)" satır rozeti (P13b-L, mimari-lobi §6.5; AC-304, 305, 309, 310, 312, 313). Anlam renkle değil
 * metin + `BellRing` ile verilir; uyarı tonu "Bekliyor" (primary-surface) durum rozetinden ayrışır (R-L3). Yalnız sayı
 * taşır, müşteri adı yok (AC-311).
 * - `href` varsa (kendi PENDING oturumum, firma bağlamı var) bağlantıdır: Tab ile odaklanır, Enter konsolu açar, 44 px hedef.
 * - `href` yoksa bilgi amaçlı `<span>` (ADMIN'de başkasının satırı; firma seçmemiş Super Admin).
 * - n = 0: yer kaymasın diye görünmez yuva (aynı ölçü, `aria-hidden`); n > 0 olunca YENİ öğe bağlanır → yalnız
 *   opacity/scale(.95→1) ile belirir (`@starting-style`), reduced-motion'da yalnız opacity.
 */
const pill =
  "inline-flex min-h-6 items-center gap-1 rounded-full border border-warning/30 bg-warning-surface px-2 text-xs font-medium whitespace-nowrap text-warning";
const enter = "transition-[opacity,transform] duration-200 ease-out starting:scale-95 starting:opacity-0 motion-reduce:starting:scale-100";

function Content({ n }: { n: number }) {
  return (
    <>
      <BellRing aria-hidden className="size-4 shrink-0" />
      {t("s.lobby.badge", { n })}
    </>
  );
}

export function WaitingBadge({ n, href }: { n: number; href?: string }) {
  if (!n || n <= 0) {
    return (
      <span key="slot" aria-hidden data-testid="waiting-slot" className={`invisible inline-flex items-center ${href ? "min-h-11" : ""}`}>
        <span className={pill}>
          <Content n={1} />
        </span>
      </span>
    );
  }
  if (href) {
    return (
      <Link
        key="link"
        href={href}
        aria-label={t("s.lobby.badgeOpen", { n })}
        data-testid="waiting-badge"
        className={`group inline-flex min-h-11 items-center rounded-full ${enter}`}
      >
        <span className={`${pill} group-hover:border-warning`}>
          <Content n={n} />
        </span>
      </Link>
    );
  }
  return (
    <span key="info" data-testid="waiting-badge" className={`${pill} ${enter}`}>
      <Content n={n} />
    </span>
  );
}
