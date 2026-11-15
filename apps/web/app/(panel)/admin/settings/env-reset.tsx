"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

/** "Ortam değerlerine dön" düğmesi (yalnız panel kaydı varken gösterilir; çağıran karar verir). */
export function EnvResetButton({ label, busy, onClick, testId }: { label: string; busy: boolean; onClick: () => void; testId: string }) {
  return (
    <div>
      <Button type="button" variant="danger-ghost" disabled={busy} onClick={onClick} data-testid={testId}>
        <RotateCcw aria-hidden className="size-4" />
        {label}
      </Button>
    </div>
  );
}

/** "Ortam değerlerine dön" onayı: `alertdialog`, odak Vazgeç'te; işlem sürerken kapanmaz. */
export function EnvResetDialog({
  open,
  busy,
  onCancel,
  onConfirm,
  texts,
  testId,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  texts: { title: string; body: string; action: string };
  testId: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      role="alertdialog"
      size="sm"
      testId={`${testId}-dialog`}
      title={texts.title}
      description={texts.body}
      footer={
        <>
          <Button variant="secondary" data-autofocus disabled={busy} className="sm:ml-auto" onClick={onCancel}>
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm} data-testid={`${testId}-confirm`}>
            {!busy && <RotateCcw aria-hidden className="size-4" />}
            {texts.action}
          </Button>
        </>
      }
    />
  );
}
