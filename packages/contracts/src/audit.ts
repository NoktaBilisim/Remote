// Uzaktan kontrol audit zaman çizelgesi action adları (P7; AC-111, AC-115, G-15). Sunucu yazar, oturum geçmişi (P8)
// aynı adlarla okur. Önceki paketlerin action'ları kendi modüllerinde kalır; yeni zaman çizelgesi olayları buraya eklenir.
import type { VoiceEndReason } from "./ws-voice.ts";

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
  /** P19 (AC-263): `{count, status}`. */
  EXPORTED: "customer.exported",
  /** P19 (AC-263): özet `{total, created, updated, skipped, failed, onConflict}`; satır olayları `source: "import"`. */
  IMPORTED: "customer.imported",
  /** LG (AC-423): müşteriye özel bağlantılar gönderildi — `{phase, channel, recipient(maskeli), links, result?, reason?}`. */
  LINK_SENT: "customer.link_sent",
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
  /**
   * P27a (mimari-p27a §4.3; AC-325, 326, 329, 330, 332, 335b). Belirteç, çerez değeri, `token_hash` ve tam UA ASLA
   * yazılmaz (AC-333). CREATED: entity `trusted_devices` / satır id, `{ uaSummary, expiresAt }`.
   */
  TRUSTED_DEVICE_CREATED: "auth.trusted_device_created",
  /** Girişte TOTP atlandı (entity `trusted_devices` / satır id, `{ uaSummary }`); `auth.login` satırı `{ mfa: "remembered" }`. */
  TRUSTED_DEVICE_USED: "auth.trusted_device_used",
  /** Tekil/kullanıcı geneli kaldırma (entity `users` / hedef): `{ reason: "user" | "admin" | "limit", count }`. */
  TRUSTED_DEVICE_REVOKED: "auth.trusted_device_revoked",
  /** r3 yeniden kullanım (entity `users`, `result: "fail"`): `{ count, revokedSessions }` (silinen cihaz / iptal edilen oturum). */
  TRUSTED_DEVICE_REUSE: "auth.trusted_device_reuse",
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
  /** H3 (AC-255): `{sender, chars}` — gövde ASLA; müşteri mesajında user_id NULL (K-P18-11: her mesaj). */
  MESSAGE_SENT: "request.message_sent",
  /** H3: `{reason: "rate"|"cap"|"closed"|"unsupported"|"tenant_rate", sender}` — kaynak/pencere başına 1. */
  MESSAGE_REJECTED: "request.message_rejected",
} as const;

/** P18 H3 (S-P18-T2b, K-P18-10): `cli crypto:rewrap` `{table, fromVer, toVer, rows}` (username `system:cli`). Entity tablo adı. */
export const CRYPTO_AUDIT = {
  REWRAP: "crypto.rewrap",
} as const;

/**
 * P19 J2 (mimari-e11 §8c.7; AC-259). Gövde/PII/token yok:
 *  - WEB_FORM_REJECTED `{reason: fast|token|honeypot|token_store_full}` — ipKey başına dakikada 1 satır (AC-144 kalıbı).
 *  - `request.created` += `source`, `notify: {sms, whatsapp, email}`, `notifySuppressed?: true` (S-P19-12).
 */
export const WEB_REQUEST_AUDIT = {
  WEB_FORM_REJECTED: "request.web_form_rejected",
} as const;

/** P19 J3 (§8c.7): dış gönderim ve SMS ayarı eylemleri. */
export const NOTIFY_AUDIT = {
  LINK_SENT: "session.link_sent",
  CUSTOMER_NOTIFY: "request.customer_notify",
  SMS_UPDATED: "settings.sms_updated",
  SMS_TEST: "settings.sms_test",
} as const;

/**
 * P27 gözetimsiz erişim (mimari-p27 §7.2; AC-273, 275, 293, 295, 296, 336, 337, 339). Kayıt kodu, imza, anahtar, bilet ASLA
 * yazılmaz; adresler maskeli. Alanlar §7.2 tablosunda; Türkçe etiketler `api/unattended.ts` `UNATTENDED_AUDIT_LABELS`.
 */
