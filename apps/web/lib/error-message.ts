import { ApiError, NetworkError } from "@/lib/api";
import { t } from "@/lib/i18n";

export interface UiError {
  message: string;
  requestId?: string;
  tone: "danger" | "locked";
}

/** API/ağ hatasını kullanıcıya gösterilecek Türkçe mesaja çevirir. */
export function toUiError(e: unknown, byStatus: Partial<Record<number, string>> = {}): UiError {
  if (e instanceof NetworkError) return { message: t("err.network"), tone: "danger" };
  if (e instanceof ApiError) {
    if (e.status === 423) {
      // T-1: süre Retry-After'dan (sn → yukarı yuvarlanmış dakika); yoksa süresiz metin
      const message = e.retryAfter
        ? t("login.error.locked", { minutes: Math.max(1, Math.ceil(e.retryAfter / 60)) })
        : t("login.error.lockedNoTime");
      return { message, tone: "locked" };
    }
    if (e.status === 429) return { message: e.message || t("login.error.rateLimited"), tone: "locked" };
    const mapped = byStatus[e.status];
    if (mapped) return { message: mapped, tone: "danger" };
    // P28e-K10 (D-3): 500'de sunucu metni gösterilmez (iç ayrıntı sızmasın); genel Türkçe metin + istek kimliği
    if (e.status === 500) return { message: t("err.generic"), requestId: e.requestId, tone: "danger" };
    return { message: e.message || t("err.generic"), requestId: e.requestId, tone: "danger" };
  }
  return { message: t("err.generic"), tone: "danger" };
}

/**
 * Sunucu mesajı başlıkla aynı cümleyle başlıyorsa o cümleyi atar (TO-P2-1: başlık + tek açıklama).
 * Karşılaştırma büyük/küçük harf ve sondaki noktalama duyarsız; kalan metin boşsa "" döner.
 */
export function withoutLeadingTitle(message: string, title: string): string {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/[.!?:]+$/, "")
      .toLocaleLowerCase("tr");
  const m = /^\s*([^.!?]*[.!?]*)\s*([\s\S]*)$/.exec(message);
  if (!m || norm(m[1] ?? "") !== norm(title)) return message.trim();
  return (m[2] ?? "").trim();
}
