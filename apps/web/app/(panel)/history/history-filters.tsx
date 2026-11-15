"use client";

import { FilterButtons } from "@/components/filter-buttons";
import { istanbulDay } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CustomerFields, DateFields, SessionSelects, TechSelect, TenantPicker } from "./history-filter-fields";
import { useHistoryFilters, type HistoryFilterInput, type Opt } from "./use-history-filters";

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
  const all: Opt = { value: "", label: t("h.f.all") };
  return (
    <form
      onSubmit={f.submit}
      noValidate
      aria-label={t("h.filters")}
      data-testid="history-filters"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <DateFields f={f} today={istanbulDay()} />
      <SessionSelects f={f} all={all} />
      <TechSelect f={f} all={all} showTenant={showTenant} />
      {showTenant && <TenantPicker f={f} />}
      <CustomerFields f={f} all={all} />
      <FilterButtons
        pending={f.pending}
        onClear={f.clear}
        className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1 lg:col-start-4"
      />
    </form>
  );
}
