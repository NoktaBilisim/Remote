"use client";

import { Hourglass, Info, Mail, MonitorSmartphone, Phone, ShieldAlert, ShieldCheck, UserCheck, UserX } from "lucide-react";
import {
  CANCEL_REASON_LABELS,
  FIRST_SEEN_SOURCE_LABEL,
  KNOWN_DEVICE_LABEL,
  labelOf,
  NETWORK_MATCH_LABELS,
  REQUEST_STATUS_LABELS,
} from "@remote/contracts/labels";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { REQUEST_VERIFY_HINT, type RequestStatus, type SupportRequestItem } from "@/lib/requests/contract";
import { formatRequestCode, sourceView } from "@/lib/requests/source";

const STATUS_PILL: Record<RequestStatus, string> = {
  PENDING: "bg-primary-surface text-primary",
  ACCEPTED: "bg-success-surface text-success",
  CANCELLED: "bg-surface-muted text-fg-muted",
  EXPIRED: "bg-surface-muted text-fg-muted",
  REJECTED: "bg-danger-surface text-danger",
  CONNECT_FAILED: "bg-warning-surface text-warning",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span data-testid="request-status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_PILL[status]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {labelOf(REQUEST_STATUS_LABELS, status)}
    </span>
  );
}

/** Bilinen kaynak göstergesi (mimari-e9 §13.1): renk tek başına anlam taşımaz, her durumda metin var. */
export function SourceIndicator({ item }: { item: Pick<SupportRequestItem, "networkMatch" | "knownDevice"> }) {
  const v = sourceView(item.networkMatch, item.knownDevice);
  return (
    <div className="flex flex-col gap-1.5" data-testid="request-source" data-known={v.known}>
      {v.known ? (
        <>
          {/* TEST-P8b-4: rozet tek satır; nedenler altında hizalı liste. */}
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-surface px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-success">
            <ShieldCheck aria-hidden className="size-4 shrink-0" />
            {t("rq.src.known")}
          </span>
          <ul className="flex flex-col gap-0.5 text-xs text-fg-muted" data-testid="request-source-reasons">
            {v.reasons.map((r) => (
              <li key={r}>{r === "device" ? KNOWN_DEVICE_LABEL : NETWORK_MATCH_LABELS[r === "trusted" ? "TRUSTED" : "IP"]}</li>
            ))}
          </ul>
        </>
      ) : (
        <span data-testid="request-first-seen" className="inline-flex w-fit items-start gap-1.5 rounded-md bg-warning-surface px-2.5 py-1 text-xs font-medium text-warning">
          <ShieldAlert aria-hidden className="mt-px size-4 shrink-0" />
          {FIRST_SEEN_SOURCE_LABEL}
        </span>
      )}
      {v.sameBlock && <span className="text-xs text-fg-muted" data-testid="request-same-block">{NETWORK_MATCH_LABELS.PREFIX}</span>}
    </div>
  );
}

export function RequestCode({ code }: { code: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-fg-muted">{t("rq.code")}</span>
      <span data-testid="request-code" aria-label={t("rq.codeSr", { digits: code.split("").join(" ") })} className="font-mono text-3xl font-bold tracking-wider text-fg tabular-nums">
        {formatRequestCode(code)}
      </span>
    </div>
  );
}

