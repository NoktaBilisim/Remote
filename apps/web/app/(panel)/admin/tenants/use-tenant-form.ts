"use client";

import { useState, type FormEvent } from "react";
import { useCloseGuard } from "@/components/form-dialog-parts";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { TENANT_SLUG_CONFLICT_MESSAGE, type TenantItem } from "@/lib/users/contract";
import {
  buildTenant,
  splitServerFields,
  suggestSlug,
  TENANT_FIELDS,
  tenantDraftOf,
  type Errors,
  type TenantDraft,
  type TenantField,
} from "@/lib/users/form";

/** Ad / kısa ad taslağı: kısa ad yeni firmada addan önerilir, elle düzenlenince öneri durur. */
function useTenantDraft(tenant: TenantItem | undefined) {
  const [base] = useState<TenantDraft>(() => tenantDraftOf(tenant));
  const [d, setD] = useState<TenantDraft>(base);
  const [slugTouched, setSlugTouched] = useState(Boolean(tenant));
  const [errors, setErrors] = useState<Errors<TenantField>>({});
  const setName = (v: string) => {
    setD((x) => ({ name: v, slug: slugTouched ? x.slug : suggestSlug(v) }));
    setErrors((x) => ({ ...x, name: undefined, ...(slugTouched ? {} : { slug: undefined }) }));
  };
  const setSlug = (v: string) => {
    setSlugTouched(true);
    setD((x) => ({ ...x, slug: v }));
    setErrors((x) => ({ ...x, slug: undefined }));
  };
  return { base, d, errors, setErrors, setName, setSlug };
}

/**
 * Yeni firma / Düzenle formu durumu (AC-70): istemci doğrulaması, değişiklik yoksa kapatma, sunucu alan hataları;
 * 409 → kısa ad altında. `focusError` bileşendeki `useFocusFirstError`'dan gelir (React Compiler: ref kanca dışında).
 */
export function useTenantForm(
  tenant: TenantItem | undefined,
  onClose: () => void,
  onSaved: (x: TenantItem) => void,
  focusError: () => void,
) {
  const draft = useTenantDraft(tenant);
  const { base, d, setErrors } = draft;
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useCloseGuard(d.name !== base.name || d.slug !== base.slug, busy, onClose);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
      const { errors: fe, rest } = splitServerFields(err.fields, TENANT_FIELDS);
      setErrors(fe);
      focusError();
      if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
    } else if (err instanceof ApiError && err.status === 409) {
      setErrors({ slug: TENANT_SLUG_CONFLICT_MESSAGE });
      focusError();
    } else setFormError(toUiError(err));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = buildTenant(d, tenant ? base : undefined);
    if (!r.ok) {
      setErrors(r.errors);
      focusError();
      return;
    }
    if (tenant && Object.keys(r.body).length === 0) return onClose();
    setBusy(true);
    try {
      onSaved(
        tenant
          ? await api<TenantItem>("PATCH", `/admin/tenants/${tenant.id}`, r.body)
          : await api<TenantItem>("POST", "/admin/tenants", r.body),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return { ...draft, formError, busy, guard, submit, slugChanged: Boolean(tenant) && d.slug !== base.slug };
}
