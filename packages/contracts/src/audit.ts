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
  /**
   * P16 (AC-241, ADR-0030 m.4): pasif kullanıcı kalıcı silindi (mezar taşı). PII YOK: `oldValue {status}`, `newValue
   * {status: "DELETED", deletedPermissions, deletedMfaBackups, deletedResetLinks, deletedAuthSessions}`. 403'te
   * `result: "fail"`, `{op: "delete", denied}`.
   */
  DELETED: "user.deleted",
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
  /**
   * P14a (AC-215, ADR-0022): step-up doğrulaması. `newValue: { method: "TOTP"|"RECOVERY", remaining }` (kalan kurtarma
   * kodu sayısı; kod ASLA yazılmaz); başarısızda `{ method, reason }` (invalid_code | replayed_code).
   */
  STEP_UP: "auth.step_up",
  /**
   * P13b (mimari-p13 §7.7): sunucudaki `reset-superadmin` CLI'si; `username="cli"`, parola/hash yazılmaz. P15 (AC-232):
   * panel yolu aynı eylemi yazar (aktör Super Admin, `newValue.via: "panel"`); geçici parolanın 24 sa ömrü iki yolda aynı.
   */
  SUPERADMIN_RESET: "auth.superadmin_reset",
  /** P15 (AC-231): kurtarma kodları yenilendi `{ count }` (kod ASLA yazılmaz); hatalı TOTP `{ reason }` fail. */
  MFA_RECOVERY_REGENERATED: "mfa.recovery_regenerated",
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
 * (entity_id `mysql` | `turn` | `whatsapp`), `consent_texts`, `audit_logs`. Şifre / TURN secret / metin gövdesi ASLA
 * yazılmaz: servis değişikliği `password: "changed"` / `secret: "changed"` bayrağıyla bildirir, mask.ts anahtar adından
 * (`pass|secret`) değeri `"***"` yapar → kayıtta `password: "***"` / `secret: "***"` (yalnız değiştiyse var). Metin için
 * `{ version, sha256 }`. MySQL değeri P14a'dan beri `requireTls` taşır. Test sonucu yalnız `reason` sınıfını taşır (ham
 * sürücü hatası yalnız server logunda). P14a (AC-217): değişmeyen PUT (mysql/turn) yazım ve audit üretmez.
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
  /** P15 (AC-233): sistem logosu kaldırıldı `{ path }` eski → `{ path: null }` (varsayılan Nokta logosu). */
  SYSTEM_LOGO_REMOVED: "settings.system_logo.removed",
  /** Reddedilen yükleme (tür/boyut); `kind`: logo | avatar | system_logo. */
  UPLOAD_REJECTED: "upload.rejected",
  THEME_CHANGED: "user.theme_changed",
} as const;

/**
 * P13a (AC-199): günlük saklama işi. Firma başına tek kayıt (değişiklik ya da hata varsa) `{sessions, consents, files,
 * requests, customers, bindings, blocks}` (P15: `blocks` süresi 30 g önce dolmuş talep engeli); firmadan bağımsız silmeler `tenant_id NULL` tek kayıt `{audit, authSessions,
 * resetTokens}`. Yalnız sayılar (kişisel veri yok); `username=system`, `user_id NULL`, entity `retention`.
 */
export const RETENTION_AUDIT = {
  RUN: "retention.run",
} as const;

/**
 * P15 (AC-235): talep engelleri. Entity `request_blocks`. `{ kind, cidr | deviceFingerprint, expiresAt, source }` —
 * IP (kişisel veri) yalnız engel değeri olarak; not metni yazılmaz (`hasNote`). Engelli kaynağın talebi ayrı satır
 * yazmaz: `request.rate_limited { bucket: "blocked" }` (dakikada 1).
 */
export const REQUEST_BLOCK_AUDIT = {
  CREATED: "request_block.created",
  DELETED: "request_block.deleted",
} as const;

/** P13b (G-P13b-5, dba D2): yedek audit süreklilik denetiminin taban çizgisi sıfırlandı (geri yükleme / elle kabul). */
export const BACKUP_AUDIT = {
  AUDIT_BASELINE_RESET: "backup.audit_baseline_reset",
} as const;

/**
 * P16 (AC-242, ADR-0030 m.5–m.6): firma kalıcı silme işi. Entity `tenants`, entity_id firma id'si. Yalnız sayılar ve
 * iş kimliği (`jobId`, `step`, `scheduledFor`, `lastError` sınıfı); `previewId` audit'e ve loglara ASLA yazılmaz.
 */
export const TENANT_PURGE_AUDIT = {
  PREVIEWED: "tenant.purge_previewed",
  SCHEDULED: "tenant.purge_scheduled",
  CANCELLED: "tenant.purge_cancelled",
  STARTED: "tenant.purge_started",
  FAILED: "tenant.purge_failed",
  PURGED: "tenant.purged",
} as const;

/** P16 (AC-243): haftalık yetim dosya taraması `{found, deleted, ...}` ya da `fail{reason: "circuit_open"}`. Entity `uploads`. */
export const UPLOADS_AUDIT = {
  ORPHAN_SCAN: "uploads.orphan_scan",
} as const;

