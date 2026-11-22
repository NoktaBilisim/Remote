import { CircleCheck, Clock, RefreshCw, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { DeviceUpdateBadge } from "@/lib/unattended/contract";
import { updateBadgeLabel, updateTarget } from "@/lib/unattended/update";

const pill = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium";

/**
 * P29 rozet görünümü (mimari-p29 §6): renk yalnız ek bilgi, her rozette ikon + metin. "Güncelleniyor" ikonu dönmez
 * (hareket yok). "Asgari sürümün altında" tehlike tokenı (AC-486).
 */
const LOOK: Record<DeviceUpdateBadge, { Icon: LucideIcon; tone: string }> = {
  CURRENT: { Icon: CircleCheck, tone: "bg-success-surface text-success" },
  PENDING: { Icon: Clock, tone: "bg-accent-surface text-accent-fg" },
  UPDATING: { Icon: RefreshCw, tone: "bg-accent-surface text-accent-fg" },
  FAILED: { Icon: TriangleAlert, tone: "bg-warning-surface text-warning" },
  BELOW_MIN: { Icon: ShieldAlert, tone: "bg-danger-surface text-danger" },
};

/**
 * Sürüm + rozet (AC-490). Eski sunucu alanları göndermezse "—" (rozet yok). `stacked` (masaüstü tablo, T-P29-1): sürüm üstte,
 * rozet altta ve dar (`max-w-36`, metin sarar) → 1280 px'te tablo kapsayıcısı yatay kaymaz; kartta tek satır akar.
 */
export function UpdateBadge({
  version,
  badge,
  reason,
  target,
  stacked = false,
}: {
  version: string | undefined;
  badge: DeviceUpdateBadge | undefined;
  reason?: string | null | undefined;
  target?: string | null | undefined;
  stacked?: boolean;
}) {
  if (!version) return <span className="text-fg-muted">—</span>;
  const look = badge ? LOOK[badge] : null;
  const to = badge ? updateTarget(badge, version, target) : null;
  return (
    <span className={stacked ? "flex flex-col items-start gap-1" : "inline-flex flex-wrap items-center gap-1.5"} data-testid="upd-version">
      <span className="font-mono">{version}</span>
      {badge && look && (
        <span
          className={`${pill} ${look.tone} ${stacked ? "max-w-36 items-start rounded-md" : "whitespace-nowrap"}`}
          data-testid="upd-badge"
          data-badge={badge}
        >
          <look.Icon aria-hidden className={`size-3.5 shrink-0 ${stacked ? "mt-0.5" : ""}`} />
          <span>
            {updateBadgeLabel(badge, reason)}
            {to && <span className="font-mono whitespace-nowrap"> → {to}</span>}
          </span>
        </span>
      )}
    </span>
  );
}
