import { CircleAlert, CircleX, Hourglass, Link2Off, SearchX, Timer, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { t, type MessageKey } from "@/lib/i18n";

/** Müşteri ekranlarının çerçevesi: sistem logosu (tenant logosu P9) + tek sütun içerik. Tema: sistem. */
export function GuestShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-8">
      <header>
        <BrandLogo variant="full" />
      </header>
      <main id="icerik" className="flex flex-col gap-4">
        {children}
      </main>
    </div>
  );
}

export type GuestEnd = "expired" | "cancelled" | "consumed" | "ended" | "notFound" | "rate" | "error";

const ends: Record<GuestEnd, { Icon: LucideIcon; title: MessageKey; body: MessageKey }> = {
  expired: { Icon: Hourglass, title: "g.expiredTitle", body: "g.expiredBody" },
  cancelled: { Icon: CircleX, title: "g.cancelledTitle", body: "g.cancelledBody" },
  consumed: { Icon: Link2Off, title: "g.consumedTitle", body: "g.consumedBody" },
  ended: { Icon: CircleX, title: "g.endedTitle", body: "g.endedBody" },
  notFound: { Icon: SearchX, title: "g.notFoundTitle", body: "g.notFoundBody" },
  rate: { Icon: Timer, title: "g.rateTitle", body: "g.rateBody" },
  error: { Icon: CircleAlert, title: "g.errorTitle", body: "g.errorBody" },
};

/** Sonlanmış/geçersiz bağlantı ekranı (AC-5, AC-7, AC-8): ikon + başlık + yönlendirici açıklama. */
export function GuestEndScreen({ kind, action }: { kind: GuestEnd; action?: ReactNode }) {
  const { Icon, title, body } = ends[kind];
  return (
    <section
      data-testid={`guest-${kind}`}
      role={kind === "cancelled" || kind === "expired" ? "alert" : undefined}
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm"
    >
      <Icon aria-hidden className="size-8 text-fg-muted" />
      <h1 className="text-xl font-semibold text-fg">{t(title)}</h1>
      <p className="max-w-md text-sm text-fg-muted">{t(body)}</p>
      {action}
    </section>
  );
}

/** Sunucu hata kodu → ekran. */
export function endFromError(status: number, code: string): GuestEnd {
  if (code === "SESSION_EXPIRED") return "expired";
  if (code === "SESSION_CANCELLED") return "cancelled";
  if (code === "SESSION_CONSUMED") return "consumed";
  if (status === 404 || status === 400) return "notFound";
  if (status === 429) return "rate";
  return "error";
}
