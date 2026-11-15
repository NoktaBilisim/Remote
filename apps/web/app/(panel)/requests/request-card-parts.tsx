import {
  Building2,
  Hourglass,
  Mail,
  MonitorSmartphone,
  Phone,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  BINDING_REVOKED_LABEL,
  CANCEL_REASON_LABELS,
  FIRST_SEEN_SOURCE_LABEL,
  GENERAL_CUSTOMER_LABEL,
  KNOWN_DEVICE_LABEL,
  labelOf,
  NETWORK_MATCH_LABELS,
  STALE_SOURCE_LABEL,
  viaBindingLabel,
} from "@remote/contracts/labels";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { formatRequestCode, sourceView } from "@/lib/requests/source";
import { slaView } from "@/lib/requests/p18";
import { AfterHoursBadge, AssignedChip, PriorityBadge, SlaBadge, WebSourceBadge } from "./request-badges";

/* Talep kartının (request-card.tsx) çizim parçaları — PT-K13: kart işlevinden çıkarıldı; DOM/sınıf/testid aynı. */

type SourceItem = Pick<SupportRequestItem, "networkMatch" | "knownDevice"> &
  Partial<Pick<SupportRequestItem, "viaBinding" | "bindingRevoked" | "staleSource" | "customerFirm">>;

const warnBox = "inline-flex w-fit items-start gap-1.5 rounded-md bg-warning-surface px-2.5 py-1 text-xs font-medium text-warning";

/** Kayıtlı bilgisayar / iptal edilmiş kayıt / eski kaynak satırları (SourceIndicator üst kısmı). */
function BindingNotes({ item, binding, revoked }: { item: SourceItem; binding: boolean; revoked: boolean }) {
  return (
    <>
      {binding && (
        <span
          data-testid="request-via-binding"
          className="inline-flex w-fit items-start gap-1.5 rounded-md bg-surface-muted px-2.5 py-1 text-xs font-medium text-fg"
        >
          <ShieldCheck aria-hidden className="mt-px size-4 shrink-0" />
          {viaBindingLabel(item.customerFirm?.name ?? null)}
        </span>
      )}
      {revoked && (
        <span data-testid="request-binding-revoked" className={warnBox}>
          <ShieldAlert aria-hidden className="mt-px size-4 shrink-0" />
          {BINDING_REVOKED_LABEL}
        </span>
      )}
      {item.staleSource && (
        <span data-testid="request-stale-source" className="inline-flex w-fit items-start gap-1.5 text-xs font-medium text-warning">
          <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
          {STALE_SOURCE_LABEL}
        </span>
      )}
    </>
  );
}

/** "Bilinen kaynak" rozeti + nedenler (TEST-P8b-4: rozet tek satır; nedenler altında hizalı liste). */
function KnownSource({ reasons }: { reasons: ReturnType<typeof sourceView>["reasons"] }) {
  return (
    <>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-surface px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-success">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        {t("rq.src.known")}
      </span>
      <ul className="flex flex-col gap-0.5 text-xs text-fg-muted" data-testid="request-source-reasons">
        {reasons.map((r) => (
          <li key={r}>{r === "device" ? KNOWN_DEVICE_LABEL : NETWORK_MATCH_LABELS[r === "trusted" ? "TRUSTED" : "IP"]}</li>
        ))}
      </ul>
    </>
  );
}

/** Bilinen kaynak göstergesi (mimari-e9 §13.1): renk tek başına anlam taşımaz, her durumda metin var. */
export function SourceIndicator({ item }: { item: SourceItem }) {
  const v = sourceView(item.networkMatch, item.knownDevice);
  // P8c r2 (§15.1, §15.7 K20): kayıtlı bilgisayar = bilinen kaynak, NÖTR rozet (doğrulama değildir); yalnız kayıt etkinken.
  // İptal edilmiş kayıt → "İlk kez görülen kaynak" gibi uyarı rozeti.
  const binding = Boolean(item.viaBinding);
  const revoked = !binding && Boolean(item.bindingRevoked);
  return (
    <div className="flex flex-col gap-1.5" data-testid="request-source" data-known={v.known || binding}>
      <BindingNotes item={item} binding={binding} revoked={revoked} />
      {v.known ? (
        <KnownSource reasons={v.reasons} />
      ) : binding || revoked ? null : (
        <span data-testid="request-first-seen" className={warnBox}>
          <ShieldAlert aria-hidden className="mt-px size-4 shrink-0" />
          {FIRST_SEEN_SOURCE_LABEL}
        </span>
      )}
      {v.sameBlock && (
        <span className="text-xs text-fg-muted" data-testid="request-same-block">
          {NETWORK_MATCH_LABELS.PREFIX}
        </span>
      )}
    </div>
  );
}

export function RequestCode({ code }: { code: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-fg-muted">{t("rq.code")}</span>
      <span
        data-testid="request-code"
        aria-label={t("rq.codeSr", { digits: code.split("").join(" ") })}
        className="font-mono text-3xl font-bold tracking-wider text-fg tabular-nums"
      >
        {formatRequestCode(code)}
      </span>
    </div>
  );
}