export const UNATTENDED_AUDIT = {
  CODE_CREATED: "unattended.code.created",
  CODE_CANCELLED: "unattended.code.cancelled",
  DEVICE_REGISTERED: "unattended.device.registered",
  DEVICE_REVOKED: "unattended.device.revoked",
  DEVICE_AUTH: "unattended.device.auth",
  DEVICE_REPLACED: "unattended.device.replaced",
  GRANT_CHANGED: "unattended.grant.changed",
  CONTACTS_CHANGED: "unattended.contacts.changed",
  NOTIFY_FAILED: "unattended.notify.failed",
  CONNECT: "unattended.connect",
  SESSION_STARTED: "unattended.session.started",
  SESSION_ENDED: "unattended.session.ended",
  LOCAL_STATE: "unattended.local_state",
  /** LG (AC-420): kayıt kodu müşteriye gönderildi — `{phase, channel, recipient(maskeli), customerId, result?, reason?}`. */
  CODE_SENT: "unattended.code.sent",
  /** LG (AC-419, O-LG-2): public servis indirmesi — `{customerId, ua}`; kod+IP saatte 1, kod başına en çok 10 satır. */
  CODE_DOWNLOADED: "unattended.code.downloaded",
  // P28u (mimari-p28u §9.1; AC-431, 436, 439, 441, 443–445). Entity `support_sessions` (politika: `tenant_settings`/tenantId).
  // Alan adları (D-P28u-4, K-P28u-20): gerekçe `silentReason` YALNIZ `unattended.connect` satırında; ret kodu `failReason`;
  // çıplak `reason` anahtarı yok. `userState` hiçbir satıra yazılmaz (D-P28u-6). `CONNECT` += `consentRequested:"ask"` ya da
  // `consentMode:"silent"` + `silentReason`; `SESSION_STARTED`/`SESSION_ENDED` += `consentMode`.
  // r3 (K-P28u-r3-12): `CONSENT` ve `UNATTENDED_POLICY_AUDIT` artık YAZILMAZ; `SILENT_NOTIFY` yalnız `event:"recording_policy"`
  // (P28e kayıt politikası e-postası, S-P28e-4) için yazılır — diğer olay değerleri eski satırları okumak/etiketlemek için kalır. `CONTROL_TOGGLE` yazılmaya devam eder; yeni satırlarda `consentMode` yalnız `no_user`.
  /** Cihazdaki onay kararı — aktör cihaz (`user_id` NULL, `username` = `device:<id>`): `{consentMode:"asked", decision, ms, deviceId, technicianId}`. */
  CONSENT: "unattended.consent",
  /** Kontrol açıldı/kapandı (her kip, K-P28u-10): `{from, to: "view"|"control", consentMode}`. */
  CONTROL_TOGGLE: "unattended.control_toggle",
  /** `{deviceId, result, failReason?, durationMs}` (başarısız dahil). */
  LOCK: "unattended.lock",
  /** `{deviceId, result, failReason?, durationMs, rejoin}`. */
  LOGOFF: "unattended.logoff",
  /** Oturum kapatma sonrası yeniden katılım: `{result, failReason?}`. */
  REJOIN: "unattended.rejoin",
  /** Dört göz e-postası denemesi: `{event: SILENT_NOTIFY_EVENTS, recipient(maskeli), result, attempt}`. */
  SILENT_NOTIFY: "unattended.silent.notify",
} as const;
export type UnattendedAuditAction = (typeof UNATTENDED_AUDIT)[keyof typeof UNATTENDED_AUDIT];

/**
 * P28u politika değişikliği (AC-436): entity `tenant_settings`/tenantId, `{old, new, ack: true, stepUp: true}`. `settings.*`
 * önekli (audit "Ayarlar" grubu) olduğundan `UNATTENDED_AUDIT` (`unattended.*`) dışında; etiket `UNATTENDED_AUDIT_LABELS`'ta.
 * r3 (2026-11-18): politika kaldırıldı — yalnız eski satırları okumak/etiketlemek için kalır, yeni yazım yok.
 */
