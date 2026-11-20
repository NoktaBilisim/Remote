import { CircleAlert, CircleCheck, Info, Lock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "danger" | "warning" | "success" | "locked" | "info";

const tones: Record<Tone, { cls: string; Icon: typeof CircleAlert }> = {
  danger: { cls: "bg-danger-surface text-danger border-danger/30", Icon: CircleAlert },
  warning: { cls: "bg-warning-surface text-warning border-warning/30", Icon: TriangleAlert },
  locked: { cls: "bg-warning-surface text-warning border-warning/30", Icon: Lock },
  success: { cls: "bg-success-surface text-success border-success/30", Icon: CircleCheck },
  // P11: nötr bilgi notu (ör. "ortam değişkenleri kullanılıyor") — uyarı değil, `primary-surface` bilgi kutusu
  info: { cls: "bg-primary-surface text-fg border-primary/30", Icon: Info },
};

/**
 * Satır içi durum mesajı. danger/locked → role="alert" (ekran okuyucu hemen okur); warning/success/info → role="status".
 * `icon` tonun varsayılan ikonunu anlama göre değiştirir (P32: risk kabul bandı `ShieldAlert`); renk tondan gelir.
 */
export function Alert({ tone, children, testId, icon }: { tone: Tone; children: ReactNode; testId?: string; icon?: typeof CircleAlert }) {
  const { cls, Icon: ToneIcon } = tones[tone];
  const Icon = icon ?? ToneIcon;
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
