"use client";

import { SESSION_STATUSES } from "@remote/contracts/api/sessions";
import { SESSION_MODE_LABELS, SESSION_SOURCE_LABELS } from "@remote/contracts/labels";
import { CustomerCombobox } from "@/components/customer-combobox";
import { Video } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { t } from "@/lib/i18n";
import { CONSENT_MODE_LABELS, CONSENT_MODES } from "@/lib/unattended/contract";
import { rememberTenantLabel, TENANT_COMBO_DEBOUNCE_MS } from "@/lib/users/tenant-options";
import type { FirmMode, HistoryFilterState, Opt } from "./use-history-filters";

type F = { f: HistoryFilterState };

/** Başlangıç / bitiş günü (bugünden ileri seçilemez). */
export function DateFields({ f, today }: F & { today: string }) {
  return (
    <>
      <TextField
        label={t("h.f.from")}
        type="date"
        name="from"
        value={f.draft.from}
        max={today}
        onChange={f.set("from")}
        error={f.errors.from}
        hint={t("h.f.dateHint")}
      />
      <TextField
        label={t("h.f.to")}
        type="date"
        name="to"
        value={f.draft.to}
        max={today}
        onChange={f.set("to")}
        error={f.errors.to}
        hint={t("h.f.dateHint")}
      />
    </>
  );
}

/** P28e (V-PE-3, §9): "Kayıtlı" süzgeci — `Segmented` (Tümü / Kayıtlı); Filtrele ile uygulanır. */
export function RecordedFilter({ f }: F) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="history-recorded">
      <span aria-hidden className="text-sm font-medium text-fg">
        {t("h.f.recorded")}
      </span>
      <Segmented
        label={t("h.f.recorded")}
        size="field"
        value={f.draft.recorded === "true" ? "true" : "all"}
        onChange={(v) => f.set("recorded")({ target: { value: v === "true" ? "true" : "" } })}
        options={[
          { value: "all", label: t("h.f.recAll") },
          { value: "true", label: t("h.f.recOnly"), icon: <Video aria-hidden className="size-4" /> },
        ]}
      />
    </div>
  );
}

/** Oturum durumu, bağlantı türü ve kaynak seçimleri. */
export function SessionSelects({ f, all }: F & { all: Opt }) {
  return (
    <>
      <SelectField
        label={t("h.f.status")}
        name="status"
        value={f.draft.status}
        onChange={f.set("status")}
        options={[all, ...SESSION_STATUSES.map((s) => ({ value: s, label: t(`s.status.${s}`) }))]}
      />
      <SelectField
        label={t("h.f.mode")}
        name="mode"
        value={f.draft.mode}
        onChange={f.set("mode")}
        options={[all, ...Object.entries(SESSION_MODE_LABELS).map(([value, label]) => ({ value, label }))]}
      />
      <SelectField
        label={t("h.f.consentMode")}
        name="consentMode"
        value={f.draft.consentMode}
        onChange={f.set("consentMode")}
        options={[all, ...CONSENT_MODES.map((m) => ({ value: m, label: CONSENT_MODE_LABELS[m] }))]}
        data-testid="history-consent-mode"
      />
      <SelectField
        label={t("h.f.source")}
        name="source"
        value={f.draft.source}
        onChange={f.set("source")}
        options={[all, ...Object.entries(SESSION_SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
      />
    </>
  );
}

const techHintOf = (f: HistoryFilterState, locked: boolean) =>
  f.techState === "error"
    ? t("h.f.techError")
    : f.techState === "loading"
      ? t("h.f.techLoading")
      : locked
        ? t("h.f.techPickTenant")
        : undefined;

/** Teknisyen seçici — AC-225: firma seçmemiş Super Admin'de firma filtresi boşken pasif (URL'deki seçili id korunur). */
export function TechSelect({ f, all, showTenant }: F & { all: Opt; showTenant: boolean }) {
  if (!f.techs) return null;
  const locked = showTenant && !f.draft.tenantId;
  return (
    <SelectField
      label={t("h.f.tech")}
      name="technicianId"
      value={f.draft.technicianId}
      onChange={f.set("technicianId")}
      options={[all, ...f.techs]}
      disabled={locked || f.techState === "loading"}
      aria-busy={f.techState === "loading" || undefined}
      hint={techHintOf(f, locked)}
      data-testid="history-tech"
    />
  );
}

/** Super Admin firma (tenant) seçici; firma değişince teknisyen seçimi sıfırlanır ve liste yeniden yüklenir. */
export function TenantPicker({ f }: F) {
  const { setTenant, setDraft, draft, reloadTechs } = f;
  return (
    <Combobox
      label={t("h.f.tenant")}
      value={f.tenant}
      onChange={(o) => {
        setTenant(o);
        if (o) rememberTenantLabel(o.id, o.label);
        // önceki firmanın teknisyeni yeni firmada anlamsız → seçim sıfırlanır
        setDraft((d) => ({ ...d, tenantId: o?.id ?? "", technicianId: "" }));
        if ((o?.id ?? "") !== draft.tenantId) reloadTechs(o?.id ?? "");
      }}
      load={f.loadTenants}
      debounceMs={TENANT_COMBO_DEBOUNCE_MS}
      placeholder={t("ts.searchPh")}
      hint={t("h.f.tenantHint")}
      testId="history-tenant-combobox"
    />
  );
}

/** Müşteri arama + müşteri firma kipi (tümü / firmasız / seçili firma) ve firma seçici. */
export function CustomerFields({ f, all }: F & { all: Opt }) {
  const { setFirmMode, setFirm, setDraft, firm } = f;
  const onFirmMode = (m: FirmMode) => {
    setFirmMode(m);
    setDraft((d) => ({ ...d, customerFirm: m === "none" ? "none" : m === "customer" ? (firm?.id ?? "") : "" }));
  };
  return (
    <>
      <TextField
        label={t("h.f.customer")}
        name="customer"
        type="search"
        value={f.draft.customer}
        onChange={f.set("customer")}
        placeholder={t("h.f.customerPh")}
        error={f.errors.customer}
        autoComplete="off"
      />
      <SelectField
        label={t("h.f.firm")}
        name="customerFirmMode"
        value={f.firmMode}
        onChange={(e) => onFirmMode(e.target.value as FirmMode)}
        options={[all, { value: "none", label: t("h.f.firmNone") }, { value: "customer", label: t("h.f.firmPick") }]}
        data-testid="history-firm-mode"
      />
      {f.firmMode === "customer" && (
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
    </>
  );
}