export const UNATTENDED_POLICY_AUDIT = "settings.unattended_silent";

/**
 * `unattended.silent.notify.event` (P28u `connect`/`policy`; P28e S-P28e-4 `recording_policy` — gözetimsiz kayıt politikası;
 * P28c Y-PC-1 `join` — silent odaya ek teknisyen katıldı, `transfer` — silent odada oturum devredildi).
 * r3 (2026-11-18): yeni yazım yalnız `recording_policy`; diğer değerler eski satırları okumak için kalır.
 */
export const SILENT_NOTIFY_EVENTS = ["connect", "policy", "recording_policy", "join", "transfer"] as const;
export type SilentNotifyEvent = (typeof SILENT_NOTIFY_EVENTS)[number];

/** P28u (§5.4): `consentMode` taşıyan eylemler — audit "Bağlantı kipi" filtresi bunlarla daraltılır (`connect` yalnız silent'ta taşır). */
export const CONSENT_MODE_ACTIONS: readonly UnattendedAuditAction[] = [
  UNATTENDED_AUDIT.CONNECT,
  UNATTENDED_AUDIT.CONSENT,
  UNATTENDED_AUDIT.SESSION_STARTED,
  UNATTENDED_AUDIT.SESSION_ENDED,
  UNATTENDED_AUDIT.CONTROL_TOGGLE,
  UNATTENDED_AUDIT.LOCK,
  UNATTENDED_AUDIT.LOGOFF,
];

/**
 * P28a pano + uzaktan yazdırma (mimari-p28 §8.1; AC-347, 348, 351). Entity `support_sessions`, entity_id = sessionId. Pano
 * içeriği, PDF, dosya adı ve hash ASLA yazılmaz:
 *  - CLIPBOARD_CONSENT `{on, by: "customer"|"system", reason?: control_closed|permission|disconnect|session_ended}` (aktör müşteri/sistem).
 *  - CLIPBOARD_TRANSFER `{direction, bytes, result, reportedBy: "customer"|"server"}` (aktör isteyen teknisyen; OK → success).
 *  - PRINT_JOB `{decision, pages?, sizeBytes, result, reportedBy}` (aktör isteyen teknisyen; PRINTED → success).
 * Kapıda reddedilen istekler audit'e yazılmaz (metrik + log, K-P28a-8).
 */
export const CLIP_PRINT_AUDIT = {
  CLIPBOARD_CONSENT: "clipboard.consent",
  CLIPBOARD_TRANSFER: "clipboard.transfer",
  PRINT_JOB: "print.job",
} as const;
export type ClipPrintAuditAction = (typeof CLIP_PRINT_AUDIT)[keyof typeof CLIP_PRINT_AUDIT];

/** P28a eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const CLIP_PRINT_AUDIT_LABELS: Readonly<Record<ClipPrintAuditAction, string>> = {
  [CLIP_PRINT_AUDIT.CLIPBOARD_CONSENT]: "Pano izni değişti",
  [CLIP_PRINT_AUDIT.CLIPBOARD_TRANSFER]: "Pano aktarımı",
  [CLIP_PRINT_AUDIT.PRINT_JOB]: "Uzaktan yazdırma",
};

/**
 * P28b sunucu üzerinden dosya + ClamAV + kota (mimari-p28b §11.1; AC-353, 358, 360, 362). Dosya adı, belirteç, içerik ASLA
 * yazılmaz. Entity `support_sessions` / sessionId (oturum zaman çizelgesi); `file.expired` entity `retention`; ayarlar
 * `system_settings` (clamav) / `tenants`:
 *  - CLAMAV_UPDATED eski→yeni `{host, port}`; CLAMAV_TEST `{ok, eicarDetected, encryptedDetected, signatureAgeDays}`.
 *  - STORAGE_QUOTA eski→yeni `{storageQuotaGb}` (Super Admin).
 *  - UPLOAD `{fid, direction, purpose, sizeBytes, ext, result}`; SCAN `{fid, result: CLEAN|INFECTED|SCAN_FAILED, reason?, durationMs}`;
 *    INFECTED `{fid, signature, ext, sizeBytes}` (fail); DOWNLOAD `{fid, context: session|history, by: tech|customer}`;
 *    EXPIRED tenant başına `{count, bytes}`.
 * Dosya modu / saklama değişimi mevcut `tenant_settings.updated` olayıyla (`{fileServerMode, fileRetentionDays}` + `consentAck`).
 */
