/*
 * Audit işlem (action) adlarının Türkçe etiketleri ve filtre grupları (AC-76). Ad listesi contracts'taki sabitlerden
 * (`@remote/contracts/audit`) ve sunucunun yazdığı diğer adlardan gelir; bilinmeyen ad HAM gösterilir (labels.ts kuralı).
 * Grup = adın ilk bölümü (`auth.login` → `auth`); grup filtresi API'ye `auth.*` öneki olarak gider.
 */
import { AUTH_AUDIT, BINDING_AUDIT, CONTROL_AUDIT, CUSTOMER_AUDIT, MAIL_AUDIT, RETENTION_AUDIT, SYSTEM_AUDIT, TENANT_AUDIT, USER_AUDIT } from "@remote/contracts/audit";
import { AUDIT_ACTION_GROUPS } from "./contract";
import { labelOf, OUTBOUND_REASON_LABELS, TIMELINE_ACTION_LABELS } from "@remote/contracts/labels";

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  ...TIMELINE_ACTION_LABELS,
  "auth.login": "Giriş",
  "auth.logout": "Çıkış",
  "auth.locked": "Hesap kilitlendi",
  "auth.password_change": "Şifre değiştirildi",
  [AUTH_AUDIT.MFA_SETUP]: "2FA kurulumu başlatıldı",
  [AUTH_AUDIT.MFA_ENABLED]: "2FA etkinleştirildi",
  [AUTH_AUDIT.MFA_VERIFY]: "2FA doğrulaması",
  [AUTH_AUDIT.LOGOUT_ALL]: "Tüm cihazlardan çıkış",
  [AUTH_AUDIT.PASSWORD_RESET_REQUESTED]: "Şifre sıfırlama istendi",
  [AUTH_AUDIT.PASSWORD_RESET]: "Şifre sıfırlandı",
  [USER_AUDIT.CREATED]: "Kullanıcı oluşturuldu",
  [USER_AUDIT.UPDATED]: "Kullanıcı güncellendi",
  [USER_AUDIT.PERMISSION_CHANGED]: "Yetki değiştirildi",
  [USER_AUDIT.DEACTIVATED]: "Kullanıcı pasife alındı",
  [USER_AUDIT.REACTIVATED]: "Kullanıcı yeniden etkinleştirildi",
  [USER_AUDIT.MFA_RESET]: "2FA sıfırlandı",
  [TENANT_AUDIT.CREATED]: "Firma oluşturuldu",
  [TENANT_AUDIT.UPDATED]: "Firma güncellendi",
  [TENANT_AUDIT.DEACTIVATED]: "Firma pasife alındı",
  [TENANT_AUDIT.REACTIVATED]: "Firma yeniden etkinleştirildi",
  [TENANT_AUDIT.SWITCHED]: "Firmaya geçildi",
  [TENANT_AUDIT.SETTINGS_UPDATED]: "Firma ayarları güncellendi",
  [MAIL_AUDIT.SENT]: "E-posta gönderildi",
  [MAIL_AUDIT.SESSION_EMAIL]: "Oturum bağlantısı e-postası",
  [MAIL_AUDIT.SMTP_TEST]: "SMTP test maili",
  [MAIL_AUDIT.EMAIL_TEST]: "Talep bildirimi test maili",
  "settings.whatsapp.test": "WhatsApp test mesajı",
  "settings.support_requests.updated": "Talep ayarları güncellendi",
  "settings.support_requests.ref_rotated": "Talep bağlantısı yenilendi",
  [SYSTEM_AUDIT.CONSENT_TEXT_UPDATED]: "Aydınlatma metni yeni sürüm",
  [SYSTEM_AUDIT.MYSQL_UPDATED]: "MySQL ayarı güncellendi",
  [SYSTEM_AUDIT.MYSQL_TEST]: "MySQL bağlantı testi",
  [SYSTEM_AUDIT.TURN_UPDATED]: "TURN ayarı güncellendi",
  [SYSTEM_AUDIT.TURN_DELETED]: "TURN ortam değerlerine döndü",
  [SYSTEM_AUDIT.WHATSAPP_UPDATED]: "WhatsApp servis adresi güncellendi",
  [SYSTEM_AUDIT.WHATSAPP_DELETED]: "WhatsApp servisi ortam değerine döndü",
  [SYSTEM_AUDIT.AUDIT_EXPORTED]: "Audit log dışa aktarıldı",
  "session.updated": "Oturum notu/ticket güncellendi",
  "session.exported": "Oturum geçmişi dışa aktarıldı",
  "session.resolve": "Oturum bağlantısı açıldı",
  "session.join": "Müşteri katıldı",
  "file.transfer": "Dosya aktarımı",
  "file.transfer.sender_report": "Dosya gönderim raporu",
  "file.meta.rejected_by_db": "Dosya kaydı reddedildi",
  "file.meta.rate_limited": "Dosya teklifi sınırlandı",
  "request.created": "Talep oluşturuldu",
  "request.accepted": "Talep kabul edildi",
  "request.rejected": "Talep reddedildi",
  "request.cancelled": "Talep iptal edildi",
  "request.expired": "Talebin süresi doldu",
  "request.connect_failed": "Talep bağlanamadı",
  "request.notify": "Talep bildirimi",
  "request.rate_limited": "Talep sınırlandı",
  [CUSTOMER_AUDIT.CREATED]: "Müşteri oluşturuldu",
  [CUSTOMER_AUDIT.UPDATED]: "Müşteri güncellendi",
  [CUSTOMER_AUDIT.REF_ROTATED]: "Müşteri bağlantısı yenilendi",
  [CUSTOMER_AUDIT.DEACTIVATED]: "Müşteri pasife alındı",
  [CUSTOMER_AUDIT.REACTIVATED]: "Müşteri yeniden etkinleştirildi",
  [CUSTOMER_AUDIT.ANONYMIZED]: "Müşteri anonimleştirildi",
  [BINDING_AUDIT.ISSUED]: "Bilgisayar kaydedildi",
  [BINDING_AUDIT.REVOKED]: "Bilgisayar kaydı iptal edildi",
  [BINDING_AUDIT.DENIED]: "Bilgisayar kaydı reddedildi",
  [CONTROL_AUDIT.CAPS_CHANGED]: "Teknisyen yetkileri daraldı",
  // P13a (AC-199): günlük saklama işi (sistem, yalnız sayılar)
  [RETENTION_AUDIT.RUN]: "Saklama süresi işi",
};

