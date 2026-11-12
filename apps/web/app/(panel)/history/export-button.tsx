"use client";

import { CsvExportButton } from "@/components/csv-export-button";
import { exportApiPath, type HistoryFilters } from "@/lib/history/query";
import { t } from "@/lib/i18n";

/** "Dışa aktar (CSV)" (AC-63, 124): yalnız session_history.export yetkisinde render edilir (sunucu da denetler). */
export function ExportButton({ filters }: { filters: Partial<HistoryFilters> }) {
  return <CsvExportButton path={exportApiPath(filters)} label={t("h.export")} hint={t("h.exportHint")} fallbackName="oturumlar.csv" />;
}