export const FSRV_AUDIT = {
  CLAMAV_UPDATED: "settings.clamav",
  CLAMAV_TEST: "settings.clamav.test",
  STORAGE_QUOTA: "tenant.storage_quota",
  UPLOAD: "file.upload",
  SCAN: "file.scan",
  INFECTED: "file.infected",
  DOWNLOAD: "file.download",
  EXPIRED: "file.expired",
} as const;
export type FsrvAuditAction = (typeof FSRV_AUDIT)[keyof typeof FSRV_AUDIT];

/** P28b eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const FSRV_AUDIT_LABELS: Readonly<Record<FsrvAuditAction, string>> = {
  [FSRV_AUDIT.CLAMAV_UPDATED]: "Virüs tarama (ClamAV) ayarı değişti",
  [FSRV_AUDIT.CLAMAV_TEST]: "Virüs tarama bağlantı testi",
  [FSRV_AUDIT.STORAGE_QUOTA]: "Firma depolama kotası değişti",
  [FSRV_AUDIT.UPLOAD]: "Dosya sunucuya yüklendi",
  [FSRV_AUDIT.SCAN]: "Dosya virüs taraması",
  [FSRV_AUDIT.INFECTED]: "Virüslü dosya bulundu",
  [FSRV_AUDIT.DOWNLOAD]: "Sunucudaki dosya indirildi",
  [FSRV_AUDIT.EXPIRED]: "Saklama süresi dolan dosyalar silindi",
};

export const P19_NOTIFY_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [NOTIFY_AUDIT.LINK_SENT]: "Oturum bağlantısı gönderildi (SMS/WhatsApp)",
  [NOTIFY_AUDIT.CUSTOMER_NOTIFY]: "Müşteriye durum bildirimi",
  [NOTIFY_AUDIT.SMS_UPDATED]: "SMS ayarları değişti",
  [NOTIFY_AUDIT.SMS_TEST]: "Test SMS'i",
};

/** LG (mimari-link-gonderme §8) eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const LG_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [UNATTENDED_AUDIT.CODE_SENT]: "Kayıt kodu müşteriye gönderildi",
  [UNATTENDED_AUDIT.CODE_DOWNLOADED]: "Servis kurulum dosyası indirildi (bağlantıdan)",
  [CUSTOMER_AUDIT.LINK_SENT]: "Müşteriye bağlantılar gönderildi",
};

/** P19 J2 eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const P19_REQUEST_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [WEB_REQUEST_AUDIT.WEB_FORM_REJECTED]: "Web talep formu reddedildi",
};

/** P18 eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const P18_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [REQUEST_COMMS_AUDIT.ASSIGNED]: "Talep atandı",
  [REQUEST_COMMS_AUDIT.PRIORITY_CHANGED]: "Talep önceliği değişti",
  [REQUEST_COMMS_AUDIT.BUSINESS_HOURS_UPDATED]: "Mesai saatleri değişti",
  [REQUEST_COMMS_AUDIT.HOLIDAY_ADDED]: "Tatil günü eklendi",
  [REQUEST_COMMS_AUDIT.HOLIDAY_REMOVED]: "Tatil günü kaldırıldı",
  [REQUEST_COMMS_AUDIT.HOLIDAYS_IMPORTED]: "Resmî tatiller eklendi",
  [REQUEST_COMMS_AUDIT.MESSAGE_SENT]: "Talep mesajı gönderildi",
  [REQUEST_COMMS_AUDIT.MESSAGE_REJECTED]: "Talep mesajı reddedildi",
  [CRYPTO_AUDIT.REWRAP]: "Mesajlar yeniden şifrelendi",
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

/**
 * P28e oturum kaydı (mimari-p28e §11.1; AC-381, 385, 386, 388). Entity `support_sessions` / sessionId; `recording.expired`
 * entity `retention`. Belirteç ve içerik ASLA yazılmaz:
 *  - START `{recordingId?, basis, consentMode?, reason?: REC_START_FAIL_REASONS, cause?: REC_CONSENT_REJECT_CODES}` (açılamadı → fail;
 *    `consent_rejected` oturum başına en çok 1). STOP `{recordingId, reason: REC_STOP_REASONS, cause?: REC_STOP_ERROR_CODES, durationMs, sizeBytes}`.
 *  - VIEW `{recordingId}` (`POST /view` başına bir kez). VIEW_END `{recordingId, partsServed, bytesServed, throttled, endReason}`.
 *  - DELETE `{recordingId, deleteReason: "manual"|"missing", durationMs, sizeBytes, missingParts?, remainingParts?}`. EXPIRED `{count, bytes}`.
 * Alt kod anahtarı `cause` (`code` değil: audit maskesi `/code/i` anahtarı "***" yapar). Değerler tel biçiminde (küçük harf; `ws-rec.ts`). Aktör: `start{consent}`/`stop{revoked}` müşteri, `tenant_policy` teknisyen.
 */
