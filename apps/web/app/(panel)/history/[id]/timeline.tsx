import { describeTimelineEvent, labelOf, SESSION_ENDED_BY_LABELS } from "@remote/contracts/labels";
import { ShieldUser } from "lucide-react";
import { formatNumber, formatTimeSeconds } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Muted, type D } from "./sections";

type Ev = D["timeline"][number];

function TimelineEvent({ e }: { e: Ev }) {
  const v = describeTimelineEvent(e);
  const who = `${labelOf(SESSION_ENDED_BY_LABELS, e.actor)}${e.actorName ? ` · ${e.actorName}` : ""}`;
  return (
    <li className="text-sm" data-testid="timeline-event" data-action={e.action}>
      <span
        aria-hidden
        className={`absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-surface ${e.result === "fail" ? "bg-danger" : "bg-primary"}`}
      />
      <p className="flex flex-wrap items-baseline gap-x-2">
        <time dateTime={e.at} className="tabular-nums text-fg-muted">
          {formatTimeSeconds(e.at)}
        </time>
        <span className="font-medium text-fg">{v.label}</span>
        {e.result === "fail" && <span className="text-xs font-medium text-danger">({t("h.t.fail")})</span>}
      </p>
      <p className="text-xs text-fg-muted">{who}</p>
      {v.warn ? (
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-0.5 text-xs font-medium text-warning">
          <ShieldUser aria-hidden className="size-4" />
          {v.note}
        </span>
      ) : (
        v.note && <p className="mt-0.5 text-xs text-fg-muted wrap-anywhere">{v.note}</p>
      )}
    </li>
  );
}

/** Zaman çizelgesi: Türkçe etiket (contracts labels.ts), bilinmeyen action ham. Metinler React metin düğümü (HTML yok). */
export function Timeline({ s }: { s: D }) {
  if (s.timeline.length === 0) return <Muted testId="timeline-empty">{t("h.t.empty")}</Muted>;
  return (
    <>
      {s.timelineTruncated && (
        <p className="mb-3 text-sm font-medium text-warning" role="status" data-testid="timeline-truncated">
          {t("h.t.truncated")}
        </p>
      )}
      <ol className="relative flex flex-col gap-3 border-l border-border pl-4" data-testid="timeline">
        {s.timeline.map((e, i) => (
          <TimelineEvent key={`${e.at}-${i}`} e={e} />
        ))}
      </ol>
    </>
  );
}

export function Quality({ s }: { s: D }) {
  const q = s.quality;
  if (!q) return <Muted testId="quality-empty">{t("h.q.empty")}</Muted>;
  const tri = (st: { avg: number; min: number; max: number }, unit: string, d = 0) =>
    `${formatNumber(st.avg, d)} / ${formatNumber(st.min, d)} / ${formatNumber(st.max, d)} ${unit}`;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]" data-testid="quality">
      <dt className="text-fg-muted">{t("h.q.fps")}</dt>
      <dd className="tabular-nums text-fg">{tri(q.fps, "fps", 1)}</dd>
      <dt className="text-fg-muted">{t("h.q.kbps")}</dt>
      <dd className="tabular-nums text-fg">{tri(q.kbps, "kbps")}</dd>
      <dt className="text-fg-muted">{t("h.q.rtt")}</dt>
      <dd className="tabular-nums text-fg">{tri(q.rttMs, "ms")}</dd>
      <dt className="text-fg-muted">{t("h.q.conn")}</dt>
      <dd className="text-fg">{t(`p5.q.conn.${q.connType}`)}</dd>
    </dl>
  );
}
