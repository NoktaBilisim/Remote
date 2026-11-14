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
  /** P13b (mimari-p13 §7.7): sunucudaki `reset-superadmin` CLI'si; `username="cli"`, parola/hash yazılmaz. */
  SUPERADMIN_RESET: "auth.superadmin_reset",
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

/**
 * P11 sistem ayarları, aydınlatma metni ve audit dışa aktarımı (AC-76, 77, 78, 124; AC-29). Entity `system_settings`
 * (entity_id `mysql` | `turn`), `consent_texts`, `audit_logs`. Şifre / TURN secret / metin gövdesi ASLA yazılmaz:
 * değişiklik yalnız `password: "***"` / `secret: "***"` anahtarının varlığıyla görünür (mask.ts), metin için
 * `{ version, sha256 }`. Test sonucu yalnız `reason` sınıfını taşır (ham sürücü hatası yalnız server logunda).
 */
export const SYSTEM_AUDIT = {
  MYSQL_UPDATED: "settings.mysql.updated",
  MYSQL_TEST: "settings.mysql.test",
  TURN_UPDATED: "settings.turn.updated",
  /** Panel kaydı silindi; TURN yeniden env'den (`TURN_URLS`/`TURN_SECRET`). */
  TURN_DELETED: "settings.turn.deleted",
  /** P12b (AC-196): WhatsApp servis adresi `{url}` eski→yeni (gizli değil). */
  WHATSAPP_UPDATED: "settings.whatsapp.updated",
  /** Panel kaydı kaldırıldı; adres yeniden env'den (`WHATSAPP_SERVICE_URL`). */
  WHATSAPP_DELETED: "settings.whatsapp.deleted",
  /** Super Admin testi `{phone(maske), result, reason}`; tenant testi (AC-152) aynı eylem, entity tenant_request_settings. */
  WHATSAPP_TEST: "settings.whatsapp.test",
  CONSENT_TEXT_UPDATED: "settings.consent_text.updated",
  /** Audit CSV dışa aktarımı: filtre özeti + satır sayısı. */
  AUDIT_EXPORTED: "audit.exported",
} as const;

/**
 * P12 marka/kişiselleştirme (AC-81..85; ortak standart 1.5 "Logo ve avatar değişiklikleri audit log'a yazılır").
 * Entity `tenants` / `users` / `system_settings` (entity_id `system_logo`). Değer: `{ path }` (rastgele dosya adı, gizli
 * değil); reddedilen yüklemede `reason` (invalid_image | too_large). Tema: yalnız gerçekten değiştiğinde `{ theme }`.
 */
export const BRANDING_AUDIT = {
  LOGO_UPDATED: "tenant.logo_updated",
  LOGO_REMOVED: "tenant.logo_removed",
  AVATAR_UPDATED: "user.avatar_updated",
  AVATAR_REMOVED: "user.avatar_removed",
  SYSTEM_LOGO_UPDATED: "settings.system_logo.updated",
  /** Reddedilen yükleme (tür/boyut); `kind`: logo | avatar | system_logo. */
  UPLOAD_REJECTED: "upload.rejected",
  THEME_CHANGED: "user.theme_changed",
} as const;

/**
 * P13a (AC-199): günlük saklama işi. Firma başına tek kayıt (değişiklik ya da hata varsa) `{sessions, consents, files,
 * requests, customers, bindings}`; firmadan bağımsız silmeler `tenant_id NULL` tek kayıt `{audit, authSessions,
 * resetTokens}`. Yalnız sayılar (kişisel veri yok); `username=system`, `user_id NULL`, entity `retention`.
 */
export const RETENTION_AUDIT = {
  RUN: "retention.run",
} as const;

/** P13b (G-P13b-5, dba D2): yedek audit süreklilik denetiminin taban çizgisi sıfırlandı (geri yükleme / elle kabul). */
export const BACKUP_AUDIT = {
  AUDIT_BASELINE_RESET: "backup.audit_baseline_reset",
} as const;
