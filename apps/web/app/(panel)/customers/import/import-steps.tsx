"use client";

import { ArrowLeft, CircleCheck, FileSpreadsheet, FileUp, Upload, Users } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import { CUSTOMER_IMPORT_MAX_ROWS, type ImportResult } from "@remote/contracts/api/customers";
import { Button } from "@/components/ui/button";
import { IMPORT_ACCEPT } from "@/lib/customers/import";
import { formatBytes, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ImportWizardState, Step } from "./use-import-wizard";

export function StepNav({ step }: { step: Step }) {
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

type FileProps = { w: ImportWizardState; inputId: string; inputRef: RefObject<HTMLInputElement | null> };

/** Sürükle-bırak alanı (görünmez dosya girişini saran etiket; klavyede odak halkası). */
function DropZone({ w, inputId, inputRef }: FileProps) {
  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        w.setDrag(true);
      }}
      onDragLeave={() => w.setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        w.setDrag(false);
        w.pick(e.dataTransfer.files[0]);
      }}
      className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
        w.drag ? "border-primary bg-primary-surface" : "border-border bg-canvas hover:bg-surface-muted"
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
        aria-invalid={w.fileError ? true : undefined}
        aria-describedby={w.fileError ? `${inputId}-e` : undefined}
        onChange={(e) => w.pick(e.target.files?.[0])}
        data-testid="import-file"
      />
    </label>
  );
}

/** 1. adım: dosya seçimi (≤ 2 MB), seçilen dosya adı, hata ve "Önizle". */
export function FileStep(props: FileProps) {
  const { w, inputId } = props;
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6" data-testid="import-step-file">
      <p className="text-sm text-fg-muted">{t("cu.imp.fileBody", { rows: formatNumber(CUSTOMER_IMPORT_MAX_ROWS) })}</p>
      <DropZone {...props} />
      {w.file && (
        <p className="flex items-center gap-2 text-sm text-fg" data-testid="import-file-name">
          <FileSpreadsheet aria-hidden className="size-4 text-fg-muted" />
          <span className="min-w-0 truncate">{w.file.name}</span>
          <span className="text-fg-muted tabular-nums">({formatBytes(w.file.size)})</span>
        </p>
      )}
      {w.fileError && (
        <p id={`${inputId}-e`} role="alert" className="text-sm font-medium text-danger" data-testid="import-file-error">
          {w.fileError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void w.upload()}
          loading={w.busy}
          disabled={!w.file || Boolean(w.fileError)}
          data-testid="import-preview-btn"
        >
          {!w.busy && <Upload aria-hidden className="size-4" />}
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
  );
}

/** 3. adım: sonuç sayıları, listeye dönüş ve yeni içe aktarma. */
export function DoneStep({ result, onRestart }: { result: ImportResult; onRestart: () => void }) {
  const counts = [
    ["created", t("cu.imp.r.created"), result.created],
    ["updated", t("cu.imp.r.updated"), result.updated],
    ["skipped", t("cu.imp.r.skipped"), result.skipped],
    ["failed", t("cu.imp.r.failed"), result.failed],
  ] as const;
  return (
    <section
      className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm"
      data-testid="import-step-done"
      role="status"
    >
      <CircleCheck aria-hidden className="size-8 text-success" />
      <h2 className="text-xl font-semibold text-fg">{t("cu.imp.doneTitle")}</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" data-testid="import-result">
        {counts.map(([k, label, n]) => (
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
        <Button variant="secondary" onClick={onRestart}>
          <FileUp aria-hidden className="size-4" />
          {t("cu.imp.again")}
        </Button>
      </div>
    </section>
  );
}
