import { CircleAlert, CircleX, Hourglass, SearchX, UserX, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@/lib/i18n";

export type RequestEnd = "expired" | "cancelledByYou" | "closed" | "rejected" | "connectFailed" | "gone";

const ENDS: Record<RequestEnd, { Icon: LucideIcon; title: MessageKey; body: MessageKey }> = {
  expired: { Icon: Hourglass, title: "wr.end.expiredTitle", body: "wr.end.expiredBody" },
  cancelledByYou: { Icon: CircleX, title: "wr.end.cancelledTitle", body: "wr.end.cancelledBody" },
  closed: { Icon: CircleX, title: "wr.end.closedTitle", body: "wr.end.closedBody" },
  rejected: { Icon: UserX, title: "wr.end.rejectedTitle", body: "wr.end.rejectedBody" },
  connectFailed: { Icon: CircleAlert, title: "wr.end.connectFailedTitle", body: "wr.end.connectFailedBody" },
  gone: { Icon: SearchX, title: "wr.end.goneTitle", body: "wr.end.goneBody" },
};

/**
 * Web talebinin kapanış ekranları (AC-259): oturum bağlantısı metinleri (`GuestEndScreen`) DEĞİL, talep metinleri —
 * süre doldu / siz iptal ettiniz / kapatıldı / reddedildi / bağlanamadı / bulunamadı. Görünüm `GuestEndScreen` ile aynı.
 */
export function RequestEndScreen({ end, action }: { end: RequestEnd; action?: ReactNode }) {
  const { Icon, title, body } = ENDS[end];
  return (
    <section
      data-testid={`wr-end-${end}`}
      data-guest-end=""
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm"
    >
      <Icon aria-hidden className="size-8 text-fg-muted" />
      <h1 className="text-xl font-semibold text-fg">{t(title)}</h1>
      <p className="max-w-md text-sm text-fg-muted">{t(body)}</p>
      {action}
    </section>
  );
}
