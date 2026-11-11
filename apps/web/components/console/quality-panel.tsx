"use client";

import { Signal } from "lucide-react";
import type { Level, Issue, Sample } from "@/lib/webrtc/stats";
import { formatNumber } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

const TONE: Record<Level, string> = {
  ok: "bg-success-surface text-success",
  warn: "bg-warning-surface text-warning",
  bad: "bg-danger-surface text-danger",
};

/** Kalite paneli (AC-44, AC-45). Ölçüm yokken iskelet metin; seviye renk + metinle (yalnız renge dayanmaz). */
export function QualityPanel({ last, verdict }: { last: Sample | null; verdict: { level: Level; issues: Issue[] } }) {
  if (!last) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-fg-muted" data-testid="quality-empty">
        <Signal aria-hidden className="size-6" />
        <p>{t("p5.q.empty")}</p>
      </div>
    );
  }
  const v = (n: number | null, unit: string, digits = 0) => (n === null ? "—" : `${formatNumber(n, digits)} ${unit}`);
  const rows: [string, string][] = [
    [t("p5.q.fps"), v(last.fps, "FPS")],
    [t("p5.q.bitrate"), v(last.kbps, "kbps")],
    [t("p5.q.rtt"), v(last.rttMs, "ms")],
    [t("p5.q.loss"), last.lossPct === null ? "—" : `%${formatNumber(last.lossPct, 1)}`],
    [t("p5.q.res"), last.width && last.height ? `${last.width}×${last.height}` : "—"],
    [t("p5.q.conn"), last.connType ? t(`p5.q.conn.${last.connType}` as MessageKey) : "—"],
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="quality-panel" data-level={verdict.level}>
      <p role="status" className={`inline-flex items-center gap-2 self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[verdict.level]}`}>
        <Signal aria-hidden className="size-4" />
        {t(`p5.q.level.${verdict.level}` as MessageKey)}
        {verdict.issues.length > 0 && ` — ${verdict.issues.map((i) => t(`p5.q.issue.${i}` as MessageKey)).join(", ")}`}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="text-right tabular-nums text-fg">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
