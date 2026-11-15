"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CustomerCombobox } from "@/components/customer-combobox";
import { ListSearch, useListSearch } from "@/components/list-search";
import { Segmented } from "@/components/ui/segmented";
import { t } from "@/lib/i18n";
import type { DeviceListState } from "@/lib/unattended/contract";
import { devicesHref, type DeviceListParams } from "@/lib/unattended/query";

/** Arama (cihaz/müşteri adı, ≥ 2 karakter) + müşteri seçimi + durum (Tümü / Çevrimiçi / Çevrimdışı); filtre URL'de. */
export function DeviceFilters({ params, customerLabel }: { params: DeviceListParams; customerLabel: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (p: Partial<DeviceListParams>) => start(() => router.replace(devicesHref({ ...params, ...p })));
  const search = useListSearch(params.q, (q) => go({ q }));
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
      />
      <div className="w-full max-w-xs">
        <CustomerCombobox
          label={t("un.col.customer")}
          value={customer}
          onChange={(v) => go({ customerId: v?.id })}
          status="all"
          testId="un-customer"
        />
      </div>
      <Segmented<DeviceListState>
        label={t("un.f.state")}
        value={params.state}
        onChange={(state) => go({ state })}
        options={[
          { value: "all", label: t("un.f.all") },
          { value: "online", label: t("un.badge.online") },
          { value: "offline", label: t("un.badge.offline") },
        ]}
      />
    </div>
  );
}