export const RECORDING_AUDIT = {
  START: "recording.start",
  STOP: "recording.stop",
  VIEW: "recording.view",
  VIEW_END: "recording.view.end",
  DELETE: "recording.delete",
  EXPIRED: "recording.expired",
} as const;
export type RecordingAuditAction = (typeof RECORDING_AUDIT)[keyof typeof RECORDING_AUDIT];
/** Kayıt ayarı değişimi (eski→yeni `{enabled, retentionDays, unattendedEnabled}` + `consentAck`/`employeeNoticeAck`). */
export const RECORDING_SETTINGS_AUDIT = "settings.recording";
/** Audit süzgecinde `recording.*` grubunun adı (web `AUDIT_GROUP_LABELS`'a yayılır). */
export const RECORDING_AUDIT_GROUP_LABELS: Readonly<Record<string, string>> = { recording: "Kayıt" };
/** P28e eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const RECORDING_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [RECORDING_AUDIT.START]: "Oturum kaydı başladı",
  [RECORDING_AUDIT.STOP]: "Oturum kaydı durdu",
  [RECORDING_AUDIT.VIEW]: "Oturum kaydı izlendi",
  [RECORDING_AUDIT.VIEW_END]: "Kayıt izleme özeti",
  [RECORDING_AUDIT.DELETE]: "Oturum kaydı silindi",
  [RECORDING_AUDIT.EXPIRED]: "Saklama süresi dolan kayıtlar silindi",
  [RECORDING_SETTINGS_AUDIT]: "Oturum kaydı ayarı değişti",
};
/** `unattended.silent.notify.event` etiketleri (P28u gözetimsiz grubunda gösterilir). */
export const SILENT_NOTIFY_EVENT_LABELS: Readonly<Record<SilentNotifyEvent, string>> = {
  connect: "İzinsiz bağlantı",
  policy: "İzinsiz bağlanma politikası değişti",
  recording_policy: "Gözetimsiz bağlantı kayıt politikası değişti",
  join: "İzinsiz bağlantıya ek teknisyen katıldı",
  transfer: "İzinsiz bağlantı başka teknisyene devredildi",
};

