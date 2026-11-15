"use client";

import { SESSION_STATUSES } from "@remote/contracts/api/sessions";
import { SESSION_MODE_LABELS, SESSION_SOURCE_LABELS } from "@remote/contracts/labels";
import { Filter, FilterX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { CustomerCombobox } from "@/components/customer-combobox";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { istanbulDay } from "@/lib/format";
import { checkCustomer, historyHref, isCalendarDay, type HistoryFilters } from "@/lib/history/query";
import { t } from "@/lib/i18n";
import { loadTenantOptions, rememberTenantLabel, TENANT_COMBO_DEBOUNCE_MS, tenantLabelOf } from "@/lib/users/tenant-options";
import { loadUserOptions, techOptions } from "@/lib/users/user-options";

type Opt = { value: string; label: string };

interface Props {
  filters: HistoryFilters;
  /**
   * ADMIN / SUPER_ADMIN: teknisyen filtresi (USER'da sunucu yok sayar → gizli). P14b (AC-225): yalnız `/users/options`
   * tam listesi; firma seçmemiş Super Admin'de firma filtresi boşsa boş (seçici pasif), firma seçince istemci yükler.
   */
  technicians: Opt[] | null;
  /** Sunucu tarafı seçenek isteği başarısız → alan altında hata ipucu. */
  techniciansError?: boolean;
  /** Yalnız SUPER_ADMIN firma seçmemişken: aramalı firma seçici (AC-226, `/admin/tenants/options`). */
  showTenant: boolean;
  /** URL'deki `tenantId`'nin adı (sayfadaki kayıtlardan; yoksa genel etiket). */
  tenantLabel?: string;
  /** P8c (AC-179): seçili müşteri firmanın adı (sayfadaki kayıtlardan; yoksa genel etiket). */
  customerFirmName?: string;
}

type Draft = Record<"from" | "to" | "status" | "mode" | "source" | "technicianId" | "tenantId" | "customer" | "customerFirm", string>;
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
  customerFirm: f.customerFirm ?? "",
});

/** /history filtre formu: durum URL'de (AC-60); Enter/Filtrele ile uygulanır, sayfa 1'e döner. */
export function HistoryFiltersForm({ filters, technicians, techniciansError, showTenant, tenantLabel, customerFirmName }: Props) {
  const [techs, setTechs] = useState<Opt[] | null>(technicians);
  const [techState, setTechState] = useState<"idle" | "loading" | "error">(techniciansError ? "error" : "idle");
  const techAbort = useRef<AbortController | null>(null);
  useEffect(() => () => techAbort.current?.abort(), []);
  /** AC-225: Super Admin firma filtresini değiştirince teknisyen listesi o firmanın `/users/options?tenantId=` yanıtı. */
  const reloadTechs = (tenantId: string) => {
    techAbort.current?.abort();
    setTechs([]);
    if (!tenantId) {
      setTechState("idle");
      return;
    }
    const ac = new AbortController();
    techAbort.current = ac;
    setTechState("loading");
    loadUserOptions(tenantId, ac.signal).then(
      (items) => {
        setTechs(techOptions(items));
        setTechState("idle");
      },
      () => {
        if (!ac.signal.aborted) setTechState("error");
      },
    );
  };
  const [tenant, setTenant] = useState<ComboOption | null>(
    filters.tenantId
      ? {
          id: filters.tenantId,
          label: tenantLabel ?? tenantLabelOf(filters.tenantId) ?? t("h.f.selected", { id: filters.tenantId.slice(-6) }),
        }
      : null,
  );
  const loadTenants = useCallback(
    async (q: string, signal: AbortSignal): Promise<ComboOption[]> =>
      (await loadTenantOptions(q, signal)).map((x) => ({
        id: x.id,
        label: x.name,
        hint: x.status === "PASSIVE" ? t("h.f.tenantPassive") : undefined,
      })),
    [],
  );
  const [firmMode, setFirmMode] = useState<"" | "none" | "customer">(
    filters.customerFirm === "none" ? "none" : filters.customerFirm ? "customer" : "",
  );
  const [firm, setFirm] = useState<ComboOption | null>(
    filters.customerFirm && filters.customerFirm !== "none"
      ? { id: filters.customerFirm, label: customerFirmName ?? t("rq.cf.selected") }
      : null,
  );
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
  /** AC-225: firma seçmemiş Super Admin'de firma filtresi boşken teknisyen seçici pasif (URL'deki seçili id korunur). */
  const techLocked = showTenant && !draft.tenantId;
  const techHint =
    techState === "error"
      ? t("h.f.techError")
      : techState === "loading"
        ? t("h.f.techLoading")
        : techLocked
          ? t("h.f.techPickTenant")
          : undefined;

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
    setFirmMode("");
    setFirm(null);
    setTenant(null);
    if (showTenant) reloadTechs("");
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
      <TextField
        label={t("h.f.from")}
        type="date"
        name="from"
        value={draft.from}
        max={today}
        onChange={set("from")}
        error={errors.from}
        hint={t("h.f.dateHint")}
      />
      <TextField
        label={t("h.f.to")}
        type="date"
        name="to"
        value={draft.to}
        max={today}
        onChange={set("to")}
        error={errors.to}
        hint={t("h.f.dateHint")}
      />
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
      {techs && (
        <SelectField
          label={t("h.f.tech")}
          name="technicianId"
          value={draft.technicianId}
          onChange={set("technicianId")}
          options={[all, ...techs]}
          disabled={techLocked || techState === "loading"}
          aria-busy={techState === "loading" || undefined}
          hint={techHint}
          data-testid="history-tech"
        />
      )}
      {showTenant && (
        <Combobox
          label={t("h.f.tenant")}
          value={tenant}
          onChange={(o) => {
            setTenant(o);
            if (o) rememberTenantLabel(o.id, o.label);
            // önceki firmanın teknisyeni yeni firmada anlamsız → seçim sıfırlanır
            setDraft((d) => ({ ...d, tenantId: o?.id ?? "", technicianId: "" }));
            if ((o?.id ?? "") !== draft.tenantId) reloadTechs(o?.id ?? "");
          }}
          load={loadTenants}
          debounceMs={TENANT_COMBO_DEBOUNCE_MS}
          placeholder={t("ts.searchPh")}
          hint={t("h.f.tenantHint")}
          testId="history-tenant-combobox"
        />
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
      <SelectField
        label={t("h.f.firm")}
        name="customerFirmMode"
        value={firmMode}
        onChange={(e) => {
          const m = e.target.value as "" | "none" | "customer";
          setFirmMode(m);
          setDraft((d) => ({ ...d, customerFirm: m === "none" ? "none" : m === "customer" ? (firm?.id ?? "") : "" }));
        }}
        options={[all, { value: "none", label: t("h.f.firmNone") }, { value: "customer", label: t("h.f.firmPick") }]}
        data-testid="history-firm-mode"
      />
      {firmMode === "customer" && (
        <CustomerCombobox
          label={t("rq.cf.pick")}
          status="all"
          value={firm}
          onChange={(o) => {
            setFirm(o);
            setDraft((d) => ({ ...d, customerFirm: o?.id ?? "" }));
          }}
          testId="history-firm-combobox"
        />
      )}
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