/** Kart bilgi satırı: ikon + ekran okuyucu etiketi (`dt`), değer (`dd`). */
function Fact({
  Icon,
  label,
  wide = false,
  className,
  testId,
  children,
}: {
  Icon: LucideIcon;
  label: string;
  wide?: boolean;
  className: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "flex min-w-0 items-center gap-2 sm:col-span-2" : "flex min-w-0 items-center gap-2"}>
      <dt>
        <Icon aria-hidden className="size-4 text-fg-muted" />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className={className} data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** Firma, telefon, e-posta, bekleme, sürüm + tarih. */
export function CardFacts({ item, pending, now }: { item: SupportRequestItem; pending: boolean; now?: number | null }) {
  const waitSec = pending && now ? Math.max(item.waitSec, Math.floor((now - Date.parse(item.createdAt)) / 1000)) : item.waitSec;
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      <Fact Icon={Building2} label={t("rq.firm")} wide className="font-medium text-fg wrap-anywhere" testId="request-firm">
        {item.customerFirm?.name ?? GENERAL_CUSTOMER_LABEL}
      </Fact>
      <Fact Icon={Phone} label={t("rq.phone")} className="text-fg tabular-nums wrap-anywhere">
        {item.customerPhone ?? "—"}
      </Fact>
      <Fact Icon={Mail} label={t("rq.email")} className="text-fg wrap-anywhere">
        {item.customerEmail ?? "—"}
      </Fact>
      <Fact Icon={Hourglass} label={t("rq.wait")} className="text-fg tabular-nums" testId="request-wait">
        {pending ? t("rq.waiting", { d: formatDuration(waitSec) }) : t("rq.waited", { d: formatDuration(waitSec) })}
      </Fact>
      <Fact Icon={MonitorSmartphone} label={t("rq.version")} className="text-fg-muted">
        {/* P19: WEB talebinde sürüm yok (null); "Web" kaynak etiketi J5'te. */}
        {item.clientVersion !== null ? `${t("rq.versionValue", { v: item.clientVersion })} · ` : ""}
        {formatDateTime(item.createdAt)}
      </Fact>
    </dl>
  );
}

/** P18 rozet satırı: öncelik, mesai dışı, atanan, SLA (bekleyen); kapalı talepte öncelik + SLA aşımı. */
export function P18Badges({
  item,
  pending,
  now,
  meId,
  offsetMs,
}: {
  item: SupportRequestItem;
  pending: boolean;
  now: number | null;
  meId?: string;
  offsetMs: number;
}) {
  const sla = pending ? slaView(item, now, offsetMs) : item.slaBreached ? ({ kind: "breached" } as const) : ({ kind: "none" } as const);
  const web = item.source === "WEB";
  if (!pending && !web && item.priority === "NORMAL" && !item.afterHours && sla.kind === "none") return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="request-p18">
      {web && <WebSourceBadge />}
      <PriorityBadge priority={item.priority} />
      {item.afterHours && <AfterHoursBadge />}
      {pending && item.assignedTo && <AssignedChip assignedTo={item.assignedTo} meId={meId} />}
      <SlaBadge view={sla} />
    </div>
  );
}

/** Kapalı talep bilgi satırı (`dt` + `dd`, ızgaranın iki sütunu). */
function ClosedRow({ label, className, testId, children }: { label: string; className?: string; testId?: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={className} data-testid={testId}>
        {children}
      </dd>
    </>
  );
}

export function ClosedInfo({ item }: { item: SupportRequestItem }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {item.slaDueAt && (
        <ClosedRow label={t("rq.sla.target")} className="text-fg tabular-nums" testId="request-sla-target">
          {formatDateTime(item.slaDueAt)} · {item.slaBreached ? t("rq.sla.missed") : t("rq.sla.met")}
        </ClosedRow>
      )}
      {item.closedAt && (
        <ClosedRow label={t("rq.closedAt")} className="text-fg tabular-nums">
          {formatDateTime(item.closedAt)}
        </ClosedRow>
      )}
      {item.cancelReason && (
        <ClosedRow label={t("rq.cancelReason")} className="text-fg">
          {labelOf(CANCEL_REASON_LABELS, item.cancelReason)}
        </ClosedRow>
      )}
      {item.acceptedBy && (
        <ClosedRow label={t("rq.acceptedBy")} className="text-fg wrap-anywhere">
          {item.acceptedBy.name}
        </ClosedRow>
      )}
      {item.rejectMessage && (
        <ClosedRow label={t("rq.rejectMessage")} className="text-fg wrap-anywhere" testId="request-reject-message">
          {item.rejectMessage}
        </ClosedRow>
      )}
      {item.sessionId && (
        <ClosedRow label={t("rq.session")}>
          <Link href={`/history/${item.sessionId}`} className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
            {t("rq.sessionLink")}
          </Link>
        </ClosedRow>
      )}
    </dl>
  );
}
