"use client";

import { useId, useRef } from "react";
import { LeaveDialog } from "@/components/leave-dialog";
import { t } from "@/lib/i18n";
import { PreviewStep } from "./import-preview";
import { DoneStep, FileStep, StepNav } from "./import-steps";
import { useImportWizard } from "./use-import-wizard";

/** Üç adımlı içe aktarma (AC-263): dosya (sürükle-bırak, ≤ 2 MB) → önizleme (özet, ilk 50 satır, hatalar) → sonuç. */
export function ImportWizard({ canEdit }: { canEdit: boolean }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const w = useImportWizard(inputRef);
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <StepNav step={w.step} />
      {w.step === "file" && <FileStep w={w} inputId={inputId} inputRef={inputRef} />}
      {w.step === "preview" && w.preview && <PreviewStep w={w} p={w.preview} canEdit={canEdit} />}
      {w.step === "done" && w.result && <DoneStep result={w.result} onRestart={w.restart} />}
      <LeaveDialog guard={w.guard} body={t("cu.imp.leaveBody")} />
    </div>
  );
}