/**
 * P16 G1 (dba): migration'ın yazdığı tek seferlik kayıt (`username = "migrator"`): `users.delete` sıfırlama sayımı
 * `{grantedBefore, rowsDeleted, grantedAfter}`.
 */
export const MIGRATION_AUDIT = {
  P16_USERS_DELETE_RESET: "migration.p16_users_delete_reset",
} as const;

/**
 * P16 G3 (S16-13): geri yükleme sonrası `cli erasure:replay` (migrator, `username = "cli"`) `{users, tenants, invalid}`
 * sayıları. Entity `erasure_ledger`.
 */
export const ERASURE_AUDIT = {
  REPLAYED: "erasure.replayed",
} as const;

/**
 * P18 (mimari-e11 §8b.7; AC-256..258). Gövde/PII yok:
 *  - ASSIGNED `old/new: {assignedTo}` (kullanıcı id); kullanıcı pasife alma/yetki kaybı/firma pasifinde `reason: "user_inactive"`.
 *  - PRIORITY_CHANGED `old/new: {priority}`.
 *  - `request.created` `fail` `{reason: "outside_hours", count}` — tenant başına 1 dk pencerede 1 satır (S-P18-T7).
 *  - BUSINESS_HOURS_UPDATED eski → yeni (hafta, mod, tz, açık); HOLIDAY_* `{day, name, openUntil}`; HOLIDAYS_IMPORTED `{year, added}`.
 */
export const REQUEST_COMMS_AUDIT = {
  ASSIGNED: "request.assigned",
  PRIORITY_CHANGED: "request.priority_changed",
  BUSINESS_HOURS_UPDATED: "settings.business_hours_updated",
  HOLIDAY_ADDED: "settings.holiday_added",
  HOLIDAY_REMOVED: "settings.holiday_removed",
  HOLIDAYS_IMPORTED: "settings.holidays_imported",
} as const;

/** P18 eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const P18_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [REQUEST_COMMS_AUDIT.ASSIGNED]: "Talep atandı",
  [REQUEST_COMMS_AUDIT.PRIORITY_CHANGED]: "Talep önceliği değişti",
  [REQUEST_COMMS_AUDIT.BUSINESS_HOURS_UPDATED]: "Mesai saatleri değişti",
  [REQUEST_COMMS_AUDIT.HOLIDAY_ADDED]: "Tatil günü eklendi",
  [REQUEST_COMMS_AUDIT.HOLIDAY_REMOVED]: "Tatil günü kaldırıldı",
  [REQUEST_COMMS_AUDIT.HOLIDAYS_IMPORTED]: "Resmî tatiller eklendi",
};

/** P16 eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const P16_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [USER_AUDIT.DELETED]: "Kullanıcı kalıcı silindi",
  [TENANT_PURGE_AUDIT.PREVIEWED]: "Firma silme önizlemesi",
  [TENANT_PURGE_AUDIT.SCHEDULED]: "Firma silme zamanlandı",
  [TENANT_PURGE_AUDIT.CANCELLED]: "Firma silme iptal edildi",
  [TENANT_PURGE_AUDIT.STARTED]: "Firma silme başladı",
  [TENANT_PURGE_AUDIT.FAILED]: "Firma silme başarısız",
  [TENANT_PURGE_AUDIT.PURGED]: "Firma kalıcı silindi",
  [UPLOADS_AUDIT.ORPHAN_SCAN]: "Yetim dosya taraması",
  [MIGRATION_AUDIT.P16_USERS_DELETE_RESET]: "Migration: kullanıcı silme yetkileri sıfırlandı",
  [ERASURE_AUDIT.REPLAYED]: "İmha defteri yeniden uygulandı",
};

/** Audit `entity` değerleri (S16-1: maske `entity = AUDIT_ENTITY.USERS` satırlarında hedef kullanıcıya da bakar). */
export const AUDIT_ENTITY = {
  USERS: "users",
  TENANTS: "tenants",
} as const;

/**
 * P16 (S16-1, ADR-0030 m.4): kimlik maskesi uygulanan satırda `oldValue`/`newValue` içinde (iç içe dahil) bu anahtarların
 * değeri `"***"` olur (null kalır).
 */
export const AUDIT_IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "email",
  "fullName",
  "username",
  "name",
  "contactName",
  "phone",
  "customerName",
  "customerEmail",
  "recipient",
]);

/** Kimlik maskesi: e-posta `a***@***`, değilse `a***`; boş → `***`. */
export function maskIdentity(value: string): string {
  const first = [...value][0];
  if (!first) return "***";
  return value.includes("@") ? `${first}***@***` : `${first}***`;
}

/** Mezar taşı kullanıcı etiketi (DB `full_name` ile aynı biçim): "Silinmiş kullanıcı #<id son 6>". */
export const deletedUserLabel = (id: string): string => `Silinmiş kullanıcı #${id.slice(-6)}`;
/** Silinmiş (satırı olmayan) firma etiketi: "Silinmiş firma #<id son 6>". */
export const deletedTenantLabel = (id: string): string => `Silinmiş firma #${id.slice(-6)}`;
