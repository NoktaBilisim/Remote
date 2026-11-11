import type { SessionHistoryDetail } from "@remote/contracts/api/sessions";
import {
  CONSENT_DECISION_LABELS,
  CONSENT_LEVEL_LABELS,
  CONSENT_SOURCE_LABELS,
  CONTROL_REVOKE_REASON_LABELS,
  describeTimelineEvent,
  END_REASON_LABELS,
  FILE_DIRECTION_LABELS,
  FILE_RESULT_LABELS,
  labelOf,
  SELF_ELEVATED_UNKNOWN,
  SELF_ELEVATED_WARNING,
  SESSION_ENDED_BY_LABELS,
  SESSION_MODE_LABELS,
} from "@remote/contracts/labels";
import { Download, ShieldUser, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/badge";
import { formatBytes, formatDateTime, formatDuration, formatNumber, formatTimeSeconds } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { DurationCell } from "../history-list";
import { CopyHash } from "./copy-hash";

type D = SessionHistoryDetail;

/** Bölüm: başlık + içerik (kart yerine üst çizgi; DESIGN §1 "gereksiz kart yok"). */
export function Section({ id, title, children, aside }: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border pt-6" data-testid={`section-${id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold text-fg">{title}</h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const Muted = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <p className="text-sm text-fg-muted" data-testid={testId}>{children}</p>
);

function Rows({ rows }: { rows: [MessageKey, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{t(k)}</dt>
          <dd className="min-w-0 -mt-2 text-fg wrap-anywhere sm:mt-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const none = <span className="text-fg-muted">{t("h.d.none")}</span>;

/** Özet: başlangıç/bitiş/süre, müşteri, sonlandıran (AC-62). */
export function Summary({ s, showTenant }: { s: D; showTenant: boolean }) {
  const endedBy = s.endedBy
    ? `${labelOf(SESSION_ENDED_BY_LABELS, s.endedBy)}${s.endedBy === "ADMIN" && s.terminatedBy ? ` — ${s.terminatedBy.name}` : ""}`
    : null;
  const rows: [MessageKey, ReactNode][] = [
    ["h.d.status", <StatusBadge key="st" status={s.status} />],
    ["h.d.created", formatDateTime(s.createdAt)],
    ["h.d.started", s.startedAt ? formatDateTime(s.startedAt) : <span className="text-fg-muted">{t("h.d.notStarted")}</span>],
    ["h.d.ended", s.endedAt ? formatDateTime(s.endedAt) : s.status === "ACTIVE" ? t("h.d.ongoing") : none],
    ["h.d.duration", <DurationCell key="du" s={s} />],
    ["h.d.mode", s.mode ? labelOf(SESSION_MODE_LABELS, s.mode) : t("h.mode.none")],
    ["h.d.tech", s.technician.name],
    ...(showTenant && s.tenant ? ([["h.d.tenant", s.tenant.name]] as [MessageKey, ReactNode][]) : []),
    ["h.d.customer", s.customerName ?? <span className="text-fg-muted italic">{t("h.noCustomer")}</span>],
    ["h.d.email", s.customerEmail ?? none],
    ["h.d.endedBy", endedBy ?? none],
    ["h.d.endReason", s.endReason ? labelOf(END_REASON_LABELS, s.endReason) : none],
  ];
  return <Rows rows={rows} />;
}

const th = "px-3 py-2 font-medium";
const td = "px-3 py-2 align-top";

interface Col<T> {
  head: string;
  cell: (x: T) => ReactNode;
  /** Masaüstü hücre sınıfı (genişlik/kırpma). */
  className?: string;
}

/**
 * Ayrıntı tablosu (TEST-P8-1): ≥ xl tablo (tam genişlik bölümde; yine taşarsa odaklanabilir yatay kaydırma kabı),
 * daha dar alanda (kenar menüsüyle 1024 px'te tablo sığmıyor) aynı veri kart ızgarası (`<dl>`, sm+ iki sütun) — iç kaydırma yok.
 */
function DataTable<T extends { id: string }>({ label, testId, rowTestId, items, cols }: { label: string; testId: string; rowTestId: string; items: T[]; cols: Col<T>[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring xl:block" tabIndex={0} role="region" aria-label={label} data-testid={`${testId}-scroll`}>
        <table className="w-full text-left text-sm" data-testid={testId}>
          <thead className="bg-surface-muted text-xs text-fg-muted">
            <tr>{cols.map((c) => <th key={c.head} scope="col" className={th}>{c.head}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((x) => (
              <tr key={x.id} data-testid={rowTestId}>
                {cols.map((c) => <td key={c.head} className={`${td} ${c.className ?? ""}`}>{c.cell(x)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:hidden" aria-label={label} data-testid={`${testId}-cards`}>
        {items.map((x) => (
          <li key={x.id} className="rounded-lg border border-border bg-surface p-3 text-sm" data-testid={`${rowTestId}-card`}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
              {cols.map((c) => (
                <div key={c.head} className="contents">
                  <dt className="text-fg-muted">{c.head}</dt>
                  <dd className="min-w-0 text-fg wrap-anywhere">{c.cell(x)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

type Consent = D["consents"][number];
type FileMeta = D["files"][number];

export function ConsentsList({ s }: { s: D }) {
  if (s.consents.length === 0) return <Muted testId="consents-empty">{t("h.c.empty")}</Muted>;
  const cols: Col<Consent>[] = [
    { head: t("h.c.at"), cell: (c) => <span className="tabular-nums">{formatDateTime(c.at)}</span>, className: "whitespace-nowrap" },
    { head: t("h.c.level"), cell: (c) => labelOf(CONSENT_LEVEL_LABELS, c.level) },
    { head: t("h.c.decision"), cell: (c) => labelOf(CONSENT_DECISION_LABELS, c.decision) },
    { head: t("h.c.source"), cell: (c) => labelOf(CONSENT_SOURCE_LABELS, c.source) },
    {
      head: t("h.c.text"),
      className: "whitespace-nowrap",
      cell: (c) =>
        c.consentText ? (
          <span title={`SHA-256 ${c.consentText.sha256}`}>
            {t("h.c.textVersion", { version: c.consentText.version })}{" "}
            <span className="font-mono text-xs text-fg-muted">{c.consentText.sha256.slice(0, 12)}…</span>
          </span>
        ) : none,
    },
  ];
  return <DataTable label={t("h.c.title")} testId="consents" rowTestId="consent-row" items={s.consents} cols={cols} />;
}

function Elevated({ v }: { v: boolean | null }) {
  if (v === true)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-0.5 text-xs font-medium text-warning" data-testid="self-elevated">
        <ShieldUser aria-hidden className="size-4" />
        {SELF_ELEVATED_WARNING}
      </span>
    );
  if (v === null) return <span className="text-xs text-fg-muted">{SELF_ELEVATED_UNKNOWN}</span>;
  return null;
}

/** Kontrol dönemleri (P7 verisi): verildi → kapandı, kapatan (TECH/HOTKEY/UI/SYSTEM/RECONNECT), neden, selfElevated. */
export function ControlPeriods({ s }: { s: D }) {
  if (s.mode === "BROWSER") return <Muted testId="control-browser">{t("h.k.browser")}</Muted>;
  if (s.controlPeriods.length === 0) return <Muted testId="control-empty">{t("h.k.empty")}</Muted>;
  return (
    <ol className="flex flex-col gap-3">
      {s.controlPeriods.map((p, i) => (
        <li key={p.grantedAt + i} className="rounded-md border border-border bg-surface p-3 text-sm" data-testid="control-period">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-fg">{t("h.k.period", { n: i + 1 })}</h3>
            <Elevated v={p.selfElevated} />
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">{t("h.k.granted")}</dt>
            <dd className="tabular-nums text-fg">{formatDateTime(p.grantedAt)}</dd>
            <dt className="text-fg-muted">{t("h.k.revoked")}</dt>
            <dd className="text-fg">
              {p.revokedAt ? (
                <span className="tabular-nums">{formatDateTime(p.revokedAt)}</span>
              ) : (
                <span data-testid="no-close">
                  <span className="font-medium text-warning">{t("h.k.noClose")}</span>
                  <span className="block text-xs text-fg-muted">{t("h.k.noCloseHint")}</span>
                </span>
              )}
            </dd>
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
          </dl>
        </li>
      ))}
    </ol>
  );
}

/** Zaman çizelgesi: Türkçe etiket (contracts labels.ts), bilinmeyen action ham. Metinler React metin düğümü (HTML yok). */
export function Timeline({ s }: { s: D }) {
  if (s.timeline.length === 0) return <Muted testId="timeline-empty">{t("h.t.empty")}</Muted>;
  return (
    <>
      {s.timelineTruncated && <p className="mb-3 text-sm font-medium text-warning" role="status" data-testid="timeline-truncated">{t("h.t.truncated")}</p>}
      <ol className="relative flex flex-col gap-3 border-l border-border pl-4" data-testid="timeline">
        {s.timeline.map((e, i) => {
          const v = describeTimelineEvent(e);
          const who = `${labelOf(SESSION_ENDED_BY_LABELS, e.actor)}${e.actorName ? ` · ${e.actorName}` : ""}`;
          return (
            <li key={`${e.at}-${i}`} className="text-sm" data-testid="timeline-event" data-action={e.action}>
              <span aria-hidden className={`absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-surface ${e.result === "fail" ? "bg-danger" : "bg-primary"}`} />
              <p className="flex flex-wrap items-baseline gap-x-2">
                <time dateTime={e.at} className="tabular-nums text-fg-muted">{formatTimeSeconds(e.at)}</time>
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
        })}
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

export function Files({ s }: { s: D }) {
  if (s.files.length === 0) return <Muted testId="files-empty">{t("h.file.empty")}</Muted>;
  const cols: Col<FileMeta>[] = [
    { head: t("h.file.at"), cell: (f) => <span className="tabular-nums">{formatDateTime(f.createdAt)}</span>, className: "whitespace-nowrap" },
    {
      head: t("h.file.dir"),
      className: "whitespace-nowrap",
      cell: (f) => (
        <span className="inline-flex items-center gap-1.5">
          {f.direction === "TO_CUSTOMER" ? <Upload aria-hidden className="size-4 text-fg-muted" /> : <Download aria-hidden className="size-4 text-fg-muted" />}
          {labelOf(FILE_DIRECTION_LABELS, f.direction)}
        </span>
      ),
    },
    // Sığmayan uzun ad sözcük sınırında, gerekirse içinde kırılır; sütun hiç 1 harfe inmez (min-w-48).
    { head: t("h.file.name"), cell: (f) => <span data-testid="file-name">{f.fileName}</span>, className: "min-w-48 wrap-break-word" },
    { head: t("h.file.size"), cell: (f) => <span className="tabular-nums">{formatBytes(f.sizeBytes)}</span>, className: "whitespace-nowrap" },
    {
      head: t("h.file.result"),
      cell: (f) => <span className={f.result === "OK" ? "text-success" : f.result === "CORRUPT" ? "text-danger" : "text-fg"}>{labelOf(FILE_RESULT_LABELS, f.result)}</span>,
    },
    { head: t("h.file.sha"), cell: (f) => <CopyHash value={f.sha256} testId="file-sha" />, className: "whitespace-nowrap" },
  ];
  return <DataTable label={t("h.file.title")} testId="files" rowTestId="file-meta-row" items={s.files} cols={cols} />;
}
