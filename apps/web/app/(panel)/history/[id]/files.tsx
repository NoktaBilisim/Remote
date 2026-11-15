import {
  CONSENT_DECISION_LABELS,
  CONSENT_LEVEL_LABELS,
  CONSENT_SOURCE_LABELS,
  FILE_DIRECTION_LABELS,
  FILE_RESULT_LABELS,
  fileVerificationLabel,
  labelOf,
} from "@remote/contracts/labels";
import { CircleAlert, Download, ShieldCheck, Upload } from "lucide-react";
import { formatBytes, formatDateTime } from "@/lib/format";
import { isAnonymized } from "@/lib/history/anonymized";
import { t } from "@/lib/i18n";
import { CopyHash } from "./copy-hash";
import { DataTable, type Col } from "./data-table";
import { Muted, none, type D } from "./sections";

type Consent = D["consents"][number];
type FileMeta = D["files"][number];

function ConsentTextCell({ c }: { c: Consent }) {
  if (!c.consentText) return none;
  return (
    <span title={`SHA-256 ${c.consentText.sha256}`}>
      {t("h.c.textVersion", { version: c.consentText.version })}{" "}
      <span className="font-mono text-xs text-fg-muted">{c.consentText.sha256.slice(0, 12)}…</span>
    </span>
  );
}

const consentCols = (): Col<Consent>[] => [
  { head: t("h.c.at"), cell: (c) => <span className="tabular-nums">{formatDateTime(c.at)}</span>, className: "whitespace-nowrap" },
  { head: t("h.c.level"), cell: (c) => labelOf(CONSENT_LEVEL_LABELS, c.level) },
  { head: t("h.c.decision"), cell: (c) => labelOf(CONSENT_DECISION_LABELS, c.decision) },
  { head: t("h.c.source"), cell: (c) => labelOf(CONSENT_SOURCE_LABELS, c.source) },
  { head: t("h.c.text"), className: "whitespace-nowrap", cell: (c) => <ConsentTextCell c={c} /> },
];

export function ConsentsList({ s }: { s: D }) {
  if (s.consents.length === 0) return <Muted testId="consents-empty">{t("h.c.empty")}</Muted>;
  return <DataTable label={t("h.c.title")} testId="consents" rowTestId="consent-row" items={s.consents} cols={consentCols()} />;
}

/**
 * P15 (AC-238): teknisyen raporlu ya da iki tarafça eşleşen satır "Doğrulanmış" (`success`); yalnız müşterinin bildirdiği
 * satır "Müşteri bildirimi" (`warning` — sunucu teknisyen tarafından doğrulamadı). Metin + ikon, renk tek başına değil.
 */
function FileVerification({ verified }: { verified: boolean }) {
  return (
    <span
      data-testid="file-verified"
      data-verified={verified ? "true" : "false"}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        verified ? "bg-success-surface text-success" : "bg-warning-surface text-warning"
      }`}
    >
      {verified ? <ShieldCheck aria-hidden className="size-4" /> : <CircleAlert aria-hidden className="size-4" />}
      {fileVerificationLabel(verified)}
    </span>
  );
}

function DirectionCell({ f }: { f: FileMeta }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {f.direction === "TO_CUSTOMER" ? (
        <Upload aria-hidden className="size-4 text-fg-muted" />
      ) : (
        <Download aria-hidden className="size-4 text-fg-muted" />
      )}
      {labelOf(FILE_DIRECTION_LABELS, f.direction)}
    </span>
  );
}

/** P15 (AC-238): sonuç + doğrulama etiketi aynı hücrede (≥ 1280 px'te tablo taşmasın). */
function ResultCell({ f }: { f: FileMeta }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={f.result === "OK" ? "text-success" : f.result === "CORRUPT" ? "text-danger" : "text-fg"}>
        {labelOf(FILE_RESULT_LABELS, f.result)}
      </span>
      <FileVerification verified={f.verified} />
    </span>
  );
}

const fileCols = (): Col<FileMeta>[] => [
  {
    head: t("h.file.at"),
    cell: (f) => <span className="tabular-nums">{formatDateTime(f.createdAt)}</span>,
    className: "whitespace-nowrap",
  },
  { head: t("h.file.dir"), className: "whitespace-nowrap", cell: (f) => <DirectionCell f={f} /> },
  // Sığmayan uzun ad sözcük sınırında, gerekirse içinde kırılır; sütun hiç 1 harfe inmez (min-w-48).
  { head: t("h.file.name"), cell: (f) => <span data-testid="file-name">{f.fileName}</span>, className: "min-w-48 wrap-break-word" },
  { head: t("h.file.size"), cell: (f) => <span className="tabular-nums">{formatBytes(f.sizeBytes)}</span>, className: "whitespace-nowrap" },
  { head: t("h.file.result"), cell: (f) => <ResultCell f={f} /> },
  { head: t("h.file.sha"), cell: (f) => <CopyHash value={f.sha256} testId="file-sha" />, className: "whitespace-nowrap" },
];

export function Files({ s }: { s: D }) {
  if (s.files.length === 0) return <Muted testId="files-empty">{t(isAnonymized(s) ? "h.anon.files" : "h.file.empty")}</Muted>;
  return <DataTable label={t("h.file.title")} testId="files" rowTestId="file-meta-row" items={s.files} cols={fileCols()} />;
}
