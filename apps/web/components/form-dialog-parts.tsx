"use client";

import { Save, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";

/**
 * Diyalog formunu kapatma nöbetçisi: gönderim sürerken kapanmaz; kirli formda önce onay (`confirmClose`) açılır.
 * `leave` onayı kapatıp formu kapatır, `stay` yalnız onayı kapatır.
 */
export function useCloseGuard(dirty: boolean, busy: boolean, onClose: () => void) {
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  const stay = () => setConfirmClose(false);
  const leave = () => {
    setConfirmClose(false);
    onClose();
  };
  return { confirmClose, requestClose, stay, leave };
}

/** Kaydedilmemiş formu kapatma onayı: "Düzenlemeye dön" varsayılan odak, "Kaydetmeden kapat" ikincil (yıkıcı). */
export function FormLeaveDialog({
  guard,
  testId,
  title,
  body,
  stayLabel,
}: {
  guard: ReturnType<typeof useCloseGuard>;
  testId: string;
  title: string;
  body: string;
  stayLabel: string;
}) {
  return (
    <Dialog
      open={guard.confirmClose}
      onClose={guard.stay}
      role="alertdialog"
      size="sm"
      testId={testId}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={guard.stay} className="sm:ml-auto">
            {stayLabel}
          </Button>
          <Button variant="danger-ghost" onClick={guard.leave}>
            {t("h.n.discard")}
          </Button>
        </>
      }
    />
  );
}

/** Diyalog formu alt çubuğu: "Vazgeç" (kapatma nöbetçisi) + kaydet/oluştur (gönderimde bekleme çarkı; ikon varsayılan `Save`). */
export function FormDialogActions({
  busy,
  onCancel,
  submitLabel,
  submitTestId,
  Icon = Save,
}: {
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
  submitTestId: string;
  Icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
      <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
        {t("rq.rj.cancel")}
      </Button>
      <Button type="submit" loading={busy} data-testid={submitTestId}>
        {!busy && <Icon aria-hidden className="size-4" />}
        {submitLabel}
      </Button>
    </div>
  );
}
