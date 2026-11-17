import type { ReactNode } from "react";

/** Rehber adımı (DESIGN §8): `primary-surface` numara dairesi + başlık + açıklama; Windows ve macOS rehberinde ortak. */
export function GuideStep({ n, title, body, children }: { n: number; title: string; body: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-surface text-xs font-semibold text-primary tabular-nums"
      >
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-fg">
          <span className="sr-only">{n}. </span>
          {title}
        </p>
        <p className="text-fg-muted">{body}</p>
        {children}
      </div>
    </li>
  );
}
