import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Ayar formu bölümü (SMTP formundaki bölümle aynı görünüm): `surface` kart, ikonlu h2. */
export function Section({ id, title, Icon, children, aside }: { id: string; title: string; Icon: LucideIcon; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-h`} className="flex items-center gap-2 text-base font-semibold text-fg">
          <Icon aria-hidden className="size-5 text-fg-muted" />
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * Kaynak rozeti: panelde kayıtlı / ortam değişkenleri / (P13a, yalnız WhatsApp) yerleşik varsayılan. Renk yalnız değil, metin.
 * Panel `primary-surface`; ortam ve varsayılan nötr `surface-muted` (varsayılan ayrıca kesik kenarlı — "ayar yapılmamış").
 */
export function SourceBadge({ source, panel, env, fallback }: { source: "panel" | "env" | "default"; panel: string; env: string; fallback?: string }) {
  const cls =
    source === "panel" ? "bg-primary-surface text-primary" : source === "default" ? "border border-dashed border-border bg-surface-muted text-fg" : "bg-surface-muted text-fg";
  return (
    <span data-testid="setting-source" data-source={source} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {source === "panel" ? panel : source === "default" ? (fallback ?? env) : env}
    </span>
  );
}
