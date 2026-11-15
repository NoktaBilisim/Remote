"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ListSearch, useListSearch } from "@/components/list-search";
import { Segmented } from "@/components/ui/segmented";
import type { CustomerStatusFilter } from "@/lib/customers/contract";
import { customersHref, type CustomerListParams } from "@/lib/customers/query";
import { t } from "@/lib/i18n";

/**
 * Arama + durum filtresi (AC-166): en az 2 karakterde 300 ms sonra URL güncellenir (katlama sunucuda — harf ve Türkçe
 * karakter duyarsız). Boşaltınca arama kalkar. Durum `Segmented` Aktif (vars.) / Pasif / Tümü; değişince sayfa 1.
 */
export function CustomerFilters({ params }: { params: CustomerListParams }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (p: Partial<CustomerListParams>) =>
    start(() => router.replace(customersHref({ q: params.q, status: params.status, ...p, page: 1 })));
  const search = useListSearch(params.q, (q) => go({ q }));
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" data-testid="customer-filters">
      <ListSearch
        label={t("cu.search")}
        placeholder={t("cu.searchPh")}
        testId="customer-search"
        search={search}
        pending={pending}
        hint={{ normal: t("cu.searchHint"), short: t("cu.searchShort") }}
      />
      <Segmented<CustomerStatusFilter>
        label={t("cu.statusFilter")}
        value={params.status}
        onChange={(status) => go({ status })}
        options={[
          { value: "active", label: t("cu.filter.active") },
          { value: "passive", label: t("cu.filter.passive") },
          { value: "all", label: t("cu.filter.all") },
        ]}
      />
    </div>
  );
}
