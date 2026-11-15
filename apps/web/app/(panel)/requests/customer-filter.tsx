"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CustomerCombobox } from "@/components/customer-combobox";
import type { ComboOption } from "@/components/ui/combobox";
import { SelectField } from "@/components/ui/select-field";
import { t } from "@/lib/i18n";

type Mode = "" | "general" | "customer";

/** Mod ve seçili firma durumu; seçim değişince sayfa (`page` silinir) `?customer=` ile yeniden açılır. */
function useCustomerFilter(value: string | undefined, selectedName: string | undefined, basePath: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initialMode: Mode = value === "general" ? "general" : value ? "customer" : "";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [picked, setPicked] = useState<ComboOption | null>(
    value && value !== "general" ? { id: value, label: selectedName ?? t("rq.cf.selected") } : null,
  );

  const go = (customer?: string) => {
    const u = new URL(basePath, "http://x");
    u.searchParams.delete("page");
    if (customer) u.searchParams.set("customer", customer);
    else u.searchParams.delete("customer");
    start(() => router.push(u.pathname + u.search));
  };
  const changeMode = (m: Mode) => {
    setMode(m);
    if (m === "") go();
    else if (m === "general") go("general");
    else if (picked) go(picked.id);
  };
  const pick = (o: ComboOption | null) => {
    setPicked(o);
    if (o) go(o.id);
  };
  return { pending, mode, picked, changeMode, pick };
}

/**
 * Talepler müşteri filtresi (AC-176): `SelectField` Tümü / Genel / Müşteri firma + combobox (pasifler dahil).
 * Durum URL'de (`?customer=general|<id>`), kuyrukta ve Geçmiş sekmesinde aynı. `hrefFor` sayfa yolunu üretir.
 */
export function RequestCustomerFilter({ value, selectedName, basePath }: { value?: string; selectedName?: string; basePath: string }) {
  const { pending, mode, picked, changeMode, pick } = useCustomerFilter(value, selectedName, basePath);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start" data-testid="request-customer-filter" aria-busy={pending || undefined}>
      <SelectField
        label={t("rq.cf.label")}
        value={mode}
        className="sm:w-56"
        onChange={(e) => changeMode(e.target.value as Mode)}
        options={[
          { value: "", label: t("rq.cf.all") },
          { value: "general", label: t("rq.cf.general") },
          { value: "customer", label: t("rq.cf.customer") },
        ]}
        data-testid="request-customer-mode"
      />
      {mode === "customer" && (
        <div className="sm:w-80">
          <CustomerCombobox label={t("rq.cf.pick")} status="all" value={picked} onChange={pick} testId="request-customer-combobox" />
        </div>
      )}
    </div>
  );
}
