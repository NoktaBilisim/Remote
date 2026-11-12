"use client";

import { SESSION_STATUSES } from "@remote/contracts/api/sessions";
import { SESSION_MODE_LABELS, SESSION_SOURCE_LABELS } from "@remote/contracts/labels";
import { Filter, FilterX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { istanbulDay } from "@/lib/format";
import { checkCustomer, historyHref, isCalendarDay, type HistoryFilters } from "@/lib/history/query";
import { t } from "@/lib/i18n";

type Opt = { value: string; label: string };

interface Props {
  filters: HistoryFilters;
  /** ADMIN / SUPER_ADMIN: teknisyen filtresi (USER'da sunucu yok sayar → gizli). */
  technicians: Opt[] | null;
  /** Yalnız SUPER_ADMIN firma seçmemişken. */
  tenants: Opt[] | null;
}

type Draft = Record<"from" | "to" | "status" | "mode" | "source" | "technicianId" | "tenantId" | "customer", string>;
type Errors = Partial<Record<keyof Draft, string>>;

const CUSTOMER_ERR = { short: "h.v.customerShort", long: "h.v.customerLong", chars: "h.v.customerChars" } as const;

/** Sunucu kuralıyla aynı denetim (mimari-api P8 §1); geçersizse istek atılmaz. */
export function validateDraft(d: Draft): Errors {
  const e: Errors = {};
  if (d.from && !isCalendarDay(d.from)) e.from = t("h.v.date");
  if (d.to && !isCalendarDay(d.to)) e.to = t("h.v.date");
  if (!e.from && !e.to && d.from && d.to && d.from > d.to) e.to = t("h.v.dateOrder");
  const c = checkCustomer(d.customer).error;
  if (c) e.customer = t(CUSTOMER_ERR[c]);
  return e;
}

const toDraft = (f: HistoryFilters): Draft => ({
  from: f.from ?? "",
  to: f.to ?? "",
  status: f.status ?? "",
  mode: f.mode ?? "",
  source: f.source ?? "",
  technicianId: f.technicianId ?? "",
  tenantId: f.tenantId ?? "",
  customer: f.customer ?? "",
});

/** /history filtre formu: durum URL'de (AC-60); Enter/Filtrele ile uygulanır, sayfa 1'e döner. */
export function HistoryFiltersForm({ filters, technicians, tenants }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(filters));
  const [errors, setErrors] = useState<Errors>({});
  const [pending, start] = useTransition();
  const today = istanbulDay();

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const all: Opt = { value: "", label: t("h.f.all") };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateDraft(draft);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    const next = {
      ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim() !== "")),
      customer: checkCustomer(draft.customer).value,
      page: 1,
      pageSize: filters.pageSize,
    } as Partial<HistoryFilters>;
    start(() => router.push(historyHref(next)));
  };
  const clear = () => {
    setDraft(toDraft({ page: 1, pageSize: filters.pageSize }));
    setErrors({});
    start(() => router.push(historyHref({ pageSize: filters.pageSize })));
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t("h.filters")}
      data-testid="history-filters"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <TextField label={t("h.f.from")} type="date" name="from" value={draft.from} max={today} onChange={set("from")} error={errors.from} hint={t("h.f.dateHint")} />
      <TextField label={t("h.f.to")} type="date" name="to" value={draft.to} max={today} onChange={set("to")} error={errors.to} hint={t("h.f.dateHint")} />
      <SelectField
        label={t("h.f.status")}
        name="status"
        value={draft.status}
        onChange={set("status")}
        options={[all, ...SESSION_STATUSES.map((s) => ({ value: s, label: t(`s.status.${s}`) }))]}
      />
      <SelectField
        label={t("h.f.mode")}
        name="mode"
        value={draft.mode}
        onChange={set("mode")}
        options={[all, ...Object.entries(SESSION_MODE_LABELS).map(([value, label]) => ({ value, label }))]}
      />
      <SelectField
        label={t("h.f.source")}
        name="source"
        value={draft.source}
        onChange={set("source")}
        options={[all, ...Object.entries(SESSION_SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
      />
      {technicians && (
        <SelectField label={t("h.f.tech")} name="technicianId" value={draft.technicianId} onChange={set("technicianId")} options={[all, ...technicians]} hint={t("h.f.optionsHint")} />
      )}
      {tenants && (
        <SelectField label={t("h.f.tenant")} name="tenantId" value={draft.tenantId} onChange={set("tenantId")} options={[all, ...tenants]} hint={t("h.f.optionsHint")} />
      )}
      <TextField
        label={t("h.f.customer")}
        name="customer"
        type="search"
        value={draft.customer}
        onChange={set("customer")}
        placeholder={t("h.f.customerPh")}
        error={errors.customer}
        autoComplete="off"
      />
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1 lg:col-start-4">
        <Button type="submit" loading={pending} data-testid="filter-apply">
          {!pending && <Filter aria-hidden className="size-4" />}
          {t("h.f.apply")}
        </Button>
        <Button type="button" variant="ghost" onClick={clear} disabled={pending} data-testid="filter-clear">
          <FilterX aria-hidden className="size-4" />
          {t("h.f.clear")}
        </Button>
      </div>
    </form>
  );
}
