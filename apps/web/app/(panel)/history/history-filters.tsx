"use client";

import { SESSION_STATUSES } from "@remote/contracts/api/sessions";
import { SESSION_MODE_LABELS, SESSION_SOURCE_LABELS } from "@remote/contracts/labels";
import { CustomerCombobox } from "@/components/customer-combobox";
import { FilterButtons } from "@/components/filter-buttons";
import { Combobox } from "@/components/ui/combobox";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { istanbulDay } from "@/lib/format";
import { t } from "@/lib/i18n";
import { rememberTenantLabel, TENANT_COMBO_DEBOUNCE_MS } from "@/lib/users/tenant-options";
import { useHistoryFilters, type FirmMode, type HistoryFilterInput, type Opt } from "./use-history-filters";

interface Props extends HistoryFilterInput {
  /**
   * ADMIN / SUPER_ADMIN: teknisyen filtresi (USER'da sunucu yok sayar → gizli). P14b (AC-225): yalnız `/users/options`
   * tam listesi; firma seçmemiş Super Admin'de firma filtresi boşsa boş (seçici pasif), firma seçince istemci yükler.
   * `techniciansError`: sunucu tarafı seçenek isteği başarısız → alan altında hata ipucu. `showTenant`: yalnız
   * SUPER_ADMIN firma seçmemişken aramalı firma seçici (AC-226). `tenantLabel` / `customerFirmName` (P8c, AC-179):
   * URL'deki seçimin adı (sayfadaki kayıtlardan; yoksa genel etiket).
   */
  technicians: Opt[] | null;
}

/** /history filtre formu: durum URL'de (AC-60); Enter/Filtrele ile uygulanır, sayfa 1'e döner. */
export function HistoryFiltersForm(props: Props) {
  const { showTenant } = props;
  const f = useHistoryFilters(props);
  const {
    techs,
    techState,
    draft,
    setDraft,
    errors,
    pending,
    set,
    submit,
    clear,
    tenant,
    setTenant,
    loadTenants,
    firmMode,
    setFirmMode,
    firm,
    setFirm,
  } = f;
  const today = istanbulDay();
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
  const reloadTechs = f.reloadTechs;
  const onFirmMode = (m: FirmMode) => {
    setFirmMode(m);
    setDraft((d) => ({ ...d, customerFirm: m === "none" ? "none" : m === "customer" ? (firm?.id ?? "") : "" }));
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
        onChange={(e) => onFirmMode(e.target.value as FirmMode)}
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
      <FilterButtons
        pending={pending}
        onClear={clear}
        className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1 lg:col-start-4"
      />
    </form>
  );
}
