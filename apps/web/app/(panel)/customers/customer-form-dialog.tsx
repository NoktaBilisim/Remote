"use client";

import { Save } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError } from "@/lib/api";
import { CUSTOMER_NOTE_MAX, suggestFileLabel, type CustomerDetail } from "@/lib/customers/contract";
import {
  buildCreate,
  buildPatch,
  codePointLength,
  draftOf,
  emptyDraft,
  isDirty,
  serverFieldErrors,
  type CustomerDraft,
  type CustomerErrors,
  type CustomerField,
} from "@/lib/customers/form";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";

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
  const [base] = useState<CustomerDraft>(() => (customer ? draftOf(customer) : emptyDraft()));
  const [d, setD] = useState<CustomerDraft>(base);
  const [errors, setErrors] = useState<CustomerErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [labelTouched, setLabelTouched] = useState(Boolean(customer));
  const [confirmClose, setConfirmClose] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const noteId = useId();

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);

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

  const dirty = isDirty(d, base);
  const requestClose = () => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = customer ? buildPatch(d, customer) : buildCreate(d);
    if (!r.ok) {
      setErrors(r.errors);
      setFocusErr((n) => n + 1);
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
      if (err instanceof ApiError && (err.status === 400 || err.status === 409) && err.fields) {
        const { errors: fe, rest } = serverFieldErrors(err.fields);
        setErrors(fe);
        setFocusErr((n) => n + 1);
        if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
      } else if (err instanceof ApiError && err.status === 409) {
        setErrors({ name: err.message || t("cu.f.conflict") });
        setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err, { 404: t("cu.notFoundBody") }));
    } finally {
      setBusy(false);
    }
  };

  const noteLen = codePointLength(d.note);
  const noteOver = noteLen > CUSTOMER_NOTE_MAX;
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        onDismiss={requestClose}
        testId="customer-form"
        title={customer ? t("cu.f.editTitle") : t("cu.f.newTitle")}
        description={t("cu.f.desc")}
      >
        <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
          {formError && <FormError error={formError} />}
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <TextField label={t("cu.f.name")} value={d.name} onChange={set("name")} error={errors.name} maxLength={100} autoComplete="organization" required data-autofocus data-testid="cf-name" />
            <TextField
              label={t("cu.f.fileLabel")}
              value={d.fileLabel}
              onChange={set("fileLabel")}
              error={errors.fileLabel}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              hint={t("cu.f.fileLabelHint", { label: d.fileLabel || "…" })}
              data-testid="cf-label"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t("cu.f.contact")} value={d.contactName} onChange={set("contactName")} error={errors.contactName} maxLength={80} autoComplete="name" data-testid="cf-contact" />
              <TextField label={t("cu.f.phone")} type="tel" value={d.phone} onChange={set("phone")} error={errors.phone} maxLength={40} autoComplete="tel" hint={t("cu.f.phoneHint")} data-testid="cf-phone" />
            </div>
            <TextField label={t("cu.f.email")} type="email" value={d.email} onChange={set("email")} error={errors.email} maxLength={254} autoComplete="email" data-testid="cf-email" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={noteId} className="text-sm font-medium text-fg">{t("cu.f.note")}</label>
              <textarea
                id={noteId}
                rows={4}
                value={d.note}
                onChange={set("note")}
                aria-invalid={errors.note || noteOver ? true : undefined}
                aria-describedby={`${noteId}-c${errors.note ? ` ${noteId}-e` : ""}`}
                data-testid="cf-note"
                className={`w-full resize-y rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm focus-visible:border-ring disabled:opacity-60 sm:text-sm ${errors.note || noteOver ? "border-danger" : "border-border"}`}
              />
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                {errors.note ? <p id={`${noteId}-e`} className="font-medium text-danger">{errors.note}</p> : <span className="text-fg-muted">{t("cu.f.noteHint")}</span>}
                <p id={`${noteId}-c`} className={`tabular-nums ${noteOver ? "font-medium text-danger" : "text-fg-muted"}`} aria-live={noteLen > CUSTOMER_NOTE_MAX - 100 ? "polite" : "off"}>
                  {t("h.n.count", { n: formatNumber(noteLen), max: formatNumber(CUSTOMER_NOTE_MAX) })}
                </p>
              </div>
            </div>
            {customer && <p className="text-xs text-fg-muted">{t("cu.f.clearHint")}</p>}
          </fieldset>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>{t("rq.rj.cancel")}</Button>
            <Button type="submit" loading={busy} data-testid="cf-submit">
              {!busy && <Save aria-hidden className="size-4" />}
              {customer ? t("cu.f.save") : t("cu.f.create")}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        role="alertdialog"
        size="sm"
        testId="customer-form-leave"
        title={t("cu.f.leaveTitle")}
        description={t("cu.f.leaveBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmClose(false)} className="sm:ml-auto">{t("cu.f.stay")}</Button>
            <Button variant="danger-ghost" onClick={() => { setConfirmClose(false); onClose(); }}>{t("h.n.discard")}</Button>
          </>
        }
      />
    </>
  );
}
