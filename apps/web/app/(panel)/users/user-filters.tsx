"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ListSearch, useListSearch } from "@/components/list-search";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { t } from "@/lib/i18n";
import type { UserRoleFilter, UserStatusFilter } from "@/lib/users/contract";
import { usersHref, type UserListParams } from "@/lib/users/query";

const ROLE_OPTIONS = () => [
  { value: "all", label: t("us.filter.roleAll") },
  { value: "USER", label: t("role.USER") },
  { value: "ADMIN", label: t("role.ADMIN") },
];

const STATUS_OPTIONS = (): { value: UserStatusFilter; label: string }[] => [
  { value: "active", label: t("us.filter.active") },
  { value: "passive", label: t("us.filter.passive") },
  { value: "all", label: t("us.filter.all") },
];

/**
 * Arama (ad/e-posta; ≥ 2 karakter, 300 ms) + rol seçimi + durum `Segmented` (Aktif vars. / Pasif / Tümü). Durum URL'de;
 * değişince sayfa 1. Müşteri filtresiyle aynı davranış (components/list-search.tsx).
 */
export function UserFilters({ params }: { params: UserListParams }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (p: Partial<UserListParams>) =>
    start(() => router.replace(usersHref({ q: params.q, role: params.role, status: params.status, ...p, page: 1 })));
  const search = useListSearch(params.q, (q) => go({ q }));
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end" data-testid="user-filters">
      <ListSearch
        label={t("us.search")}
        placeholder={t("us.searchPh")}
        testId="user-search"
        search={search}
        pending={pending}
        hint={{ normal: t("us.searchHint"), short: t("us.searchShort") }}
      />
      <div className="flex flex-wrap items-end gap-3 lg:ml-auto lg:pb-5">
        <SelectField
          label={t("us.roleFilter")}
          hideLabel
          value={params.role}
          onChange={(e) => go({ role: e.target.value as UserRoleFilter })}
          options={ROLE_OPTIONS()}
          data-testid="user-role-filter"
          className="w-44"
        />
        <Segmented<UserStatusFilter>
          label={t("us.statusFilter")}
          value={params.status}
          onChange={(status) => go({ status })}
          options={STATUS_OPTIONS()}
        />
      </div>
    </div>
  );
}
