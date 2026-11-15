"use client";

import { CalendarOff } from "lucide-react";
import { useUnauthRedirect } from "@/components/settings/use-unauth";
import { SelectField } from "@/components/ui/select-field";
import { t } from "@/lib/i18n";
import { HOLIDAYS_MAX, holidayYears } from "@/lib/requests/business-hours";
import { AddHolidayDialog, HolidayActions, HolidayList, RemoveHolidayDialog } from "./holiday-parts";
import { useHolidayAdd, useHolidayImport, useHolidayList, useHolidayRemove } from "./use-holidays";

/**
 * Tatiller (AC-258; §8b.8): yıl seçimi, liste, ekle, sil (onaylı), "Resmî tatilleri ekle (yıl)". Firma başına en çok
 * `HOLIDAYS_MAX` gün (sunucu 409). `canEdit` yoksa yalnız liste.
 */
export function HolidaysSection({ initialYear, canEdit }: { initialYear: number; canEdit: boolean }) {
  const unauth = useUnauthRedirect();
  const list = useHolidayList(initialYear, unauth);
  const add = useHolidayAdd(list.year, list.setItems, unauth);
  const rm = useHolidayRemove(list.setItems, unauth);
  const imp = useHolidayImport(list.year, list.fetchYear, unauth);

  return (
    <section aria-labelledby="hd-h" className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6" data-testid="hd-section">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="hd-h" className="flex items-center gap-2 text-base font-semibold text-fg">
          <CalendarOff aria-hidden className="size-5 text-fg-muted" />
          {t("hd.title")}
        </h2>
        <SelectField
          label={t("hd.year")}
          className="sm:w-40"
          value={String(list.year)}
          onChange={(e) => list.changeYear(Number(e.target.value))}
          options={holidayYears(initialYear).map((y) => ({ value: String(y), label: String(y) }))}
          data-testid="hd-year"
        />
      </div>
      <p className="mt-2 text-sm text-fg-muted">{t("hd.body", { max: HOLIDAYS_MAX })}</p>
      <HolidayActions year={list.year} canEdit={canEdit} onAdd={add.openAdd} imp={imp} />
      <HolidayList list={list} canEdit={canEdit} onRemove={rm.ask} />
      <AddHolidayDialog a={add} />
      <RemoveHolidayDialog r={rm} />
    </section>
  );
}
