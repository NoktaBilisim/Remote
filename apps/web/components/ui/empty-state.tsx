import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Boş durum: ikon + başlık + açıklama + (varsa) eylem. */
export function EmptyState({
  Icon,
  title,
  body,
  action,
  testId = "empty-state",
}: {
  Icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-surface-muted text-primary">
        <Icon aria-hidden className="size-5" />
      </span>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <p className="max-w-md text-sm text-fg-muted">{body}</p>
      {action}
    </section>
  );
}