/** Talep kartı (AC-146): ad, telefon, e-posta, açıklama düz metin (React metin düğümü — bağlantıya çevrilmez). */
export function RequestCard({
  item,
  now,
  canAccept = false,
  busy = false,
  onAccept,
  onReject,
}: {
  item: SupportRequestItem;
  now?: number | null;
  canAccept?: boolean;
  busy?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  const pending = item.status === "PENDING";
  const waitSec = pending && now ? Math.max(item.waitSec, Math.floor((now - Date.parse(item.createdAt)) / 1000)) : item.waitSec;
  const name = item.customerName ?? t("rq.anon");
  const titleId = `talep-${item.id}-t`;
  return (
    <article
      id={`talep-${item.id}`}
      aria-labelledby={titleId}
      data-testid="request-card"
      data-status={item.status}
      className="scroll-mt-24 rounded-lg border border-border bg-surface p-4 shadow-sm target:ring-2 target:ring-ring sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id={titleId} className="text-base font-semibold text-fg wrap-anywhere">{name}</h3>
            {!pending && <RequestStatusBadge status={item.status} />}
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex min-w-0 items-center gap-2">
              <dt><Phone aria-hidden className="size-4 text-fg-muted" /><span className="sr-only">{t("rq.phone")}</span></dt>
              <dd className="text-fg tabular-nums wrap-anywhere">{item.customerPhone ?? "—"}</dd>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <dt><Mail aria-hidden className="size-4 text-fg-muted" /><span className="sr-only">{t("rq.email")}</span></dt>
              <dd className="text-fg wrap-anywhere">{item.customerEmail ?? "—"}</dd>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <dt><Hourglass aria-hidden className="size-4 text-fg-muted" /><span className="sr-only">{t("rq.wait")}</span></dt>
              <dd className="text-fg tabular-nums" data-testid="request-wait">
                {pending ? t("rq.waiting", { d: formatDuration(waitSec) }) : t("rq.waited", { d: formatDuration(waitSec) })}
              </dd>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <dt><MonitorSmartphone aria-hidden className="size-4 text-fg-muted" /><span className="sr-only">{t("rq.version")}</span></dt>
              <dd className="text-fg-muted">{t("rq.versionValue", { v: item.clientVersion })} · {formatDateTime(item.createdAt)}</dd>
            </div>
          </dl>
          <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-sm whitespace-pre-wrap text-fg wrap-anywhere" data-testid="request-description">
            {item.description ?? t("rq.noDescription")}
          </p>
          {!pending && <ClosedInfo item={item} />}
        </div>
        <div className="flex shrink-0 flex-col gap-3 lg:w-64">
          <RequestCode code={item.requestCode} />
          <SourceIndicator item={item} />
        </div>
      </div>
      {pending && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
          <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-fg-muted" data-testid="request-hint">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            {REQUEST_VERIFY_HINT}
          </p>
          {canAccept && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={onReject} disabled={busy} aria-label={t("rq.rejectFor", { name })}>
                <UserX aria-hidden className="size-4" />
                {t("rq.reject")}
              </Button>
              <Button onClick={onAccept} loading={busy} aria-label={t("rq.acceptFor", { name })}>
                {!busy && <UserCheck aria-hidden className="size-4" />}
                {t("rq.accept")}
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function ClosedInfo({ item }: { item: SupportRequestItem }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {item.closedAt && (
        <>
          <dt className="text-fg-muted">{t("rq.closedAt")}</dt>
          <dd className="text-fg tabular-nums">{formatDateTime(item.closedAt)}</dd>
        </>
      )}
      {item.cancelReason && (
        <>
          <dt className="text-fg-muted">{t("rq.cancelReason")}</dt>
          <dd className="text-fg">{labelOf(CANCEL_REASON_LABELS, item.cancelReason)}</dd>
        </>
      )}
      {item.acceptedBy && (
        <>
          <dt className="text-fg-muted">{t("rq.acceptedBy")}</dt>
          <dd className="text-fg wrap-anywhere">{item.acceptedBy.name}</dd>
        </>
      )}
      {item.rejectMessage && (
        <>
          <dt className="text-fg-muted">{t("rq.rejectMessage")}</dt>
          <dd className="text-fg wrap-anywhere" data-testid="request-reject-message">{item.rejectMessage}</dd>
        </>
      )}
      {item.sessionId && (
        <>
          <dt className="text-fg-muted">{t("rq.session")}</dt>
          <dd>
            <Link href={`/history/${item.sessionId}`} className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
              {t("rq.sessionLink")}
            </Link>
          </dd>
        </>
      )}
    </dl>
  );
}
