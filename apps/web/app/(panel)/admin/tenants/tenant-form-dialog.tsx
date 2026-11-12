"use client";

import { Save } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { TENANT_NAME_MAX, TENANT_SLUG_CONFLICT_MESSAGE, TENANT_SLUG_MAX, type TenantItem } from "@/lib/users/contract";
import { buildTenant, splitServerFields, suggestSlug, TENANT_FIELDS, tenantDraftOf, type Errors, type TenantDraft, type TenantField } from "@/lib/users/form";

/**
 * Yeni firma / Düzenle (AC-70). Kısa ad yeni firmada addan önerilir (elle düzenlenince öneri durur); düzenlemede
 * değiştirmenin etkisi (eski giriş bağlantıları) uyarılır. 409 → kısa ad altında. Kirli formda kapatma onayı.
 */
export function TenantFormDialog({ tenant, onClose, onSaved }: { tenant?: TenantItem; onClose: () => void; onSaved: (x: TenantItem) => void }) {
  const [base] = useState<TenantDraft>(() => tenantDraftOf(tenant));
  const [d, setD] = useState<TenantDraft>(base);
  const [slugTouched, setSlugTouched] = useState(Boolean(tenant));
  const [errors, setErrors] = useState<Errors<TenantField>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);

  const dirty = d.name !== base.name || d.slug !== base.slug;
  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = buildTenant(d, tenant ? base : undefined);
    if (!r.ok) {
      setErrors(r.errors);
      setFocusErr((n) => n + 1);
      return;
    }
    if (tenant && Object.keys(r.body).length === 0) return onClose();
    setBusy(true);
    try {
      onSaved(tenant ? await api<TenantItem>("PATCH", `/admin/tenants/${tenant.id}`, r.body) : await api<TenantItem>("POST", "/admin/tenants", r.body));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
        const { errors: fe, rest } = splitServerFields(err.fields, TENANT_FIELDS);
        setErrors(fe);
        setFocusErr((n) => n + 1);
        if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
      } else if (err instanceof ApiError && err.status === 409) {
        setErrors({ slug: TENANT_SLUG_CONFLICT_MESSAGE });
        setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const slugChanged = Boolean(tenant) && d.slug !== base.slug;
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        onDismiss={requestClose}
        testId="tenant-form"
        title={tenant ? t("tn.f.editTitle") : t("tn.f.newTitle")}
        description={tenant ? undefined : t("tn.f.desc")}
      >
        <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
          {formError && <FormError error={formError} />}
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <TextField
              label={t("tn.f.name")}
              value={d.name}
              maxLength={TENANT_NAME_MAX}
              autoComplete="organization"
              required
              data-autofocus
              error={errors.name}
              data-testid="tf-name"
              onChange={(e) => {
                const v = e.target.value;
                setD((x) => ({ name: v, slug: slugTouched ? x.slug : suggestSlug(v) }));
                setErrors((x) => ({ ...x, name: undefined, ...(slugTouched ? {} : { slug: undefined }) }));
              }}
            />
            <TextField
              label={t("tn.f.slug")}
              value={d.slug}
              maxLength={TENANT_SLUG_MAX}
              autoComplete="off"
              spellCheck={false}
              required
              error={errors.slug}
              hint={t("tn.f.slugHint")}
              data-testid="tf-slug"
              onChange={(e) => {
                setSlugTouched(true);
                setD((x) => ({ ...x, slug: e.target.value }));
                setErrors((x) => ({ ...x, slug: undefined }));
              }}
            />
            {slugChanged && <Alert tone="warning" testId="tf-slug-warning">{t("tn.f.slugEditHint")}</Alert>}
          </fieldset>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>{t("rq.rj.cancel")}</Button>
            <Button type="submit" loading={busy} data-testid="tf-submit">
              {!busy && <Save aria-hidden className="size-4" />}
              {tenant ? t("tn.f.save") : t("tn.f.create")}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        role="alertdialog"
        size="sm"
        testId="tenant-form-leave"
        title={t("tn.f.leaveTitle")}
        description={t("tn.f.leaveBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmClose(false)} className="sm:ml-auto">{t("tn.f.stay")}</Button>
            <Button variant="danger-ghost" onClick={() => { setConfirmClose(false); onClose(); }}>{t("h.n.discard")}</Button>
          </>
        }
      />
    </>
  );
}
