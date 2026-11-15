"use client";

import { CircleAlert, Download, RefreshCw, Upload } from "lucide-react";
import type { CustomerImportConflictMode, ImportPreview } from "@remote/contracts/api/customers";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { downloadErrorReport, type ImportWizardState } from "./use-import-wizard";

const KIND_CLS = {
  create: "bg-success-surface text-success",
  conflict: "bg-warning-surface text-warning",
  error: "bg-danger-surface text-danger",
} as const;
const pill = "inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap";
const COLS = [
  "cu.imp.col.line",
  "cu.imp.col.kind",
  "cu.imp.col.name",
  "cu.imp.col.contact",
  "cu.imp.col.phone",
  "cu.imp.col.email",
] as const;

function Counts({ p }: { p: ImportPreview }) {
  const counts = [
    ["total", t("cu.imp.total"), p.total],
    ["create", t("cu.imp.k.create"), p.counts.create],
    ["conflict", t("cu.imp.k.conflict"), p.counts.conflict],
    ["error", t("cu.imp.k.error"), p.counts.error],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="import-counts">
      {counts.map(([k, label, n]) => (
        <div key={k} className="rounded-lg border border-border bg-surface p-3" data-testid={`import-count-${k}`}>
          <dt className="text-xs text-fg-muted">{label}</dt>
          <dd className="text-xl font-semibold text-fg tabular-nums">{formatNumber(n)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** İlk satırlar (en çok 50): satır no, tür rozeti, ad, yetkili, telefon, e-posta. */
function RowsTable({ p }: { p: ImportPreview }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[36rem] text-left text-sm" data-testid="import-rows">
        <caption className="sr-only">{t("cu.imp.rowsCaption", { n: p.rows.length })}</caption>
        <thead className="bg-surface-muted text-xs text-fg-muted">
          <tr>
            {COLS.map((k) => (
              <th key={k} scope="col" className="px-3 py-2 font-medium">
                {t(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.line} className="border-t border-border">
              <td className="px-3 py-2 tabular-nums text-fg-muted">{r.line}</td>
              <td className="px-3 py-2">
                <span className={`${pill} ${KIND_CLS[r.kind]}`}>{t(`cu.imp.k.${r.kind}`)}</span>
              </td>
              <td className="max-w-48 truncate px-3 py-2 text-fg">{r.name}</td>
              <td className="max-w-40 truncate px-3 py-2 text-fg-muted">{r.contactName ?? "—"}</td>
              <td className="px-3 py-2 text-fg-muted tabular-nums">{r.phone ?? "—"}</td>
              <td className="max-w-48 truncate px-3 py-2 text-fg-muted">{r.email ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Hatalı satırlar (ilk 20) + CSV hata raporu. */
function ErrorsBox({ p }: { p: ImportPreview }) {
  return (
    <section aria-labelledby="imp-err-h" className="rounded-lg border border-border bg-surface p-4" data-testid="import-errors">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="imp-err-h" className="flex items-center gap-2 text-base font-semibold text-fg">
          <CircleAlert aria-hidden className="size-5 text-danger" />
          {t("cu.imp.errTitle", { n: formatNumber(p.counts.error) })}
        </h2>
        <Button variant="secondary" onClick={() => downloadErrorReport(p.errors)} data-testid="import-error-report">
          <Download aria-hidden className="size-4" />
          {t("cu.imp.errReport")}
        </Button>
      </div>
      <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
        {p.errors.slice(0, 20).map((e, i) => (
          <li key={i} className="text-fg">
            <span className="tabular-nums text-fg-muted">{t("cu.imp.errLine", { line: e.line })}</span>
            {e.column && <span className="text-fg-muted"> · {e.column}</span>}: {e.message}
          </li>
        ))}
      </ul>
      {(p.errors.length > 20 || p.errorsTruncated) && <p className="mt-2 text-xs text-fg-muted">{t("cu.imp.errMore")}</p>}
    </section>
  );
}

function ModeOption({ m, w, canEdit }: { m: CustomerImportConflictMode; w: ImportWizardState; canEdit: boolean }) {
  const disabled = m === "update" && !canEdit;
  return (
    <label
      className={`flex min-h-11 items-start gap-3 rounded-md px-2 py-2 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-muted"}`}
    >
      <input
        type="radio"
        name="onConflict"
        value={m}
        checked={w.mode === m}
        disabled={disabled || w.busy}
        onChange={() => w.setMode(m)}
        className="mt-0.5 size-5 accent-primary"
        data-testid={`import-mode-${m}`}
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium text-fg">{t(`cu.imp.mode.${m}`)}</span>
        <span className="text-xs text-fg-muted">{disabled ? t("cu.imp.mode.needEdit") : t(`cu.imp.mode.${m}Desc`)}</span>
      </span>
    </label>
  );
}

/** Çakışan kayıtlar: atla / güncelle (güncelleme `customers.edit` ister). */
function ConflictModes({ w, canEdit }: { w: ImportWizardState; canEdit: boolean }) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4" data-testid="import-conflict">
      <legend className="px-1 text-sm font-medium text-fg">{t("cu.imp.conflictLegend")}</legend>
      {(["skip", "update"] as const).map((m) => (
        <ModeOption key={m} m={m} w={w} canEdit={canEdit} />
      ))}
    </fieldset>
  );
}

/** 2. adım: özet sayılar, uyarılar, satırlar, hatalar, çakışma seçimi ve "İçe aktar". */
export function PreviewStep({ w, p, canEdit }: { w: ImportWizardState; p: ImportPreview; canEdit: boolean }) {
  return (
    <section className="flex flex-col gap-4" data-testid="import-step-preview">
      <Counts p={p} />
      {p.warnings.length > 0 && (
        <Alert tone="warning" testId="import-warnings">
          <ul className="list-disc pl-4">
            {p.warnings.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Alert>
      )}
      <RowsTable p={p} />
      {p.total > p.rows.length && <p className="text-xs text-fg-muted">{t("cu.imp.rowsMore", { n: formatNumber(p.rows.length) })}</p>}
      {p.errors.length > 0 && <ErrorsBox p={p} />}
      {p.counts.conflict > 0 && <ConflictModes w={w} canEdit={canEdit} />}
      {w.commitError && (
        <Alert tone="danger" testId="import-commit-error">
          {w.commitError}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void w.commit()}
          loading={w.busy}
          disabled={p.counts.create + p.counts.conflict === 0}
          data-testid="import-commit"
        >
          {!w.busy && <Upload aria-hidden className="size-4" />}
          {t("cu.imp.commit")}
        </Button>
        <Button variant="ghost" onClick={w.restart} disabled={w.busy} data-testid="import-restart">
          <RefreshCw aria-hidden className="size-4" />
          {t("cu.imp.otherFile")}
        </Button>
      </div>
    </section>
  );
}
