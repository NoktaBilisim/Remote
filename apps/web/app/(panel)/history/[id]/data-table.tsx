import type { ReactNode } from "react";

const th = "px-3 py-2 font-medium";
const td = "px-3 py-2 align-top";

export interface Col<T> {
  head: string;
  cell: (x: T) => ReactNode;
  /** Masaüstü hücre sınıfı (genişlik/kırpma). */
  className?: string;
}

interface Props<T> {
  label: string;
  testId: string;
  rowTestId: string;
  items: T[];
  cols: Col<T>[];
}

/** ≥ xl tablo; taşarsa odaklanabilir yatay kaydırma kabı. */
function WideTable<T extends { id: string }>({ label, testId, rowTestId, items, cols }: Props<T>) {
  return (
    <div
      className="hidden overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring xl:block"
      tabIndex={0}
      role="region"
      aria-label={label}
      data-testid={`${testId}-scroll`}
    >
      <table className="w-full text-left text-sm" data-testid={testId}>
        <thead className="bg-surface-muted text-xs text-fg-muted">
          <tr>
            {cols.map((c) => (
              <th key={c.head} scope="col" className={th}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((x) => (
            <tr key={x.id} data-testid={rowTestId}>
              {cols.map((c) => (
                <td key={c.head} className={`${td} ${c.className ?? ""}`}>
                  {c.cell(x)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** < xl kart ızgarası (`<dl>`, sm+ iki sütun) — iç kaydırma yok. */
function CardGrid<T extends { id: string }>({ label, testId, rowTestId, items, cols }: Props<T>) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:hidden" aria-label={label} data-testid={`${testId}-cards`}>
      {items.map((x) => (
        <li key={x.id} className="rounded-lg border border-border bg-surface p-3 text-sm" data-testid={`${rowTestId}-card`}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
            {cols.map((c) => (
              <div key={c.head} className="contents">
                <dt className="text-fg-muted">{c.head}</dt>
                <dd className="min-w-0 text-fg wrap-anywhere">{c.cell(x)}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/**
 * Ayrıntı tablosu (TEST-P8-1): ≥ xl tablo (tam genişlik bölümde; yine taşarsa odaklanabilir yatay kaydırma kabı),
 * daha dar alanda (kenar menüsüyle 1024 px'te tablo sığmıyor) aynı veri kart ızgarası (`<dl>`, sm+ iki sütun) — iç kaydırma yok.
 */
export function DataTable<T extends { id: string }>(props: Props<T>) {
  return (
    <>
      <WideTable {...props} />
      <CardGrid {...props} />
    </>
  );
}
