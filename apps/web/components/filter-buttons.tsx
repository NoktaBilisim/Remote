"use client";

import { Filter, FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/** Filtre formu düğmeleri: "Filtrele" (submit, bekleme çarkı) + "Temizle" (geçmiş ve audit filtreleri). */
export function FilterButtons({ pending, onClear, className }: { pending: boolean; onClear: () => void; className: string }) {
  return (
    <div className={className}>
      <Button type="submit" loading={pending} data-testid="filter-apply">
        {!pending && <Filter aria-hidden className="size-4" />}
        {t("h.f.apply")}
      </Button>
      <Button type="button" variant="ghost" onClick={onClear} disabled={pending} data-testid="filter-clear">
        <FilterX aria-hidden className="size-4" />
        {t("h.f.clear")}
      </Button>
    </div>
  );
}
