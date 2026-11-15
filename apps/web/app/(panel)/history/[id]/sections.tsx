import type { SessionHistoryDetail } from "@remote/contracts/api/sessions";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@/lib/i18n";

/** Oturum ayrıntısı verisi (bölüm bileşenlerinin ortak tipi). */
export type D = SessionHistoryDetail;
export type RowList = [MessageKey, ReactNode][];

/** Bölüm: başlık + içerik (kart yerine üst çizgi; DESIGN §1 "gereksiz kart yok"). */
export function Section({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border pt-6" data-testid={`section-${id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold text-fg">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export const Muted = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <p className="text-sm text-fg-muted" data-testid={testId}>
    {children}
  </p>
);

export function Rows({ rows }: { rows: RowList }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{t(k)}</dt>
          <dd className="min-w-0 -mt-2 text-fg wrap-anywhere sm:mt-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const none = <span className="text-fg-muted">{t("h.d.none")}</span>;
