import { CircleAlert, CircleCheck, Lock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "danger" | "warning" | "success" | "locked";

const tones: Record<Tone, { cls: string; Icon: typeof CircleAlert }> = {
  danger: { cls: "bg-danger-surface text-danger border-danger/30", Icon: CircleAlert },
  warning: { cls: "bg-warning-surface text-warning border-warning/30", Icon: TriangleAlert },
  locked: { cls: "bg-warning-surface text-warning border-warning/30", Icon: Lock },
  success: { cls: "bg-success-surface text-success border-success/30", Icon: CircleCheck },
};

/** Satır içi durum mesajı. danger/locked → role="alert" (ekran okuyucu hemen okur). */
export function Alert({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  const { cls, Icon } = tones[tone];
  const urgent = tone === "danger" || tone === "locked";
  return (
    <div
      role={urgent ? "alert" : "status"}
      data-testid={testId}
      className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm ${cls}`}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
