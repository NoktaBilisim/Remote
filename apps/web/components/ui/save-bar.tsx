"use client";

import { CircleAlert, RotateCcw, Save } from "lucide-react";
import { LeaveDialog } from "@/components/leave-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { useLeaveGuard } from "@/lib/use-leave-guard";

/**
 * Kaydedilmemiş değişiklik çubuğu (DESIGN §6.1 `ui/save-bar.tsx`, P9): form kirliyken sayfanın altında yapışkan
 * (`sticky bottom-4`, `shadow-lg`) "Vazgeç / Kaydet" + ayrılma uyarısı (`useLeaveGuard`: sekme kapatma, uygulama içi
 * bağlantı, geri tuşu → `LeaveDialog`, odak "Sayfada kal"). Kaydet bir `<form>`'un submit düğmesidir (`form` id).
 * Temizken çubuk görünmez (yer kaplamaz). `role=region` + etiket: ekran okuyucu bölgeye atlayabilir.
 */
export function SaveBar({
  dirty,
  busy,
  formId,
  onReset,
  message,
  leaveBody,
  testId = "save-bar",
  saveLabel,
}: {
  dirty: boolean;
  busy: boolean;
  formId: string;
  onReset: () => void;
  message: string;
  leaveBody: string;
  testId?: string;
  /** P11: Kaydet düğmesinin metni (vars. "Kaydet"; ör. "Yeni sürüm olarak kaydet"). */
  saveLabel?: string;
}) {
  const guard = useLeaveGuard(dirty && !busy);
  return (
    <>
      {dirty && (
        <div
          role="region"
          aria-label={t("sb.region")}
          data-testid={testId}
          className="sticky bottom-4 z-20 mt-6 flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg sm:flex-row sm:items-center"
        >
          <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-fg">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
            {message}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={onReset} disabled={busy} data-testid={`${testId}-reset`}>
              <RotateCcw aria-hidden className="size-4" />
              {t("sb.reset")}
            </Button>
            <Button type="submit" form={formId} loading={busy} data-testid={`${testId}-save`}>
              {!busy && <Save aria-hidden className="size-4" />}
              {saveLabel ?? t("sb.save")}
            </Button>
          </div>
        </div>
      )}
      <LeaveDialog guard={guard} body={leaveBody} />
    </>
  );
}
