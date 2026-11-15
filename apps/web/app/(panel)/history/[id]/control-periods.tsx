import {
  CONSENT_SOURCE_LABELS,
  CONTROL_REVOKE_REASON_LABELS,
  labelOf,
  SELF_ELEVATED_UNKNOWN,
  SELF_ELEVATED_WARNING,
} from "@remote/contracts/labels";
import { ShieldUser } from "lucide-react";
import { formatDateTime, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Muted, type D } from "./sections";

type Period = D["controlPeriods"][number];

function Elevated({ v }: { v: boolean | null }) {
  if (v === true)
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-0.5 text-xs font-medium text-warning"
        data-testid="self-elevated"
      >
        <ShieldUser aria-hidden className="size-4" />
        {SELF_ELEVATED_WARNING}
      </span>
    );
  if (v === null) return <span className="text-xs text-fg-muted">{SELF_ELEVATED_UNKNOWN}</span>;
  return null;
}

/** Kapanış zamanı; kapanmamış dönemde uyarı + ipucu. */
function RevokedAt({ at }: { at: string | null }) {
  if (at) return <span className="tabular-nums">{formatDateTime(at)}</span>;
  return (
    <span data-testid="no-close">
      <span className="font-medium text-warning">{t("h.k.noClose")}</span>
      <span className="block text-xs text-fg-muted">{t("h.k.noCloseHint")}</span>
    </span>
  );
}

/** Kapanmış dönemin süre / kapatan / neden satırları (yalnız dolu olanlar). */
function ClosedRows({ p }: { p: Period }) {
  return (
    <>
      {p.revokedAt && (
        <>
          <dt className="text-fg-muted">{t("h.k.length")}</dt>
          <dd className="tabular-nums text-fg">{formatDuration((Date.parse(p.revokedAt) - Date.parse(p.grantedAt)) / 1000)}</dd>
        </>
      )}
      {p.revokedSource && (
        <>
          <dt className="text-fg-muted">{t("h.k.closedBy")}</dt>
          <dd className="text-fg">{labelOf(CONSENT_SOURCE_LABELS, p.revokedSource)}</dd>
        </>
      )}
      {p.revokedReason && (
        <>
          <dt className="text-fg-muted">{t("h.k.reason")}</dt>
          <dd className="text-fg">{labelOf(CONTROL_REVOKE_REASON_LABELS, p.revokedReason)}</dd>
        </>
      )}
    </>
  );
}

function PeriodItem({ p, n }: { p: Period; n: number }) {
  return (
    <li className="rounded-md border border-border bg-surface p-3 text-sm" data-testid="control-period">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-fg">{t("h.k.period", { n })}</h3>
        <Elevated v={p.selfElevated} />
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-fg-muted">{t("h.k.granted")}</dt>
        <dd className="tabular-nums text-fg">{formatDateTime(p.grantedAt)}</dd>
        <dt className="text-fg-muted">{t("h.k.revoked")}</dt>
        <dd className="text-fg">
          <RevokedAt at={p.revokedAt} />
        </dd>
        <ClosedRows p={p} />
      </dl>
    </li>
  );
}

/** Kontrol dönemleri (P7 verisi): verildi → kapandı, kapatan (TECH/HOTKEY/UI/SYSTEM/RECONNECT), neden, selfElevated. */
export function ControlPeriods({ s }: { s: D }) {
  if (s.mode === "BROWSER") return <Muted testId="control-browser">{t("h.k.browser")}</Muted>;
  if (s.controlPeriods.length === 0) return <Muted testId="control-empty">{t("h.k.empty")}</Muted>;
  return (
    <ol className="flex flex-col gap-3">
      {s.controlPeriods.map((p, i) => (
        <PeriodItem key={p.grantedAt + i} p={p} n={i + 1} />
      ))}
    </ol>
  );
}
