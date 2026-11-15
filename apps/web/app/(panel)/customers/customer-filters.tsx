"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Segmented } from "@/components/ui/segmented";
import type { CustomerStatusFilter } from "@/lib/customers/contract";
import { customersHref, searchTerm, type CustomerListParams } from "@/lib/customers/query";
import { t } from "@/lib/i18n";

const SEARCH_DELAY_MS = 300;

/**
 * Arama + durum filtresi (AC-166): en az 2 karakterde 300 ms sonra URL güncellenir (katlama sunucuda — harf ve Türkçe
 * karakter duyarsız). Boşaltınca arama kalkar. Durum `Segmented` Aktif (vars.) / Pasif / Tümü; değişince sayfa 1.
 */
export function CustomerFilters({ params }: { params: CustomerListParams }) {
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

  const go = (p: Partial<CustomerListParams>) =>
    start(() => router.replace(customersHref({ q: params.q, status: params.status, ...p, page: 1 })));

  const onText = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    const q = searchTerm(v);
    // 1 karakter: arama yapılmaz (önceki sonuç kalır); boş: arama kalkar
    if (q === undefined && v.trim() !== "") return;
    if (q === params.q) return;
    timer.current = setTimeout(() => go({ q }), SEARCH_DELAY_MS);
  };

  const short = text.trim() !== "" && searchTerm(text) === undefined;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" data-testid="customer-filters">
      <div className="flex w-full max-w-md flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {t("cu.search")}
        </label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            id={id}
            type="search"
            value={text}
            maxLength={100}
            autoComplete="off"
            placeholder={t("cu.searchPh")}
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
            data-testid="customer-search"
            className="min-h-11 w-full rounded-md border border-border bg-surface pr-10 pl-9 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring sm:text-sm"
          />
          {pending && <LoaderCircle aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-fg-muted" />}
        </div>
        <p id={`${id}-hint`} className={`text-xs ${short ? "text-warning" : "text-fg-muted"}`} role={short ? "status" : undefined}>
          {short ? t("cu.searchShort") : t("cu.searchHint")}
        </p>
      </div>
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