/** Dış gönderim `reason` etiketleri tek kaynak: contracts (`OUTBOUND_REASON_LABELS`, mimari-p13 §3). */
export { OUTBOUND_REASON_LABELS };
export const reasonLabel = (reason: string): string => labelOf(OUTBOUND_REASON_LABELS, reason);

/** Grup (adın ilk bölümü) → Türkçe başlık: contracts `AUDIT_ACTION_GROUPS` (`auth.*` → "Giriş ve hesap güvenliği"). */
export const AUDIT_GROUP_LABELS: Readonly<Record<string, string>> = { ...Object.fromEntries(AUDIT_ACTION_GROUPS.map((g) => [g.prefix.slice(0, -2), g.label])) };

export const groupOf = (action: string): string => action.split(".")[0] ?? action;
export const actionLabel = (action: string): string => labelOf(AUDIT_ACTION_LABELS, action);
export const groupLabel = (group: string): string => labelOf(AUDIT_GROUP_LABELS, group);

export interface ActionOptionGroup {
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Filtre seçenekleri: grup başına önce "<grup> — tümü" (`grup.*`), sonra tam adlar (etikete göre sıralı).
 * `selected` listede yoksa (ör. URL'den gelen bilinmeyen ad) ham haliyle eklenir → seçim kaybolmaz.
 */
export function actionOptionGroups(selected?: string, extra: readonly string[] = []): ActionOptionGroup[] {
  const names = new Set([...Object.keys(AUDIT_ACTION_LABELS), ...extra]);
  if (selected && !selected.endsWith(".*")) names.add(selected);
  const byGroup = new Map<string, string[]>();
  for (const a of names) {
    const g = groupOf(a);
    byGroup.set(g, [...(byGroup.get(g) ?? []), a]);
  }
  if (selected?.endsWith(".*") && !byGroup.has(selected.slice(0, -2))) byGroup.set(selected.slice(0, -2), []);
  return [...byGroup.entries()]
    .map(([g, acts]) => ({ g, label: groupLabel(g), acts }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"))
    .map(({ g, label, acts }) => ({
      label,
      options: [
        { value: `${g}.*`, label: `${label} — tümü` },
        ...acts.map((a) => ({ value: a, label: actionLabel(a) })).sort((x, y) => x.label.localeCompare(y.label, "tr")),
      ],
    }));
}

/**
 * Dış gönderim / test kayıtları (`mail.*`, `session.email`, `settings.*.test`): detayda yalnız `reason` gösterilir
 * (sunucu da süzer; arayüz ek alan basmaz — alıcı, konu, ham hata ekrana gelmez).
 */
const MAIL_ACTIONS: ReadonlySet<string> = new Set(Object.values(MAIL_AUDIT));
export const isMailAction = (action: string): boolean => MAIL_ACTIONS.has(action) || groupOf(action) === "mail" || /^settings\.[a-z_]+\.test$/.test(action);

export type AuditPayload = { kind: "json"; oldValue: string | null; newValue: string | null } | { kind: "reason"; reason: string | null };

const pretty = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};
const reasonOf = (v: unknown): string | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = (v as Record<string, unknown>).reason;
  return typeof r === "string" || typeof r === "number" ? String(r) : null;
};

/** Detay diyaloğunda gösterilecek değer (düz metin; HTML olarak YORUMLANMAZ — çağıran `<pre>` metin düğümüne basar). */
export function auditPayload(item: { action: string; oldValue: unknown; newValue: unknown }): AuditPayload {
  if (isMailAction(item.action)) return { kind: "reason", reason: reasonOf(item.newValue) ?? reasonOf(item.oldValue) };
  return { kind: "json", oldValue: pretty(item.oldValue), newValue: pretty(item.newValue) };
}
