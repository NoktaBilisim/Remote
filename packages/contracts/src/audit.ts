// Uzaktan kontrol audit zaman çizelgesi action adları (P7; AC-111, AC-115, G-15). Sunucu yazar, oturum geçmişi (P8)
// aynı adlarla okur. Önceki paketlerin action'ları kendi modüllerinde kalır; yeni zaman çizelgesi olayları buraya eklenir.

export const CONTROL_AUDIT = {
  /** Teknisyen isteği müşteriye iletildi (oturum başına ≤ 5). */
  REQUESTED: "control.requested",
  /** Müşteri izin verdi — yazılamazsa kontrol geri alınır (fail-closed). */
  GRANTED: "control.granted",
  /** Müşteri reddetti. */
  DENIED: "control.denied",
  /** Kapanış: müşteri (UI/HOTKEY), yeniden bağlanma (RECONNECT) veya sunucu (SYSTEM: permission/audit/admin/session_ended). */
  REVOKED: "control.revoked",
  /** Teknisyen açık kontrolü bıraktı (REVOKED/TECH; §3.3 K1). */
  RELEASED: "control.released",
  /** Teknisyen bekleyen isteği geri çekti (consent satırı yok; §3.3 K2). */
  CANCELLED: "control.cancelled",
  /** Teknisyenin monitör değiştirme isteği iletildi (AC-43). */
  MONITOR_REQUESTED: "monitor.requested",
  /** Müşteri istenen monitörü paylaşmaya başladı (`share.state.activeMonitor`; §3 tablo). */
  MONITOR_GRANTED: "monitor.granted",
  /** Müşteri monitör isteğini reddetti (§3.3 K4). */
  MONITOR_DENIED: "monitor.denied",
  /** Teknisyen yetkisi daraldı; oda yetenekleri (`caps`) güncellendi (AC-115, G-09). */
  CAPS_CHANGED: "session.caps_changed",
} as const;
export type ControlAuditAction = (typeof CONTROL_AUDIT)[keyof typeof CONTROL_AUDIT];

/** P8c müşteri ve bilgisayar kaydı audit eylemleri (mimari-e10 §5.7, §15). Entity `customer` / `device_bindings`. */
export const CUSTOMER_AUDIT = {
  CREATED: "customer.created",
  UPDATED: "customer.updated",
  REF_ROTATED: "customer.ref_rotated",
  DEACTIVATED: "customer.deactivated",
  REACTIVATED: "customer.reactivated",
  ANONYMIZED: "customer.anonymized",
} as const;
export const BINDING_AUDIT = {
  ISSUED: "binding.issued",
  REVOKED: "binding.revoked",
  /** r2 §15.1: bayat kaynaktan kayıt istendi (actor customer, entity_id NULL). */
  DENIED: "binding.denied",
} as const;

/**
 * P9 kullanıcı/yetki/firma yönetimi audit eylemleri (AC-70, AC-74; ortak standart 1.3). Entity `users` / `tenants` /
 * `tenant_settings`. `user.permission_changed`: anahtar başına bir satır — kim (user_id), kime (entity_id),
 * hangi yetki (`permKey`), eski → yeni (`granted`).
 */
export const USER_AUDIT = {
  CREATED: "user.created",
  UPDATED: "user.updated",
  PERMISSION_CHANGED: "user.permission_changed",
  DEACTIVATED: "user.deactivated",
  REACTIVATED: "user.reactivated",
  /** P10 (AC-115): Admin kullanıcının 2FA'sını sıfırladı (oturumlar iptal, canlı odalar biter). */
  MFA_RESET: "user.mfa_reset",
} as const;

/**
 * P10 hesap güvenliği audit eylemleri (AC-65..68; ortak standart 1.1). Entity `users` / `auth_sessions`.
 * Kod, sır, token, kurtarma kodu ASLA yazılmaz (mask.ts ayrıca `code|totp|recovery|token` anahtarlarını maskeler).
 */
export const AUTH_AUDIT = {
  MFA_SETUP: "auth.mfa_setup",
  MFA_ENABLED: "auth.mfa_enabled",
  /** Giriş sonrası 2FA doğrulaması (`method`: totp | recovery; başarısızda `reason`). */
  MFA_VERIFY: "auth.mfa_verify",
  LOGOUT_ALL: "auth.logout_all",
  PASSWORD_RESET_REQUESTED: "auth.password_reset_requested",
  PASSWORD_RESET: "auth.password_reset",
} as const;

/** P10: gönderilen her e-posta (ortak standart 2.1: alıcı (maskeli), konu, sonuç). `kind` şablon türü. */
export const MAIL_AUDIT = {
  SENT: "mail.sent",
  /** AC-10: oturum bağlantısı e-postası isteği (20/sa sayımı bu satırlardan, yeniden başlatmaya dayanıklı). */
  SESSION_EMAIL: "session.email",
  SMTP_TEST: "settings.smtp.test",
  EMAIL_TEST: "settings.email.test",
} as const;
export const TENANT_AUDIT = {
  CREATED: "tenant.created",
  UPDATED: "tenant.updated",
  DEACTIVATED: "tenant.deactivated",
  REACTIVATED: "tenant.reactivated",
  SWITCHED: "tenant.switched",
  SETTINGS_UPDATED: "tenant_settings.updated",
} as const;
