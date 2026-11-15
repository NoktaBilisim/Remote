"use client";

import { useState, type FormEvent } from "react";
import { useCloseGuard } from "@/components/form-dialog-parts";
import { api, ApiError } from "@/lib/api";
import { suggestFileLabel, type CustomerDetail } from "@/lib/customers/contract";
import {
  buildCreate,
  buildPatch,
  draftOf,
  emptyDraft,
  isDirty,
  serverFieldErrors,
  type CustomerDraft,
  type CustomerErrors,
  type CustomerField,
} from "@/lib/customers/form";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/** Müşteri taslağı: dosya etiketi adı yazarken önerilir, elle düzenlenince öneri durur. */
function useCustomerDraft(customer: CustomerDetail | undefined) {
  const [base] = useState<CustomerDraft>(() => (customer ? draftOf(customer) : emptyDraft()));
  const [d, setD] = useState<CustomerDraft>(base);
  const [errors, setErrors] = useState<CustomerErrors>({});
  return { base, d, setD, errors, setErrors };
}

/**
 * Yeni müşteri / Düzenle formu durumu (AC-167, AC-195): contracts zod doğrulaması, değişiklik yoksa kapatma,
 * sunucu alan hataları; 409 → ad altında. `focusError` bileşendeki `useFocusFirstError`'dan gelir.
 */
export function useCustomerForm(
  customer: CustomerDetail | undefined,
  onClose: () => void,
  onSaved: (c: CustomerDetail) => void,
  focusError: () => void,
) {
  const { base, d, setD, errors, setErrors } = useCustomerDraft(customer);
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [labelTouched, setLabelTouched] = useState(Boolean(customer));
  const guard = useCloseGuard(isDirty(d, base), busy, onClose);

  const set = (k: CustomerField) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setD((x) => {
      const next = { ...x, [k]: v };
      if (k === "name" && !labelTouched) next.fileLabel = v.trim() ? suggestFileLabel(v) : "";
      return next;
    });
    if (k === "fileLabel") setLabelTouched(true);
    setErrors((x) => ({ ...x, [k]: undefined, ...(k === "name" && !labelTouched ? { fileLabel: undefined } : {}) }));
  };
  const fail = (err: unknown) => {
    if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
      const { errors: fe, rest } = serverFieldErrors(err.fields);
      setErrors(fe);
      focusError();
      if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
    } else if (err instanceof ApiError && err.status === 409) {
      setErrors({ name: err.message || t("cu.f.conflict") });
      focusError();
    } else setFormError(toUiError(err, { 404: t("cu.notFoundBody") }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = customer ? buildPatch(d, customer) : buildCreate(d);
    if (!r.ok) {
      setErrors(r.errors);
      focusError();
      return;
    }
    if (customer && Object.keys(r.body).length === 0) return onClose();
    setBusy(true);
    try {
      const saved = customer
        ? await api<CustomerDetail>("PATCH", `/customers/${customer.id}`, r.body)
        : await api<CustomerDetail>("POST", "/customers", r.body);
      onSaved(saved);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return { d, errors, formError, busy, guard, set, submit };
}

export type CustomerFormState = ReturnType<typeof useCustomerForm>;
