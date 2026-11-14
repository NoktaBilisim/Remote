import type { SessionStatus } from "@remote/contracts/api/sessions";
import { Eraser } from "lucide-react";
import { t } from "@/lib/i18n";

// DESIGN.md §6.1: Bekliyor primary-surface, Aktif success, Bitti nötr, İptal danger, Süresi doldu içi boş nokta.
// "Lobide" (warning + nabız) P3 ile eklenir.
const styles: Record<SessionStatus, { pill: string; dot: string }> = {
  PENDING: { pill: "bg-primary-surface text-primary", dot: "bg-current" },
  ACTIVE: { pill: "bg-success-surface text-success", dot: "bg-current" },
  ENDED: { pill: "bg-surface-muted text-fg-muted", dot: "bg-current" },
  EXPIRED: { pill: "bg-surface-muted text-fg-muted", dot: "border border-current" },
  CANCELLED: { pill: "bg-danger-surface text-danger", dot: "bg-current" },
};

/** Oturum durumu rozeti; renk tek başına anlam taşımaz (metin her zaman var). */
export function StatusBadge({ status }: { status: SessionStatus }) {
  const s = styles[status];
  return (
    <span
      data-testid="status-badge"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${s.pill}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${s.dot}`} />
      {t(`s.status.${status}`)}
    </span>
  );
}

/**
 * P13a (AC-197): saklama süresi dolduğu için kişisel verisi silinmiş oturum. Nötr hap (`surface-muted`) + `Eraser` ikonu
 * + metin; uyarı değildir (beklenen yaşam döngüsü).
 */
export function AnonymizedBadge({ testId = "anonymized-badge" }: { testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-fg-muted"
    >
      <Eraser aria-hidden className="size-3.5" />
      {t("h.anon.badge")}
    </span>
  );
}
