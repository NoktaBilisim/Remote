import { CircleAlert, KeyRound, MailWarning, PowerOff, ShieldAlert, ShieldQuestion, Wifi, WifiOff, type LucideIcon } from "lucide-react";
import type { DeviceListItem } from "@/lib/unattended/contract";
import { t, type MessageKey } from "@/lib/i18n";

const pill = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";
const TONES = {
  success: "bg-success-surface text-success",
  neutral: "bg-surface-muted text-fg-muted",
  warning: "bg-warning-surface text-warning",
  danger: "bg-danger-surface text-danger",
} as const;

type Flag = { key: string; Icon: LucideIcon; label: MessageKey; tone: keyof typeof TONES; hint?: MessageKey };

/** Cihaz rozetleri (mimari-p27 §6 r2): sıra durum → yerel anahtar → imza → doğrulama → bildirim → anahtar uyarısı. */
function flagsOf(d: DeviceListItem): Flag[] {
  const out: Flag[] = [
    d.online
      ? { key: "online", Icon: Wifi, label: "un.badge.online", tone: "success" }
      : { key: "offline", Icon: WifiOff, label: "un.badge.offline", tone: "neutral" },
  ];
  // P28u (AC-435): soket `consent1` bildirmedi → "Servis güncel değil" (Bağlan pasif, nedeni düğmenin altında).
  if (d.connectBlockedReason === "outdated") out.push({ key: "outdated", Icon: CircleAlert, label: "un.badge.outdated", tone: "warning" });
  if (!d.localEnabled) out.push({ key: "local", Icon: PowerOff, label: "un.badge.localOff", tone: "warning" });
  // P32 (AC-531): SHA izinli listede değil → "İzinli sürüm değil" + ne yapılacağı ipucu (ayrıntıdaki "İmza:" satırı ayrı anahtar)
  if (!d.signatureOk)
    out.push({ key: "unsigned", Icon: ShieldAlert, label: "un.badge.unsigned", tone: "warning", hint: "un.badge.unsignedHint" });
  if (!d.verified) out.push({ key: "unverified", Icon: ShieldQuestion, label: "un.badge.unverified", tone: "warning" });
  if (d.notifyFailed) out.push({ key: "notify", Icon: MailWarning, label: "un.badge.notifyFailed", tone: "danger" });
  if (d.replacedAlert) out.push({ key: "replaced", Icon: KeyRound, label: "un.badge.replaced", tone: "warning" });
  return out;
}

/** Renk tek başına anlam taşımaz: her rozette ikon + metin (AC-275, 336, 337, 339). */
export function DeviceBadges({ device }: { device: DeviceListItem }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("un.badges", { name: device.name })} data-testid="un-badges">
      {flagsOf(device).map(({ key, Icon, label, tone, hint }) => (
        <li key={key} className={`${pill} ${TONES[tone]}`} data-testid={`un-badge-${key}`} title={hint && t(hint)}>
          <Icon aria-hidden className="size-3.5" />
          {t(label)}
          {hint && <span className="sr-only">{`. ${t(hint)}`}</span>}
        </li>
      ))}
    </ul>
  );
}
