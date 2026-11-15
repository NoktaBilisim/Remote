"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ListSearch, useListSearch } from "@/components/list-search";
import { Segmented } from "@/components/ui/segmented";
import { t } from "@/lib/i18n";
import { tenantsHref, type TenantListParams } from "@/lib/users/tenant-query";

/** Firma arama (ad/kısa ad, ≥ 2 karakter, 300 ms) + durum (Tümü vars. / Aktif / Pasif); URL'de, değişince sayfa 1. */
export function TenantFilters({ params }: { params: TenantListParams }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (p: Partial<TenantListParams>) =>
    start(() => router.replace(tenantsHref({ q: params.q, status: params.status, ...p, page: 1 })));
  const search = useListSearch(params.q, (q) => go({ q }));
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" data-testid="tenant-filters">
      <ListSearch label={t("tn.search")} placeholder={t("tn.searchPh")} testId="tenant-search" search={search} pending={pending} />
      <Segmented<TenantListParams["status"]>
        label={t("tn.statusFilter")}
        value={params.status}
        onChange={(status) => go({ status })}
        options={[
          { value: "all", label: t("us.filter.all") },
          { value: "active", label: t("us.filter.active") },
          { value: "passive", label: t("us.filter.passive") },
        ]}
      />
    </div>
  );
}
