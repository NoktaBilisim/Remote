import { Alert } from "@/components/ui/alert";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/** Form üstü sunucu hatası; requestId varsa destek için gösterilir (mimari §8.2). */
export function FormError({ error }: { error: UiError | null }) {
  if (!error) return null;
  return (
    <Alert tone={error.tone} testId="form-error">
      <p>{error.message}</p>
      {error.requestId && (
        <p className="mt-1 text-xs">
          {t("err.requestId")}: <span className="font-mono">{error.requestId}</span>
        </p>
      )}
    </Alert>
  );
}
