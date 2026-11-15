"use client";

import { useState, type FormEvent } from "react";
import { useUnauthRedirect } from "@/components/settings/use-unauth";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { buildHours, hoursDirty, toHoursState, type BusinessHoursView, type HoursState } from "@/lib/requests/business-hours";

type Day = HoursState["week"][number];

function useHoursState(initial: BusinessHoursView, canEdit: boolean) {
  const [saved, setSaved] = useState(initial);
  const [st, setSt] = useState<HoursState>(() => toHoursState(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = canEdit && hoursDirty(st, toHoursState(saved));

  const set = (p: Partial<HoursState>) => setSt((s) => ({ ...s, ...p }));
  const setDay = (i: number, fn: (d: Day) => Day) => setSt((s) => ({ ...s, week: s.week.map((d, j) => (j === i ? fn(d) : d)) }));
  const clearErr = (k: string) => setErrors((e) => (e[k] || e.week ? { ...e, [k]: "", week: "" } : e));
  const reset = () => {
    setSt(toHoursState(saved));
    setErrors({});
    setFormError(null);
  };
  const err = (k: string) => errors[k] || undefined;
  const state = { saved, setSaved, st, setSt, errors, setErrors, formError, setFormError, busy, setBusy, dirty };
  return { ...state, set, setDay, clearErr, reset, err };
}

/** Mesai saatleri formu: durum, gün/aralık düzenleme, PUT /settings/business-hours (400 `fields` alanlara). */
export function useHoursForm(initial: BusinessHoursView, canEdit: boolean) {
  const unauth = useUnauthRedirect();
  const toast = useToast();
  const s = useHoursState(initial, canEdit);
  const { st, setSaved, setSt, setErrors, setFormError, setBusy } = s;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    const { input, errors: errs } = buildHours(st);
    setErrors(errs);
    setFormError(null);
    if (!input) {
      setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      return;
    }
    setBusy(true);
    try {
      const next = await api<BusinessHoursView>("PUT", "/settings/business-hours", input);
      setSaved(next);
      setSt(toHoursState(next));
      toast(t("bh.saved"));
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        setErrors(err.fields);
        setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };
  return { ...s, save };
}

export type HoursForm = ReturnType<typeof useHoursForm>;
