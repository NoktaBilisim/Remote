import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/**
 * Formun içindeki yapışkan "kaydedilmemiş değişiklik" çubuğu (destek talepleri, SMS): mesaj + geri al (mobilde
 * yalnız ikon) + Kaydet (`type="submit"`). Görünürlük koşulu çağıranda (`dirty || saving`).
 */
export function DirtyBar({
  saving,
  onRevert,
  revertClassName,
  submitClassName,
  submitTestId,
}: {
  saving: boolean;
  onRevert: () => void;
  revertClassName?: string;
  submitClassName?: string;
  submitTestId?: string;
}) {
  return (
    <div
      className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg sm:px-4 sm:py-3"
      data-testid="save-bar"
    >
      <p className="min-w-0 flex-1 text-xs font-medium text-warning sm:text-sm" role="status">
        {t("srs.dirty")}
      </p>
      <Button type="button" variant="ghost" className={revertClassName} disabled={saving} onClick={onRevert}>
        <RotateCcw aria-hidden className="size-4" />
        <span className="sr-only sm:not-sr-only">{t("srs.revert")}</span>
      </Button>
      <Button type="submit" loading={saving} className={submitClassName} data-testid={submitTestId}>
        {!saving && <Save aria-hidden className="size-4" />}
        {t("srs.save")}
      </Button>
    </div>
  );
}
