import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Ayar formu bölümü (PT-K13: SMTP, SMS, destek talepleri, mesai saatleri ortak iskeleti): kart + ikonlu `h2`
 * (`${id}-h`, `aria-labelledby`), içerik dikey yığında. `after` içerik yığınının dışında, kartın içinde çizilir.
 */
export function SettingsSection({
  id,
  title,
  Icon,
  testId,
  after,
  children,
}: {
  id: string;
  title: string;
  Icon: LucideIcon;
  testId?: string;
  after?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6" data-testid={testId}>
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-base font-semibold text-fg">
        <Icon aria-hidden className="size-5 text-fg-muted" />
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
      {after}
    </section>
  );
}
