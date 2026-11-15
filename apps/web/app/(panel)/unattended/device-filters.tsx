"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CustomerCombobox } from "@/components/customer-combobox";
import { ListSearch, useListSearch } from "@/components/list-search";
import { Segmented } from "@/components/ui/segmented";
import { t } from "@/lib/i18n";
import type { DeviceListState } from "@/lib/unattended/contract";
import { DEVICE_SEARCH_MAX, deviceSearchTerm, devicesHref, type DeviceListParams } from "@/lib/unattended/query";

/**
 * Arama (cihaz/müşteri adı, 2..64 karakter — sözleşme sınırı girdide de, aşan filtre sessizce düşmez) + müşteri seçimi +
 * durum (Tümü / Çevrimiçi / Çevrimdışı); filtre URL'de. K12: alanlar aynı yükseklikte (`min-h-11`), arama ipucu satırı
 * kadar alt boşlukla (`lg:pb-5.5` = 6 px aralık + 16 px `text-xs` satırı) giriş kutularının hizasında — kullanıcı filtresiyle aynı desen.
 */
export function DeviceFilters({ params, customerLabel }: { params: DeviceListParams; customerLabel: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (p: Partial<DeviceListParams>) => start(() => router.replace(devicesHref({ ...params, ...p })));
  const search = useListSearch(params.q, (q) => go({ q }), deviceSearchTerm);
  const customer = params.customerId ? { id: params.customerId, label: customerLabel ?? t("un.f.customerSelected") } : null;
  return (
    <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end" data-testid="un-filters">
      <ListSearch
        label={t("un.search")}
        placeholder={t("un.searchPh")}
        testId="un-search"
        search={search}
        pending={pending}
        hint={{ normal: t("un.searchHint"), short: t("cu.searchShort") }}
        maxLength={DEVICE_SEARCH_MAX}
      />
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end lg:pb-5.5">
        <div className="w-full max-w-md min-w-0 sm:w-72">
          <CustomerCombobox
            label={t("un.col.customer")}
            value={customer}
            onChange={(v) => go({ customerId: v?.id })}
            status="all"
            testId="un-customer"
          />
        </div>
        {/* blok sarmalayıcı: dar ekranda grup sütun genişliğine gerilmez */}
        <div className="shrink-0">
          <Segmented<DeviceListState>
            label={t("un.f.state")}
            size="field"
            value={params.state}
            onChange={(state) => go({ state })}
            options={[
              { value: "all", label: t("un.f.all") },
              { value: "online", label: t("un.badge.online") },
              { value: "offline", label: t("un.badge.offline") },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