/**
 * P28c çoklu teknisyen (mimari-p28c §9; AC-364..370). Entity `support_sessions` / sessionId. Sohbet içeriği ve gerekçe
 * metni (yalnız `supervise_join`/`participant_join`'de `silentReason`, silent odada) dışında serbest metin yazılmaz:
 *  - INVITE `{inviteeUserId, inviteeName}` (aktör sahip; 403/409 denemeleri `fail`). INVITE_ACCEPT / INVITE_REJECT `{inviteId}`.
 *  - INVITE_EXPIRE `{inviteeUserId, reason: MULTI_INVITE_EXPIRE_REASONS}` (aktör system; geri çekmede aktör sahip, `revoked`).
 *  - PARTICIPANT_JOIN `{userId, role:"participant", consentMode?, reasonLen?, silentReason?}`; SUPERVISE_JOIN aynı, `role:"observer"`.
 *  - PARTICIPANT_LEAVE `{userId, role, reason: MULTI_LEAVE_REASONS}`. PARTICIPANT_REMOVE `{userId, role}` (aktör müşteri).
 *  - CONTROL_HANDOVER `{fromUserId, toUserId, reason?: "controller_left"}`. TRANSFER `{fromUserId, toUserId, consentMode?}`.
 * Ret alt kodu anahtarı `failReason` (çıplak `code` DEĞİL: audit maskesi `/code/i` anahtarını "***" yapar; P28u K-P28u-20 kalıbı).
 * Ad soyad (`inviteeName`) `AUDIT_IDENTITY_KEYS`'te değildir; mezar taşında maskelenmesi gerekirse K1 ekler.
 */
export const MULTI_AUDIT = {
  INVITE: "session.invite",
  INVITE_ACCEPT: "session.invite_accept",
  INVITE_REJECT: "session.invite_reject",
  INVITE_EXPIRE: "session.invite_expire",
  PARTICIPANT_JOIN: "session.participant_join",
  PARTICIPANT_LEAVE: "session.participant_leave",
  PARTICIPANT_REMOVE: "session.participant_remove",
  SUPERVISE_JOIN: "session.supervise_join",
  CONTROL_HANDOVER: "session.control_handover",
  TRANSFER: "session.transfer",
} as const;
export type MultiAuditAction = (typeof MULTI_AUDIT)[keyof typeof MULTI_AUDIT];
/** `session.invite_expire.reason`: 2 dk doldu / oturum bitti / sahip geri çekti (D-PC-7). */
export const MULTI_INVITE_EXPIRE_REASONS = ["timeout", "session_end", "revoked"] as const;
export type MultiInviteExpireReason = (typeof MULTI_INVITE_EXPIRE_REASONS)[number];
/** `session.participant_leave.reason` (§5.4). */
export const MULTI_LEAVE_REASONS = ["left", "disconnect", "no_show", "session_end", "auth_revoked"] as const;
export type MultiLeaveReason = (typeof MULTI_LEAVE_REASONS)[number];
/** `session.transfer` fail `failReason` (§5.2): koşullu UPDATE tutmadı / commit sonrası hedef gitti (geri alındı). */
export const MULTI_TRANSFER_FAIL_REASONS = ["conflict", "target_gone"] as const;
export type MultiTransferFailReason = (typeof MULTI_TRANSFER_FAIL_REASONS)[number];
/**
 * Audit süzgecinde "Çoklu teknisyen" grubu (§9). Eylemler `session.*` önekli olduğundan (AC-370 adları) önek grubu
 * (`session.*` → "Oturum") bunu ayıramaz; web bu listeyle ayrı seçenek grubu kurar (tek tek eylem süzgeci).
 */
export const MULTI_AUDIT_GROUP = { label: "Çoklu teknisyen", actions: Object.values(MULTI_AUDIT) } as const;
/** P28c eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a ve geçmiş zaman çizelgesine yayılır). */
export const MULTI_AUDIT_LABELS: Readonly<Record<MultiAuditAction, string>> = {
  [MULTI_AUDIT.INVITE]: "Teknisyen davet edildi",
  [MULTI_AUDIT.INVITE_ACCEPT]: "Davet kabul edildi",
  [MULTI_AUDIT.INVITE_REJECT]: "Davet reddedildi",
  [MULTI_AUDIT.INVITE_EXPIRE]: "Davet düştü",
  [MULTI_AUDIT.PARTICIPANT_JOIN]: "Teknisyen katıldı",
  [MULTI_AUDIT.PARTICIPANT_LEAVE]: "Teknisyen ayrıldı",
  [MULTI_AUDIT.PARTICIPANT_REMOVE]: "Müşteri teknisyeni çıkardı",
  [MULTI_AUDIT.SUPERVISE_JOIN]: "Süpervizör izlemeye başladı",
  [MULTI_AUDIT.CONTROL_HANDOVER]: "Kontrol devredildi",
  [MULTI_AUDIT.TRANSFER]: "Oturum devredildi",
};
/** `invite_expire.reason` etiketleri. */
export const MULTI_INVITE_EXPIRE_REASON_LABELS: Readonly<Record<MultiInviteExpireReason, string>> = {
  timeout: "Süre doldu",
  session_end: "Oturum bitti",
  revoked: "Geri çekildi",
};
/** `participant_leave.reason` etiketleri. */
export const MULTI_LEAVE_REASON_LABELS: Readonly<Record<MultiLeaveReason, string>> = {
  left: "Ayrıldı",
  disconnect: "Bağlantı koptu",
  no_show: "Bağlanmadı",
  session_end: "Oturum bitti",
  auth_revoked: "Yetkisi düştü",
};

