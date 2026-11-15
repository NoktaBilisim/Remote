import { AlarmClock, CircleCheck, ChevronsDown, ChevronsUp, Globe, Minus, MoonStar, Timer, UserCheck } from "lucide-react";
import { AFTER_HOURS_LABEL, labelOf, PRIORITY_LABELS, REQUEST_SOURCE_LABELS, SLA_BREACHED_LABEL } from "@remote/contracts/labels";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { formatSlaRemaining, type RequestPriority, type SlaView } from "@/lib/requests/p18";

const pill = "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap";

const PRIORITY_VIEW: Record<RequestPriority, { cls: string; Icon: typeof Minus }> = {
  HIGH: { cls: "bg-warning-surface text-warning", Icon: ChevronsUp },
  NORMAL: { cls: "bg-surface-muted text-fg-muted", Icon: Minus },
  LOW: { cls: "bg-surface-muted text-fg-muted", Icon: ChevronsDown },
};

/** Öncelik rozeti (§8b.8): Yüksek `warning`, Normal/Düşük nötr; renk tek başına anlam taşımaz (metin + ikon). */
export function PriorityBadge({ priority }: { priority: RequestPriority }) {
  const v = PRIORITY_VIEW[priority] ?? PRIORITY_VIEW.NORMAL;
  return (
    <span data-testid="request-priority" data-priority={priority} className={`${pill} ${v.cls}`}>
      <v.Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">{t("rq.p.sr")} </span>
      {labelOf(PRIORITY_LABELS, priority)}
    </span>
  );
}

/** P19 (AC-259): web formundan gelen talep rozeti "Web" (`Globe`); İstemci (AGENT) varsayılan olduğu için rozet yok. */
export function WebSourceBadge() {
  return (
    <span data-testid="request-source-web" className={`${pill} bg-primary-surface text-primary`}>
      <Globe aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">{t("rq.src.sr")} </span>
      {REQUEST_SOURCE_LABELS.WEB}
    </span>
  );
}

export function AfterHoursBadge() {
  return (
    <span data-testid="request-after-hours" className={`${pill} bg-surface-muted text-fg-muted`}>
      <MoonStar aria-hidden className="size-3.5 shrink-0" />
      {AFTER_HOURS_LABEL}
    </span>
  );
}

/** "Atandı: <ad>" çipi; bana atanmışsa "Size atandı". */
export function AssignedChip({ assignedTo, meId }: { assignedTo: NonNullable<SupportRequestItem["assignedTo"]>; meId?: string }) {
  const mine = assignedTo.id === meId;
  return (
    <span
      data-testid="request-assigned"
      data-mine={mine}
      title={assignedTo.name}
      className={`${pill} max-w-full ${mine ? "bg-primary-surface text-primary" : "bg-surface-muted text-fg"}`}
    >
      <UserCheck aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{mine ? t("rq.as.mine") : t("rq.as.chip", { name: assignedTo.name })}</span>
    </span>
  );
}

/** SLA göstergesi: `Timer` + kalan süre; aşınca `AlarmClock` + danger "SLA aşıldı"; kapanmış ve karşılanmış → `CircleCheck` + success "SLA içinde". */
export function SlaBadge({ view }: { view: SlaView }) {
  if (view.kind === "none") return null;
  if (view.kind === "breached")
    return (
      <span data-testid="request-sla" data-state="breached" className={`${pill} bg-danger-surface text-danger`}>
        <AlarmClock aria-hidden className="size-3.5 shrink-0" />
        {SLA_BREACHED_LABEL}
      </span>
    );
  if (view.kind === "met")
    return (
      <span data-testid="request-sla" data-state="met" className={`${pill} bg-success-surface text-success`}>
        <CircleCheck aria-hidden className="size-3.5 shrink-0" />
        {t("rq.sla.within")}
      </span>
    );
  return (
    <span data-testid="request-sla" data-state="ok" className={`${pill} bg-surface-muted text-fg tabular-nums`}>
      <Timer aria-hidden className="size-3.5 shrink-0" />
      {view.kind === "due" ? t("rq.sla.due", { at: formatTime(view.at) }) : t("rq.sla.left", { d: formatSlaRemaining(view.ms) })}
    </span>
  );
}
