import { Lock, User, UserX, type LucideIcon } from "lucide-react";
import { t } from "@/lib/i18n";
import { DEVICE_USER_STATE_LABELS, type DeviceUserState } from "@/lib/unattended/contract";

const ICONS: Readonly<Record<DeviceUserState, LucideIcon>> = { active: User, locked: Lock, none: UserX };

/**
 * P28u (§10, AC-429): cihazdaki kullanıcı durumu — Aktif (`User`) / Kilitli (`Lock`) / Oturum yok (`UserX`); bilinmiyorsa
 * (çevrimdışı, eski servis, sunucu henüz göndermiyor) "—". Renk anlam taşımaz: ikon + metin.
 */
export function UserState({ state }: { state: DeviceUserState | null | undefined }) {
  if (!state)
    return (
      <span className="text-fg-muted" data-testid="un-user-state" data-state="unknown">
        <span aria-hidden>—</span>
        <span className="sr-only">{t("un.user.unknown")}</span>
      </span>
    );
  const Icon = ICONS[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-fg" data-testid="un-user-state" data-state={state}>
      <Icon aria-hidden className="size-4 text-fg-muted" />
      {DEVICE_USER_STATE_LABELS[state]}
    </span>
  );
}
