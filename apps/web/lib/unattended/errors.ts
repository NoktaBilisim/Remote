/*
 * P27 hata kodları → Türkçe metin (contracts `UNATTENDED_ERROR_MESSAGES`, mimari-p27 §4.3) ve düğme pasiflik nedenleri
 * (AC-336: sunucunun `canConnect` / `connectBlockedReason` alanları; istemci yeniden hesaplamaz).
 */
import { ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import {
  CONNECT_BLOCKED_REASON_LABELS,
  UNATTENDED_ERROR_MESSAGES,
  UNATTENDED_OFF_BANNER,
  type DeviceListItem,
  type UnattendedStatus,
} from "./contract";

const MESSAGES: Readonly<Record<string, string>> = UNATTENDED_ERROR_MESSAGES;

/** API/ağ hatası → kullanıcı metni. P27 kodları sözleşme metniyle; 404 varlık sızdırmaz ("bulunamadı ya da yetkiniz yok"). */
export function unattendedUiError(e: unknown): UiError {
  if (e instanceof ApiError) {
    const known = Object.hasOwn(MESSAGES, e.code) ? MESSAGES[e.code] : undefined;
    if (known) return { message: known, tone: "danger", requestId: e.requestId };
    if (e.status === 404) return { message: t("un.err.notFound"), tone: "danger", requestId: e.requestId };
    if (e.status === 403 && e.code === "FORBIDDEN") return { message: t("un.err.forbidden"), tone: "danger" };
  }
  return toUiError(e);
}

/** 409 `NOTIFY_CHANNEL_UNAVAILABLE`: tenant'ın SMTP kaydı yok (AC-336). */
export const isSmtpMissing = (e: unknown): boolean => e instanceof ApiError && e.code === "NOTIFY_CHANNEL_UNAVAILABLE";

/** 409 `NOTIFY_CONTACT_REQUIRED`: müşteride bildirim adresi yok (AC-296). */
export const isContactMissing = (e: unknown): boolean => e instanceof ApiError && e.code === "NOTIFY_CONTACT_REQUIRED";

/** Kapı açık mı (durum alınamadıysa kapalı sayılır — fail-closed; sunucu da her uçta denetler). */
export const gateOpen = (status: UnattendedStatus | null): boolean => status?.available === true;

/** "Bağlan" pasif nedeni; null = etkin. Kapı kapalıysa bant metni, değilse sunucunun nedeni. */
export function connectBlock(d: Pick<DeviceListItem, "canConnect" | "connectBlockedReason">, available: boolean): string | null {
  if (!available) return UNATTENDED_OFF_BANNER;
  if (d.canConnect) return null;
  return CONNECT_BLOCKED_REASON_LABELS[d.connectBlockedReason ?? "no_grant"];
}

/**
 * "Kayıt kodu oluştur" pasif nedeni; null = etkin. Kapı kapalıysa (ya da durum alınamadıysa) bant metni; firmanın SMTP kaydı
 * yoksa (`status.notifyChannel=false`, AC-336) SMTP nedeni — cihaz listesinden bağımsız, baştan.
 */
export function createCodeBlock(status: UnattendedStatus | null): string | null {
  if (!gateOpen(status)) return UNATTENDED_OFF_BANNER;
  return status?.notifyChannel === false ? CONNECT_BLOCKED_REASON_LABELS.smtp : null;
}
