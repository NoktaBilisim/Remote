"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { searchTerm } from "@/lib/customers/query";
import { t } from "@/lib/i18n";
import type { UserRoleFilter, UserStatusFilter } from "@/lib/users/contract";
import { usersHref, type UserListParams } from "@/lib/users/query";

const SEARCH_DELAY_MS = 300;

/**
 * Arama (ad/e-posta; ≥ 2 karakter, 300 ms) + rol seçimi + durum `Segmented` (Aktif vars. / Pasif / Tümü). Durum URL'de;
 * değişince sayfa 1. Müşteri filtresiyle aynı davranış (customers/customer-filters.tsx).
 */
export function UserFilters({ params }: { params: UserListParams }) {
  const router = useRouter();
  const [text, setText] = useState(params.q ?? "");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const go = (p: Partial<UserListParams>) => start(() => router.replace(usersHref({ q: params.q, role: params.role, status: params.status, ...p, page: 1 })));

  const onText = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    const q = searchTerm(v);
    if (q === undefined && v.trim() !== "") return;
    if (q === params.q) return;
    timer.current = setTimeout(() => go({ q }), SEARCH_DELAY_MS);
  };

  const short = text.trim() !== "" && searchTerm(text) === undefined;
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end" data-testid="user-filters">
      <div className="flex w-full max-w-md flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-fg">{t("us.search")}</label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            id={id}
            type="search"
            value={text}
            maxLength={100}
            autoComplete="off"
            placeholder={t("us.searchPh")}
            aria-describedby={`${id}-hint`}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (timer.current) clearTimeout(timer.current);
                const q = searchTerm(text);
                if (q !== undefined || text.trim() === "") go({ q });
              }
            }}
            data-testid="user-search"
            className="min-h-11 w-full rounded-md border border-border bg-surface pr-10 pl-9 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring sm:text-sm"
          />
          {pending && <LoaderCircle aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-fg-muted" />}
        </div>
        <p id={`${id}-hint`} className={`text-xs ${short ? "text-warning" : "text-fg-muted"}`} role={short ? "status" : undefined}>
          {short ? t("us.searchShort") : t("us.searchHint")}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 lg:ml-auto lg:pb-5">
        <SelectField
          label={t("us.roleFilter")}
          hideLabel
          value={params.role}
          onChange={(e) => go({ role: e.target.value as UserRoleFilter })}
          options={[
            { value: "all", label: t("us.filter.roleAll") },
            { value: "USER", label: t("role.USER") },
            { value: "ADMIN", label: t("role.ADMIN") },
          ]}
          data-testid="user-role-filter"
          className="w-44"
        />
        <Segmented<UserStatusFilter>
          label={t("us.statusFilter")}
          value={params.status}
          onChange={(status) => go({ status })}
          options={[
            { value: "active", label: t("us.filter.active") },
            { value: "passive", label: t("us.filter.passive") },
            { value: "all", label: t("us.filter.all") },
          ]}
        />
      </div>
    </div>
  );
}
