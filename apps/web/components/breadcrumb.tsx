import { ChevronRight, House } from "lucide-react";
import Link from "next/link";
import { t } from "@/lib/i18n";

/** Panel breadcrumb (tasarim-kontrol §5). Son öğe geçerli sayfadır (aria-current). */
export function Breadcrumb({
  items,
  home = { href: "/", label: t("panel.home") },
}: {
  items: { label: string; href?: string }[];
  /** P21: kök öğe (portal: `/portal`, "Portal"); varsayılan panel Ana sayfa. */
  home?: { href: string; label: string };
}) {
  return (
    <nav aria-label={t("panel.breadcrumb")} className="mb-4 text-sm text-fg-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li className="flex items-center gap-1.5">
          <House aria-hidden className="size-4" />
          {items.length === 0 ? (
            <span aria-current="page" className="text-fg">
              {home.label}
            </span>
          ) : (
            <Link href={home.href} className="hover:text-fg">
              {home.label}
            </Link>
          )}
        </li>
        {items.map((it, i) => (
          <li key={it.label} className="flex items-center gap-1.5">
            <ChevronRight aria-hidden className="size-4" />
            {it.href && i < items.length - 1 ? (
              <Link href={it.href} className="hover:text-fg">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-fg">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
