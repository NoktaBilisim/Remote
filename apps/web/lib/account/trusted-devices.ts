/*
 * P27a — "Bu cihazı 30 gün hatırla" web yardımcıları (mimari-p27a §4, §6; AC-325, AC-329). Bileşenlerden ayrık saf işlevler
 * (vitest ortamı node; bileşen testi altyapısı yok).
 */
import type { TrustedDeviceView } from "@remote/contracts/api/auth";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

export type MfaVerifyBody = { code: string; rememberDevice?: true } | { recoveryCode: string };

/**
 * POST /auth/mfa/verify gövdesi (AC-325): `rememberDevice` yalnız kod modunda, politika izin verirken ve kutu işaretliyse
 * gönderilir; kurtarma koduyla asla (sunucu 400 döner).
 */
export function mfaVerifyBody(mode: "code" | "recovery", value: string, remember: boolean, available: boolean): MfaVerifyBody {
  if (mode === "recovery") return { recoveryCode: value };
  return available && remember ? { code: value, rememberDevice: true } : { code: value };
}

/** Satırın tarih/kullanım özeti (tr-TR yerel saat): hatırlandı · son kullanım (yoksa "henüz yok") · bitiş. */
export function deviceMeta(d: Pick<TrustedDeviceView, "createdAt" | "lastUsedAt" | "expiresAt">): string[] {
  return [
    t("acc.td.created", { at: formatDateTime(d.createdAt) }),
    d.lastUsedAt ? t("acc.td.lastUsed", { at: formatDateTime(d.lastUsedAt) }) : t("acc.td.never"),
    t("acc.td.expires", { at: formatDateTime(d.expiresAt) }),
  ];
}
