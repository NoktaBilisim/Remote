"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Segmented } from "@/components/ui/segmented";
import { searchTerm } from "@/lib/customers/query";
import { t } from "@/lib/i18n";
import { tenantsHref, type TenantListParams } from "@/lib/users/tenant-query";

/** Firma arama (ad/kısa ad, ≥ 2 karakter, 300 ms) + durum (Tümü vars. / Aktif / Pasif); URL'de, değişince sayfa 1. */
export function TenantFilters({ params }: { params: TenantListParams }) {
  const router = useRouter();
  const [text, setText] = useState(params.q ?? "");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const go = (p: Partial<TenantListParams>) =>
    start(() => router.replace(tenantsHref({ q: params.q, status: params.status, ...p, page: 1 })));
  const onText = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    const q = searchTerm(v);
    if ((q === undefined && v.trim() !== "") || q === params.q) return;
    timer.current = setTimeout(() => go({ q }), 300);
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" data-testid="tenant-filters">
      <div className="flex w-full max-w-md flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {t("tn.search")}
        </label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            id={id}
            type="search"
            value={text}
            maxLength={100}
            autoComplete="off"
            placeholder={t("tn.searchPh")}
            onChange={(e) => onText(e.target.value)}
            data-testid="tenant-search"
            className="min-h-11 w-full rounded-md border border-border bg-surface pr-10 pl-9 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring sm:text-sm"
          />
          {pending && <LoaderCircle aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-fg-muted" />}
        </div>
      </div>
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
