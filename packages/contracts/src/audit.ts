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