/**
 * P28d sesli görüşme (mimari-p28d §6; AC-379). Entity `support_sessions` / sessionId. Ses içeriği ve aygıt adı ASLA yazılmaz;
 * kapıdan dönen ret (403/409/429) audit'e yazılmaz (yalnız metrik):
 *  - REQUEST `{}` (aktör isteyen teknisyen). ACCEPT `{}` (aktör müşteri). JOIN `{}` (aktör katılan teknisyen; O-PD-2).
 *  - REJECT `{reason: VOICE_REJECT_REASONS}` (aktör müşteri / sistem; result `fail`).
 *  - END `{durationSec, reason: VOICE_END_REASONS, talkerIds: userId[], listenerIds: userId[]}` (görüşme boyunca birleşim,
 *    her biri ≤ 3; aktör bitiren teknisyen / müşteri / sistem). "Görüşmeyi kim dinledi" sorusu `listenerIds` ile yanıtlanır.
 */
export const VOICE_AUDIT = {
  REQUEST: "voice.request",
  ACCEPT: "voice.accept",
  REJECT: "voice.reject",
  JOIN: "voice.join",
  END: "voice.end",
} as const;
export type VoiceAuditAction = (typeof VOICE_AUDIT)[keyof typeof VOICE_AUDIT];
/** `voice.reject.reason` (§6): müşteri reddetti / 60 sn doldu / pending'de misafir koptu. */
export const VOICE_REJECT_REASONS = ["customer", "timeout", "disconnect"] as const;
export type VoiceRejectReason = (typeof VOICE_REJECT_REASONS)[number];
/** Audit süzgecinde `voice.*` grubunun adı (web `AUDIT_GROUP_LABELS`'a yayılır; RECORDING kalıbı). */
export const VOICE_AUDIT_GROUP_LABELS: Readonly<Record<string, string>> = { voice: "Sesli görüşme" };
/** P28d eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a ve geçmiş zaman çizelgesine yayılır). */
export const VOICE_AUDIT_LABELS: Readonly<Record<VoiceAuditAction, string>> = {
  [VOICE_AUDIT.REQUEST]: "Sesli görüşme istendi",
  [VOICE_AUDIT.ACCEPT]: "Müşteri sesli görüşmeyi kabul etti",
  [VOICE_AUDIT.REJECT]: "Sesli görüşme kurulmadı",
  [VOICE_AUDIT.JOIN]: "Teknisyen sesli görüşmeye katıldı",
  [VOICE_AUDIT.END]: "Sesli görüşme bitti",
};
/** `voice.reject.reason` etiketleri. */
export const VOICE_REJECT_REASON_LABELS: Readonly<Record<VoiceRejectReason, string>> = {
  customer: "Müşteri reddetti",
  timeout: "Müşteri yanıt vermedi",
  disconnect: "Müşterinin bağlantısı koptu",
};
/** `voice.end.reason` / `voice.state.endReason` etiketleri. */
export const VOICE_END_REASON_LABELS: Readonly<Record<VoiceEndReason, string>> = {
  tech: "Teknisyen bitirdi",
  customer: "Müşteri bitirdi",
  timeout: "Süre doldu",
  left: "Konuşan teknisyen kalmadı",
  device: "Mikrofon açılamadı",
  disconnect: "Müşterinin bağlantısı koptu",
  session_ended: "Oturum bitti",
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
