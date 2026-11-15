"use client";

import { ArrowLeft, CircleAlert, CircleCheck, Download, FileSpreadsheet, FileUp, RefreshCw, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import {
  CUSTOMER_IMPORT_MAX_ROWS,
  type CustomerImportConflictMode,
  type ImportPreview,
  type ImportResult,
} from "@remote/contracts/api/customers";
import { LeaveDialog } from "@/components/leave-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { checkImportFile, errorReportCsv, IMPORT_ACCEPT, importFailure } from "@/lib/customers/import";
import { formatBytes, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/use-leave-guard";

type Step = "file" | "preview" | "done";
const KIND_CLS = {
  create: "bg-success-surface text-success",
  conflict: "bg-warning-surface text-warning",
  error: "bg-danger-surface text-danger",
} as const;
const pill = "inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap";

function StepNav({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ["file", t("cu.imp.s1")],
    ["preview", t("cu.imp.s2")],
    ["done", t("cu.imp.s3")],
  ];
  const at = steps.findIndex(([s]) => s === step);
  return (
    <ol className="mt-6 flex flex-wrap gap-2 text-sm" aria-label={t("cu.imp.steps")} data-testid="import-steps">
      {steps.map(([s, label], i) => (
        <li
          key={s}
          aria-current={s === step ? "step" : undefined}
          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 ${
            s === step ? "border-primary bg-primary-surface font-medium text-primary" : "border-border text-fg-muted"
          }`}
        >
          <span className="tabular-nums">{i + 1}.</span>
          {label}
          {i < at && <CircleCheck aria-hidden className="size-4 text-success" />}
        </li>
      ))}
    </ol>
  );
}

/** Üç adımlı içe aktarma (AC-263): dosya (sürükle-bırak, ≤ 2 MB) → önizleme (özet, ilk 50 satır, hatalar) → sonuç. */
export function ImportWizard({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<CustomerImportConflictMode>("skip");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const guard = useLeaveGuard(step === "preview" && !busy);

  const unauth = (e: unknown) => {
    if (!isUnauthenticated(e)) return false;
    router.replace(EXPIRED_LOGIN_PATH);
    return true;
  };

  const pick = (f: File | null | undefined) => {
    setFile(f ?? null);
    setFileError(f ? checkImportFile(f) : null);
  };

  const upload = async () => {
    const err = checkImportFile(file);
    if (err || !file) return setFileError(err);
    setBusy(true);
    setFileError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const p = await api<ImportPreview>("POST", "/customers/import/preview", fd);
      setPreview(p);
      setMode("skip");
      setCommitError(null);
      setStep("preview");
    } catch (e) {
      if (!unauth(e)) setFileError(importFailure(e, t("err.generic")).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setCommitError(null);
    try {
      const r = await api<ImportResult>("POST", "/customers/import/commit", { previewId: preview.previewId, onConflict: mode });
      setResult(r);
      setStep("done");
      toast(t("cu.imp.doneToast", { n: formatNumber(r.created + r.updated) }));
      router.refresh();
    } catch (e) {
      if (unauth(e)) return;
      const f = importFailure(e, t("err.generic"));
      if (f.kind === "previewExpired") {
        setPreview(null);
        setStep("file");
        setFileError(f.message);
      } else setCommitError(f.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([errorReportCsv(preview.errors)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ice-aktarma-hatalari.csv";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const restart = () => {
    setStep("file");
    setPreview(null);
    setResult(null);
    setFile(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <StepNav step={step} />

      {step === "file" && (
        <section
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
          data-testid="import-step-file"
        >
          <p className="text-sm text-fg-muted">{t("cu.imp.fileBody", { rows: formatNumber(CUSTOMER_IMPORT_MAX_ROWS) })}</p>
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
              drag ? "border-primary bg-primary-surface" : "border-border bg-canvas hover:bg-surface-muted"
            }`}
            data-testid="import-dropzone"
          >
            <FileUp aria-hidden className="size-8 text-fg-muted" />
            <span className="text-sm font-medium text-fg">{t("cu.imp.drop")}</span>
            <span className="text-xs text-fg-muted">{t("cu.imp.dropHint")}</span>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={IMPORT_ACCEPT}
              className="sr-only"
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? `${inputId}-e` : undefined}
              onChange={(e) => pick(e.target.files?.[0])}
              data-testid="import-file"
            />
          </label>
          {file && (
            <p className="flex items-center gap-2 text-sm text-fg" data-testid="import-file-name">
              <FileSpreadsheet aria-hidden className="size-4 text-fg-muted" />
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="text-fg-muted tabular-nums">({formatBytes(file.size)})</span>
            </p>
          )}
          {fileError && (
            <p id={`${inputId}-e`} role="alert" className="text-sm font-medium text-danger" data-testid="import-file-error">
              {fileError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void upload()} loading={busy} disabled={!file || Boolean(fileError)} data-testid="import-preview-btn">
              {!busy && <Upload aria-hidden className="size-4" />}
              {t("cu.imp.previewBtn")}
            </Button>
            <Link
              href="/customers"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary hover:underline"
            >
              <ArrowLeft aria-hidden className="size-4" />
              {t("cu.imp.back")}
            </Link>
          </div>
        </section>
      )}

      {step === "preview" && preview && (
        <section className="flex flex-col gap-4" data-testid="import-step-preview">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="import-counts">
            {(
              [
                ["total", t("cu.imp.total"), preview.total],
                ["create", t("cu.imp.k.create"), preview.counts.create],
                ["conflict", t("cu.imp.k.conflict"), preview.counts.conflict],
                ["error", t("cu.imp.k.error"), preview.counts.error],
              ] as const
            ).map(([k, label, n]) => (
              <div key={k} className="rounded-lg border border-border bg-surface p-3" data-testid={`import-count-${k}`}>
                <dt className="text-xs text-fg-muted">{label}</dt>
                <dd className="text-xl font-semibold text-fg tabular-nums">{formatNumber(n)}</dd>
              </div>
            ))}
          </dl>
          {preview.warnings.length > 0 && (
            <Alert tone="warning" testId="import-warnings">
              <ul className="list-disc pl-4">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[36rem] text-left text-sm" data-testid="import-rows">
              <caption className="sr-only">{t("cu.imp.rowsCaption", { n: preview.rows.length })}</caption>
              <thead className="bg-surface-muted text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("cu.imp.col.line")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("cu.imp.col.kind")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("cu.imp.col.name")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("cu.imp.col.contact")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("cu.imp.col.phone")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("cu.imp.col.email")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
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
          {preview.total > preview.rows.length && (
            <p className="text-xs text-fg-muted">{t("cu.imp.rowsMore", { n: formatNumber(preview.rows.length) })}</p>
          )}

          {preview.errors.length > 0 && (
            <section aria-labelledby="imp-err-h" className="rounded-lg border border-border bg-surface p-4" data-testid="import-errors">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 id="imp-err-h" className="flex items-center gap-2 text-base font-semibold text-fg">
                  <CircleAlert aria-hidden className="size-5 text-danger" />
                  {t("cu.imp.errTitle", { n: formatNumber(preview.counts.error) })}
                </h2>
                <Button variant="secondary" onClick={downloadReport} data-testid="import-error-report">
                  <Download aria-hidden className="size-4" />
                  {t("cu.imp.errReport")}
                </Button>
              </div>
              <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <li key={i} className="text-fg">
                    <span className="tabular-nums text-fg-muted">{t("cu.imp.errLine", { line: e.line })}</span>
                    {e.column && <span className="text-fg-muted"> · {e.column}</span>}: {e.message}
                  </li>
                ))}
              </ul>
              {(preview.errors.length > 20 || preview.errorsTruncated) && (
                <p className="mt-2 text-xs text-fg-muted">{t("cu.imp.errMore")}</p>
              )}
            </section>
          )}

          {preview.counts.conflict > 0 && (
            <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4" data-testid="import-conflict">
              <legend className="px-1 text-sm font-medium text-fg">{t("cu.imp.conflictLegend")}</legend>
              {(["skip", "update"] as const).map((m) => {
                const disabled = m === "update" && !canEdit;
                return (
                  <label
                    key={m}
                    className={`flex min-h-11 items-start gap-3 rounded-md px-2 py-2 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-muted"}`}
                  >
                    <input
                      type="radio"
                      name="onConflict"
                      value={m}
                      checked={mode === m}
                      disabled={disabled || busy}
                      onChange={() => setMode(m)}
                      className="mt-0.5 size-5 accent-primary"
                      data-testid={`import-mode-${m}`}
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-fg">{t(`cu.imp.mode.${m}`)}</span>
                      <span className="text-xs text-fg-muted">{disabled ? t("cu.imp.mode.needEdit") : t(`cu.imp.mode.${m}Desc`)}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {commitError && (
            <Alert tone="danger" testId="import-commit-error">
              {commitError}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void commit()}
              loading={busy}
              disabled={preview.counts.create + preview.counts.conflict === 0}
              data-testid="import-commit"
            >
              {!busy && <Upload aria-hidden className="size-4" />}
              {t("cu.imp.commit")}
            </Button>
            <Button variant="ghost" onClick={restart} disabled={busy} data-testid="import-restart">
              <RefreshCw aria-hidden className="size-4" />
              {t("cu.imp.otherFile")}
            </Button>
          </div>
        </section>
      )}

      {step === "done" && result && (
        <section
          className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm"
          data-testid="import-step-done"
          role="status"
        >
          <CircleCheck aria-hidden className="size-8 text-success" />
          <h2 className="text-xl font-semibold text-fg">{t("cu.imp.doneTitle")}</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" data-testid="import-result">
            {(
              [
                ["created", t("cu.imp.r.created"), result.created],
                ["updated", t("cu.imp.r.updated"), result.updated],
                ["skipped", t("cu.imp.r.skipped"), result.skipped],
                ["failed", t("cu.imp.r.failed"), result.failed],
              ] as const
            ).map(([k, label, n]) => (
              <div key={k} data-testid={`import-result-${k}`}>
                <dt className="text-fg-muted">{label}</dt>
                <dd className="text-lg font-semibold text-fg tabular-nums">{formatNumber(n)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link
              href="/customers"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover"
            >
              <Users aria-hidden className="size-4" />
              {t("cu.imp.toList")}
            </Link>
            <Button variant="secondary" onClick={restart}>
              <FileUp aria-hidden className="size-4" />
              {t("cu.imp.again")}
            </Button>
          </div>
        </section>
      )}
      <LeaveDialog guard={guard} body={t("cu.imp.leaveBody")} />
    </div>
  );
}
