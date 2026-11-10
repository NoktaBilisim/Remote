import { t } from "@/lib/i18n";

/** Panel içeriği yüklenirken iskelet (layout sabit kalır). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">{t("panel.loading")}</span>
      <div className="mb-4 h-4 w-32 rounded-sm bg-surface-muted" />
      <div className="h-8 w-48 rounded-md bg-surface-muted" />
      <div className="mt-6 h-36 max-w-xl rounded-lg bg-surface-muted" />
    </div>
  );
}
