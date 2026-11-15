"use client";

import { FormError } from "@/components/form-error";
import { FormDialogActions, FormLeaveDialog } from "@/components/form-dialog-parts";
import { Dialog } from "@/components/ui/dialog";
import type { CustomerDetail } from "@/lib/customers/contract";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import { ContactFields, NoteField, SlaFields } from "./customer-form-fields";
import { useCustomerForm } from "./use-customer-form";

/**
 * Yeni müşteri / Düzenle (AC-167, AC-195). Doğrulama contracts zod şemasıyla (sunucuyla aynı); alan bazlı hata;
 * 409 → ad altında "Bu adla bir müşteri zaten var"; gönderimde alanlar pasif. Dosya etiketi adı yazarken önerilir,
 * elle düzenlenince öneri durur. Düzenlemede boşaltılan kişisel alan `null` gider. Kaydedilmemiş değişiklikte
 * kapatma (Esc, X, Vazgeç) onay ister; varsayılan odak "Düzenlemeye dön".
 */
export function CustomerFormDialog({
  customer,
  onClose,
  onSaved,
}: {
  /** Verilirse düzenleme. */
  customer?: CustomerDetail;
  onClose: () => void;
  onSaved: (c: CustomerDetail) => void;
}) {
  const { formRef, focusError } = useFocusFirstError();
  const f = useCustomerForm(customer, onClose, onSaved, focusError);
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        onDismiss={f.guard.requestClose}
        testId="customer-form"
        title={customer ? t("cu.f.editTitle") : t("cu.f.newTitle")}
        description={t("cu.f.desc")}
      >
        <form ref={formRef} onSubmit={f.submit} noValidate className="flex flex-col gap-4">
          {f.formError && <FormError error={f.formError} />}
          <fieldset disabled={f.busy} className="flex flex-col gap-4">
            <ContactFields f={f} />
            <NoteField f={f} />
            <SlaFields f={f} />
            {customer && <p className="text-xs text-fg-muted">{t("cu.f.clearHint")}</p>}
          </fieldset>
          <FormDialogActions
            busy={f.busy}
            onCancel={f.guard.requestClose}
            submitLabel={customer ? t("cu.f.save") : t("cu.f.create")}
            submitTestId="cf-submit"
          />
        </form>
      </Dialog>
      <FormLeaveDialog
        guard={f.guard}
        testId="customer-form-leave"
        title={t("cu.f.leaveTitle")}
        body={t("cu.f.leaveBody")}
        stayLabel={t("cu.f.stay")}
      />
    </>
  );
}
