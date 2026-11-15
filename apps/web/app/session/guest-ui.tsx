import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Hourglass,
  Link2Off,
  Lock,
  LogOut,
  SearchX,
  ShieldCheck,
  Timer,
  UserX,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { LogoImage } from "@/components/brand-logo";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Müşteri ekranlarının çerçevesi: firmanın logosu (resolve `tenant.logoUrl`, P12 AC-81), yoksa / firma bilinmiyorsa
 * Nokta sistem logosu + tek sütun içerik. Tema: sistem (DESIGN §8).
 */
export function GuestShell({ children, tenant }: { children: ReactNode; tenant?: { name: string; logoUrl: string | null } }) {
  return (
    <div className="group mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-center gap-3">
        <LogoImage
          variant="full"
          url={tenant?.logoUrl}
          alt={tenant ? t("lg.alt", { name: tenant.name }) : t("app.systemLogoAlt")}
          testId="guest-logo"
        />
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-fg-muted">
          <Lock aria-hidden className="size-4" />
          {t("g.secure")}
        </span>
      </header>
      <main id="icerik" className="flex flex-col gap-4">
        {children}
      </main>
      {/* TEST-P4-5: paylaşım alt bilgisi bitiş/ret/kullanılmış link ekranlarında bağlam dışı → gizli */}
      <footer className="mt-auto inline-flex group-has-[[data-guest-end]]:hidden items-center gap-1.5 text-xs text-fg-muted">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        {t("g.footer")}
      </footer>
    </div>
  );
}

export type GuestEnd =
  | "expired"
  | "cancelled"
  | "consumed"
  | "ended"
  | "notFound"
  | "rate"
  | "error"
  | "finished"
  | "rejected"
  | "lobbyTimeout"
  | "left"
  | "lost";

const ends: Record<GuestEnd, { Icon: LucideIcon; title: MessageKey; body: MessageKey }> = {
  expired: { Icon: Hourglass, title: "g.expiredTitle", body: "g.expiredBody" },
  cancelled: { Icon: CircleX, title: "g.cancelledTitle", body: "g.cancelledBody" },
  consumed: { Icon: Link2Off, title: "g.consumedTitle", body: "g.consumedBody" },
  ended: { Icon: CircleX, title: "g.endedTitle", body: "g.endedBody" },
  notFound: { Icon: SearchX, title: "g.notFoundTitle", body: "g.notFoundBody" },
  rate: { Icon: Timer, title: "g.rateTitle", body: "g.rateBody" },
  error: { Icon: CircleAlert, title: "g.errorTitle", body: "g.errorBody" },
  finished: { Icon: CircleCheck, title: "g.finishedTitle", body: "g.finishedBody" },
  rejected: { Icon: UserX, title: "g.rejectedTitle", body: "g.rejectedBody" },
  lobbyTimeout: { Icon: Hourglass, title: "g.lobbyTimeoutTitle", body: "g.lobbyTimeoutBody" },
  left: { Icon: LogOut, title: "g.leftTitle", body: "g.leftBody" },
  lost: { Icon: WifiOff, title: "g.lostTitle", body: "g.lostBody" },
};

/** Sonlanmış/geçersiz bağlantı ekranı (AC-5, AC-7, AC-8): ikon + başlık + yönlendirici açıklama. */
export function GuestEndScreen({ kind, action }: { kind: GuestEnd; action?: ReactNode }) {
  const { Icon, title, body } = ends[kind];
  return (
    <section
      data-testid={`guest-${kind}`}
      data-guest-end=""
      role={kind === "cancelled" || kind === "expired" || kind === "rejected" ? "alert" : undefined}
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
