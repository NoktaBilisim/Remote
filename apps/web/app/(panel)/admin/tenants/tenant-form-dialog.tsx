"use client";

import { FormError } from "@/components/form-error";
import { FormDialogActions, FormLeaveDialog } from "@/components/form-dialog-parts";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import { TENANT_NAME_MAX, TENANT_SLUG_MAX, type TenantItem } from "@/lib/users/contract";
import { useTenantForm } from "./use-tenant-form";

function TenantFields({ f, tenant }: { f: ReturnType<typeof useTenantForm>; tenant?: TenantItem }) {
  return (
    <fieldset disabled={f.busy} className="flex flex-col gap-4">
      <TextField
        label={t("tn.f.name")}
        value={f.d.name}
        maxLength={TENANT_NAME_MAX}
        autoComplete="organization"
        required
        data-autofocus
        error={f.errors.name}
        data-testid="tf-name"
        onChange={(e) => f.setName(e.target.value)}
      />
      <TextField
        label={t("tn.f.slug")}
        value={f.d.slug}
        maxLength={TENANT_SLUG_MAX}
        autoComplete="off"
        spellCheck={false}
        required
        error={f.errors.slug}
        hint={t("tn.f.slugHint")}
        data-testid="tf-slug"
        onChange={(e) => f.setSlug(e.target.value)}
      />
      {f.slugChanged && (
        <Alert tone="warning" testId="tf-slug-warning">
          {t("tn.f.slugEditHint")}
        </Alert>
      )}
      {tenant && (
        <TextField
          label={t("tn.f.quota")}
          value={f.quota}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          error={f.quotaError}
          hint={
            tenant.storage
              ? t("tn.f.quotaUsage", { used: formatBytes(tenant.storage.usedBytes), quota: formatBytes(tenant.storage.quotaBytes) })
              : t("tn.f.quotaHint")
          }
          data-testid="tf-quota"
          onChange={(e) => f.setQuota(e.target.value)}
        />
      )}
    </fieldset>
  );
}

type Props = { tenant?: TenantItem; onClose: () => void; onSaved: (x: TenantItem) => void };

/**
 * Yeni firma / Düzenle (AC-70). Kısa ad yeni firmada addan önerilir (elle düzenlenince öneri durur); düzenlemede
 * değiştirmenin etkisi (eski giriş bağlantıları) uyarılır. 409 → kısa ad altında. Kirli formda kapatma onayı.
 */
export function TenantFormDialog({ tenant, onClose, onSaved }: Props) {
  const { formRef, focusError } = useFocusFirstError();
  const f = useTenantForm(tenant, onClose, onSaved, focusError);
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        onDismiss={f.guard.requestClose}
        testId="tenant-form"
        title={tenant ? t("tn.f.editTitle") : t("tn.f.newTitle")}
        description={tenant ? undefined : t("tn.f.desc")}
      >
        <form ref={formRef} onSubmit={f.submit} noValidate className="flex flex-col gap-4">
          {f.formError && <FormError error={f.formError} />}
          <TenantFields f={f} tenant={tenant} />
          <FormDialogActions
            busy={f.busy}
            onCancel={f.guard.requestClose}
            submitLabel={tenant ? t("tn.f.save") : t("tn.f.create")}
            submitTestId="tf-submit"
          />
        </form>
      </Dialog>
      <FormLeaveDialog
        guard={f.guard}
        testId="tenant-form-leave"
        title={t("tn.f.leaveTitle")}
        body={t("tn.f.leaveBody")}
        stayLabel={t("tn.f.stay")}
      />
    </>
  );
}
