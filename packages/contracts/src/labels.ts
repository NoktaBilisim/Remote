// Enum → Türkçe etiket eşlemesinin TEK yeri (mimari-api "Oturum geçmişi (P8)"). Web ve sunucu CSV'si aynı eşlemeyi kullanır.
// CHECK'i olmayan değerler (`end_reason`, audit `action`) bilinmiyorsa ham gösterilir: `labelOf` boş bırakmaz, hata atmaz.
import type { CustomerStatus } from "./api/customers.ts";
import type { AfterHoursMode, CancelReason, NetworkMatch, RequestPriority, RequestSource, RequestStatus } from "./api/requests.ts";
import type {
  ConsentDecision,
  ConsentLevel,
  ConsentRecordSource,
  JoinAuditOs,
  SessionEndedBy,
  SessionMode,
  SessionSource,
  SessionStatus,
  TimelineEvent,
} from "./api/sessions.ts";
import {
  CHAT_AUDIT_LABELS,
  PORTAL_AUDIT,
  VOICE_AUDIT,
  VOICE_AUDIT_LABELS,
  VOICE_END_REASON_LABELS,
  VOICE_REJECT_REASON_LABELS,
  type PortalAuditAction,
} from "./audit.ts";
import type { ClipResult, PrintDecision, PrintResult } from "./ws-clip-print.ts";
import type { AvScanReason, FsrvGateReason, FsrvWireState, StoredFileState } from "./ws-fsrv.ts";

/** Bilinen değer → etiket; bilinmeyen → ham değer; null/undefined → "". */
export function labelOf(map: Readonly<Record<string, string>>, value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return Object.hasOwn(map, value) ? (map[value] ?? value) : value;
}

export const SESSION_STATUS_LABELS: Readonly<Record<SessionStatus, string>> = {
  PENDING: "Bekliyor",
  ACTIVE: "Etkin",
  ENDED: "Bitti",
  EXPIRED: "Süresi doldu",
  CANCELLED: "İptal edildi",
};

export const SESSION_MODE_LABELS: Readonly<Record<SessionMode, string>> = {
  AGENT: "İstemci",
  BROWSER: "Tarayıcı",
  UNATTENDED: "Gözetimsiz",
};

export const SESSION_ENDED_BY_LABELS: Readonly<Record<SessionEndedBy, string>> = {
  TECH: "Teknisyen",
  CUSTOMER: "Müşteri",
  ADMIN: "Yönetici",
  SYSTEM: "Sistem",
};

/** `support_sessions.end_reason` (mimari §3.1 P3 kararı: küçük harf; CHECK yok → bilinmeyen ham). */
export const END_REASON_LABELS: Readonly<Record<string, string>> = {
  tech: "Teknisyen bitirdi",
  customer: "Müşteri bitirdi",
  timeout: "Zaman aşımı",
  max_duration: "En uzun süre doldu",
  cancelled: "İptal edildi",
  tenant_passive: "Firma pasife alındı",
  server: "Sunucu yeniden başladı",
  admin: "Yönetici sonlandırdı",
  auth_revoked: "Teknisyen oturumu kapandı",
  expired: "Süresi doldu",
  // P8b (mimari-e9 §3.3, §13.3): talep oturumu kabul sonrası 60 sn'de bağlanmadı / müşteri onay ekranında vazgeçti.
  connect_timeout: "Müşteri bağlanamadı",
  customer_declined: "Müşteri vazgeçti",
  // P27 (mimari-p27 §4.4, §4.6): gözetimsiz oturum bitişleri + `connect.result` iptal nedenleri (`CANCELLED(<reason>)`).
  permission: "Teknisyen yetkisi kaldırıldı",
  device_revoked: "Cihaz iptal edildi",
  local_disabled: "Cihazda gözetimsiz erişim kapatıldı",
  indicator_failed: "Cihazda bağlantı göstergesi gösterilemedi",
  device_timeout: "Cihaz yanıt vermedi",
  session_changed: "Cihazda Windows oturumu değişti",
  helper_failed: "Cihazda bağlantı başlatılamadı",
  no_console: "Cihazda etkin Windows oturumu yok",
  busy: "Cihazda başka gözetimsiz bağlantı var",
  // P28u (mimari-p28u §6.2): onay sonuçları + D-P28u-5 fail-closed (`protocol` yalnız DB nedeni). r3 (K-P28u-r3-12):
  // `consent_denied`/`consent_timeout` artık oluşmaz, eski kayıtlar için kalır; `consent_missing` (K-P28u-3) yazılmaya devam eder.
  consent_denied: "Kullanıcı bağlantıyı reddetti",
  consent_timeout: "Kullanıcı yanıt vermedi",
  consent_missing: "Cihaz onay sonucunu bildirmedi",
  protocol: "Cihaz servisi beklenmeyen istek aldı",
};

/** P8b (AC-158): geçmiş listesi/CSV "Kaynak". */
export const SESSION_SOURCE_LABELS: Readonly<Record<SessionSource, string>> = {
  TECH: "Teknisyen",
  REQUEST: "Talep",
};

/** P19 (AC-259, mimari-e11 §8c.6): talep kaynağı rozeti (kuyruk kartı / geçmiş). */
export const REQUEST_SOURCE_LABELS: Readonly<Record<RequestSource, string>> = {
  AGENT: "İstemci",
  WEB: "Web",
};

/** P8b (AC-140): talep durumları. */
export const REQUEST_STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
  PENDING: "Bekliyor",
  ACCEPTED: "Kabul edildi",
  CANCELLED: "İptal",
  EXPIRED: "Süresi doldu",
  REJECTED: "Reddedildi",
  CONNECT_FAILED: "Bağlanamadı",
};

/** P8b (AC-140): İPTAL nedeni. */
export const CANCEL_REASON_LABELS: Readonly<Record<CancelReason, string>> = {
  CUSTOMER: "Müşteri iptal etti",
  DISCONNECTED: "Bağlantı koptu",
  TENANT_PASSIVE: "Firma pasif",
  CUSTOMER_PASSIVE: "Müşteri pasife alındı",
  BINDING_REVOKED: "Bilgisayar kaydı iptal edildi",
};

/** P18 (AC-257): öncelik etiketleri. */
export const PRIORITY_LABELS: Readonly<Record<RequestPriority, string>> = {
  LOW: "Düşük",
  NORMAL: "Normal",
  HIGH: "Yüksek",
};
/** P18 (AC-258): mesai dışında açılan talep rozeti. */
export const AFTER_HOURS_LABEL = "Mesai dışı";
/** P18 (AC-257): SLA aşımı rozeti ve oturum geçmişi CSV sütun başlığı. */
export const SLA_BREACHED_LABEL = "SLA aşıldı";
/** P18 (AC-258): mesai dışı modu. */
export const AFTER_HOURS_MODE_LABELS: Readonly<Record<AfterHoursMode, string>> = {
  ACCEPT: "Talebi al",
  REJECT: "Reddet ve sonraki açılışı göster",
};

/** P8c (AC-166): müşteri durumu (yalnız renkle değil metinle). */
export const CUSTOMER_STATUS_LABELS: Readonly<Record<CustomerStatus, string>> = {
  ACTIVE: "Aktif",
  PASSIVE: "Pasif",
};

/** P8c (AC-175): müşterisiz talep "Genel"; müşterisiz OTURUM boş gösterilir (AC-179). */
export const GENERAL_CUSTOMER_LABEL = "Genel";
/** r2 (§15.1, §15.7 K20): rozetler — kayıtlı bilgisayar kimlik doğrulaması değildir (nötr stil). */
export const VIA_BINDING_LABEL = "Kayıtlı bilgisayar";
export const BINDING_REVOKED_LABEL = "Kaydı iptal edilmiş bilgisayar";
export const STALE_SOURCE_LABEL = "Bu talep bağlantı yenilenmeden önce açıldı";
/** "Kayıtlı bilgisayar — <müşteri firma | Genel>" (kapsamlı rozet metni). */
export const viaBindingLabel = (customerFirmName: string | null): string =>
  `${VIA_BINDING_LABEL} — ${customerFirmName ?? GENERAL_CUSTOMER_LABEL}`;

/**
 * P8b (AC-146, G-E9-15): bilinen ağ metni. IP/TRUSTED güven veren rozet; PREFIX nötr (uyarıyı kaldırmaz); NONE metinsiz.
 * Cihaz: `KNOWN_DEVICE_LABEL`; ikisi de yoksa `FIRST_SEEN_SOURCE_LABEL` uyarı rozeti (`isFirstSeenSource`).
 */
export const NETWORK_MATCH_LABELS: Readonly<Record<NetworkMatch, string>> = {
  NONE: "",
  PREFIX: "Benzer ağdan önceki oturum var",
  IP: "Bu ağdan daha önce oturum yapıldı",
  TRUSTED: "Güvenilen ağ",
};
export const KNOWN_DEVICE_LABEL = "Bu bilgisayar daha önce destek aldı";
export const FIRST_SEEN_SOURCE_LABEL = "İlk kez görülen kaynak — firmanın kayıtlı numarasından arayıp talep kodunu doğrulayın";

export const CONSENT_LEVEL_LABELS: Readonly<Record<ConsentLevel, string>> = {
  VIEW: "Ekran görüntüleme",
  CONTROL: "Uzaktan kontrol",
  RECORDING: "Oturum kaydı",
};

export const CONSENT_DECISION_LABELS: Readonly<Record<ConsentDecision, string>> = {
  GRANTED: "Verildi",
  DENIED: "Reddedildi",
  REVOKED: "Geri alındı",
};

/** Onay kayıtları tablosundaki kaynak sütunu. */
export const CONSENT_SOURCE_LABELS: Readonly<Record<ConsentRecordSource, string>> = {
  UI: "Müşteri (pencere)",
  HOTKEY: "Müşteri (kısayol)",
  RECONNECT: "Bağlantı koptu",
  SYSTEM: "Sistem",
  TECH: "Teknisyen",
  UNATTENDED: "Gözetimsiz erişim (otomatik)",
};

/** P28f (§4.2, AC-391): `control.cancelled{by:"agent", source:"os_permission"}` — macOS Erişilebilirlik izni yok. */
export const OS_PERMISSION_CANCELLED = "Müşteri erişilebilirlik izni vermedi";

/** P28f (§4.1, S-P28f-15): `guest.pending` `os` alanı — müşteri beyanı (doğrulanmaz). */
export const CLIENT_OS_FIELD_LABEL = "İşletim sistemi (beyan)";
export const CLIENT_OS_LABELS: Readonly<Record<JoinAuditOs, string>> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  browser: "Tarayıcı",
};

/** `control.revoked` (SYSTEM kaynağı) `reason` etiketi (§3 tablo). */
export const CONTROL_REVOKE_REASON_LABELS: Readonly<Record<string, string>> = {
  permission: "Teknisyen yetkisi kaldırıldı",
  audit: "Kayıt yazılamadı — güvenlik için kapatıldı",
  admin: "Yönetici sonlandırdı",
  session_ended: "Oturum sona erdi",
  superseded: "Açılırken kapatıldı",
  disconnect: "Bağlantı koptu",
  reconnect: "Teknisyen bağlantısı yenilendi",
  stale: "Geçersiz izin kapatıldı",
  tech: "Teknisyen kontrolü bıraktı",
};

export const FILE_DIRECTION_LABELS: Readonly<Record<string, string>> = {
  TO_CUSTOMER: "Müşteriye",
  TO_TECH: "Teknisyene",
};

export const FILE_RESULT_LABELS: Readonly<Record<string, string>> = {
  OK: "Tamamlandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal edildi",
  CORRUPT: "Bozuk (doğrulanamadı)",
};

/** Zaman çizelgesi olayının sabit etiketi (ayrıntıya bakmayan kısım). */
export const TIMELINE_ACTION_LABELS: Readonly<Record<string, string>> = {
  "session.created": "Oturum oluşturuldu",
  "guest.pending": "Lobiye katıldı",
  "guest.rejected": "Teknisyen reddetti",
  "guest.admitted": "Kabul edildi",
  "guest.admit": "Yanlış kabul kodu",
  "reconnect.conflict": "Yeniden bağlanma reddedildi",
  "control.requested": "Kontrol istendi",
  "control.granted": "Kontrol verildi",
  "control.denied": "Müşteri reddetti",
  "control.revoked": "Kontrol kapandı",
  "control.released": "Teknisyen kontrolü bıraktı",
  "control.cancelled": "Teknisyen isteği geri çekti",
  "monitor.requested": "Monitör istendi",
  "monitor.granted": "Monitör paylaşıldı",
  "monitor.denied": "Monitör reddedildi",
  "session.caps_changed": "Teknisyen yetkileri daraldı",
  "session.cancelled": "İptal edildi",
  "session.expired": "Süresi doldu",
  "session.terminated": "Yönetici sonlandırdı",
  "session.ended": "Oturum bitti",
  "unattended.session.started": "Gözetimsiz bağlantı başladı",
  "unattended.session.ended": "Gözetimsiz bağlantı bitti",
  // P28a (mimari-p28 §8.1)
  "clipboard.consent": "Pano izni değişti",
  "clipboard.transfer": "Pano aktarımı",
  "print.job": "Uzaktan yazdırma",
  // P28b (mimari-p28b §11.1)
  "file.upload": "Dosya sunucuya yüklendi",
  "file.scan": "Dosya virüs taraması",
  "file.infected": "Virüslü dosya bulundu",
  "file.download": "Sunucudaki dosya indirildi",
  // P28d (mimari-p28d §6)
  ...VOICE_AUDIT_LABELS,
  // P22 (mimari-p22 §7.1; test-raporu D-1): session.chat_viewed/chat_summary/chat_rejected/chat_legacy/chat_history_sent
  ...CHAT_AUDIT_LABELS,
};

/** P28a (AC-345, 346): pano sonucu — konsol durum metni ve zaman çizelgesi. */
export const CLIP_RESULT_LABELS: Readonly<Record<ClipResult, string>> = {
  OK: "Aktarıldı",
  EMPTY: "Panoda metin yok",
  TOO_LARGE: "Pano metni 64 KB sınırını aşıyor",
  SENSITIVE: "Pano içeriği gizli olarak işaretli, aktarılmadı",
  INVALID: "Pano metni geçersiz, aktarılmadı",
  DENIED: "Müşteri tarafında izin kapalı, aktarılmadı",
  ERROR: "Pano aktarımı başarısız",
  TIMEOUT: "Pano aktarımı zaman aşımına uğradı",
  DISCONNECTED: "Müşteri bağlantısı koptu",
};
/** P28a (AC-349, 350): yazdırma sonucu. */
export const PRINT_RESULT_LABELS: Readonly<Record<PrintResult, string>> = {
  PRINTED: "Yazıcıya gönderildi",
  NO_PRINTER: "Müşterinin varsayılan yazıcısı yok",
  REJECTED: "Müşteri reddetti",
  TIMEOUT: "Müşteri yanıt vermedi",
  INVALID_PDF: "Belge geçerli bir PDF değil",
  TOO_LARGE: "Belge 20 MB sınırını aşıyor",
  BUSY: "Başka bir dosya aktarımı sürüyor",
  CANCELLED: "Yazdırma iptal edildi",
  ERROR: "Yazdırma hatası",
  ABANDONED: "Yazdırma yanıtsız kaldı (süre doldu)",
  DISCONNECTED: "Müşteri bağlantısı koptu",
};
export const PRINT_DECISION_LABELS: Readonly<Record<PrintDecision, string>> = {
  APPROVED: "Müşteri onayladı",
  REJECTED: "Müşteri reddetti",
  TIMEOUT: "Müşteri yanıt vermedi",
  NONE: "Onay sorulmadı",
};

export interface TimelineText {
  /** Ana metin (düz metin; `textContent` ile basılır). */
  label: string;
  /** Ek açıklama (ör. "Yönetici durumu bilinmiyor"); yoksa null. */
  note: string | null;
  /** true → uyarı rozeti ("Müşteri istemcisi yönetici olarak çalışıyordu"). */
  warn: boolean;
}

export const SELF_ELEVATED_WARNING = "Müşteri istemcisi yönetici olarak çalışıyordu";
export const SELF_ELEVATED_UNKNOWN = "Yönetici durumu bilinmiyor";

/** Görüşme süresi "3 dk 12 sn" / "45 sn" (zaman çizelgesi notu). */
const voiceDuration = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} dk ${s} sn` : `${s} sn`;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);

/** Zaman çizelgesi satırının Türkçe metni (§3 "UI gösterimi"). Bilinmeyen action ham döner. */
export function describeTimelineEvent(ev: Pick<TimelineEvent, "action" | "details">): TimelineText {
  const d = ev.details;
  const base = labelOf(TIMELINE_ACTION_LABELS, ev.action);
  const plain = (label: string, note: string | null = null): TimelineText => ({ label, note, warn: false });
  switch (ev.action) {
    case "control.requested":
      return plain(str(d.request) ? `Kontrol istendi (${str(d.request)}/5)` : base);
    case "control.granted":
      if (d.selfElevated === true) return { label: base, note: SELF_ELEVATED_WARNING, warn: true };
      return plain(base, d.selfElevated === null || d.selfElevated === undefined ? SELF_ELEVATED_UNKNOWN : null);
    case "control.revoked": {
      const source = str(d.source);
      if (source === "UI") return plain("Müşteri kapattı (pencere)");
      if (source === "HOTKEY") return plain("Müşteri kapattı (kısayol)");
      if (source === "RECONNECT") return plain(str(d.side) === "tech" ? "Teknisyen bağlantısı koptu" : "Müşteri bağlantısı koptu");
      const reason = str(d.reason);
      return plain(reason ? labelOf(CONTROL_REVOKE_REASON_LABELS, reason) : base);
    }
    case "control.cancelled":
      if (str(d.by) === "agent" && str(d.source) === "os_permission") return plain(OS_PERMISSION_CANCELLED);
      return plain(str(d.by) === "agent" ? "İstek müşteri tarafında bağlantı kesilince kapandı" : base);
    case "monitor.requested":
    case "monitor.granted":
    case "monitor.denied": {
      const n = str(d.monitorId);
      const verb = ev.action === "monitor.requested" ? "istendi" : ev.action === "monitor.granted" ? "paylaşıldı" : "reddedildi";
      return plain(n ? `Monitör ${n} ${verb}` : base);
    }
    case "session.ended": {
      const reason = str(d.reason);
      return plain(reason ? `Oturum bitti (${labelOf(END_REASON_LABELS, reason)})` : base);
    }
    case "session.terminated":
      return plain(base, str(d.reason));
    case "clipboard.consent":
      return plain(
        d.on === true ? "Müşteri pano iznini açtı" : d.by === "system" ? "Pano izni kendiliğinden kapandı" : "Müşteri pano iznini kapattı",
      );
    case "clipboard.transfer": {
      const dir = str(d.direction) === "TO_TECH" ? "Müşteri panosu alındı" : "Pano müşteriye gönderildi";
      const result = str(d.result);
      return plain(`${dir} (${str(d.bytes) ?? "0"} bayt)`, result && result !== "OK" ? labelOf(CLIP_RESULT_LABELS, result) : null);
    }
    case "print.job": {
      const result = str(d.result);
      const pages = str(d.pages);
      return plain(pages ? `${base} (${pages} sayfa)` : base, result ? labelOf(PRINT_RESULT_LABELS, result) : null);
    }
    case "file.infected": {
      const sig = str(d.signature);
      return { label: base, note: `İmza: ${sig ?? FSRV_UNKNOWN_SIGNATURE}`, warn: true };
    }
    case "file.scan": {
      const result = str(d.result);
      const reason = str(d.reason);
      if (result === "SCAN_FAILED") return plain(base, reason ? `Taranamadı: ${labelOf(AV_SCAN_REASON_LABELS, reason)}` : "Taranamadı");
      return plain(base, result === "CLEAN" ? "Temiz" : result === "INFECTED" ? "Virüslü" : null);
    }
    case "file.download":
      return plain(base, str(d.context) === "history" ? "Oturum geçmişinden" : null);
    case VOICE_AUDIT.REJECT: {
      const reason = str(d.reason);
      return plain(base, reason ? labelOf(VOICE_REJECT_REASON_LABELS, reason) : null);
    }
    case VOICE_AUDIT.END: {
      const reason = str(d.reason);
      const sec = typeof d.durationSec === "number" ? d.durationSec : null;
      const notes = [reason ? labelOf(VOICE_END_REASON_LABELS, reason) : null, sec !== null ? voiceDuration(sec) : null];
      const note = notes.filter((n): n is string => n !== null).join(" · ");
      return plain(base, note === "" ? null : note);
    }
    default:
      return plain(base);
  }
}

// --- P28b sunucu dosya durumu metinleri (mimari-p28b §7.2, §9; AC-358, 359, 362; Go `messages_p28.go` aynı metinler) ---
export const FSRV_UNKNOWN_SIGNATURE = "bilinmeyen imza";
/** "Dosya taranamadı, teslim edilmedi: <neden>" içindeki neden (AC-359). `BUSY` ayrı tam metindir (aşağıda). */
export const AV_SCAN_REASON_LABELS: Readonly<Record<AvScanReason, string>> = {
  UNAVAILABLE: "tarama servisine ulaşılamadı",
  TIMEOUT: "tarama zaman aşımı",
  ENCRYPTED: "şifreli arşiv",
  LIMIT: "tarama boyut sınırı",
  BUSY: "tarama servisi yoğun",
  ERROR: "tarama hatası",
};
/** `fsrv.init` kapı reddi metinleri (`state: "REJECTED"` + neden). */
export const FSRV_GATE_REASON_LABELS: Readonly<Record<FsrvGateReason, string>> = {
  MODE: "Bu oturumda sunucu üzerinden dosya aktarımı kapalı",
  FORBIDDEN: "Bu işlem için yetkiniz yok",
  UNSUPPORTED: "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin",
  BUSY: "Başka bir dosya aktarımı sürüyor",
  TOO_LARGE: "Dosya sunucu modunda 256 MB sınırını (ya da firma sınırını) aşıyor",
  RATE_LIMITED: "Çok sık dosya gönderildi; biraz sonra yeniden deneyin",
  SESSION_LIMIT: "Bu oturumda sunucu üzerinden en çok 2 GB aktarılabilir",
  QUOTA: "Firma depolama kotası doldu",
};
/** Satır/tel durumu kısa etiketleri (geçmiş "Sunucudaki dosyalar" ve ilerleme). */
export const STORED_FILE_STATE_LABELS: Readonly<Record<StoredFileState | FsrvWireState, string>> = {
  UPLOADING: "Yükleniyor",
  SCANNING: "Virüs taraması yapılıyor",
  CLEAN: "Temiz",
  INFECTED: "Virüslü bulundu",
  SCAN_FAILED: "Taranamadı",
  CORRUPT: "Bozuk (doğrulanamadı)",
  REJECTED: "Teslim edilmedi — saklanmadı",
  CANCELLED: "Teslim edilmedi — saklanmadı",
  EXPIRED: "Süresi doldu",
  DELETED: "Silindi",
  DELIVERED: "Teslim edildi",
};

/**
 * `fsrv.status` metni (iki taraf). Anlam (state, reason) çiftinden: `REJECTED` + neden = kapı reddi, `REJECTED` nedensiz =
 * alıcı reddi; `SCAN_FAILED/BUSY` ≠ kapı `BUSY`. Metin gerektirmeyen ara durumlarda null.
 */
export function describeFsrvStatus(state: FsrvWireState, reason?: string | null, signature?: string | null): string | null {
  switch (state) {
    case "INFECTED":
      return `Dosya virüslü bulundu (${signature ?? FSRV_UNKNOWN_SIGNATURE}), teslim edilmedi`;
    case "SCAN_FAILED":
      if (reason === "BUSY") return "Virüs tarama servisi yoğun, dosya teslim edilmedi";
      return `Dosya taranamadı, teslim edilmedi: ${labelOf(AV_SCAN_REASON_LABELS, reason ?? "ERROR")}`;
    case "REJECTED":
      return reason ? labelOf(FSRV_GATE_REASON_LABELS, reason) : "Alıcı reddetti";
    case "CORRUPT":
      return "Dosya doğrulanamadı (bozuk), teslim edilmedi";
    case "CANCELLED":
      return "Aktarım iptal edildi";
    case "DELIVERED":
      return "Teslim edildi";
    default:
      return null;
  }
}

/**
 * P13a: dış gönderim / bağlantı testi `reason` kodlarının Türkçe etiketleri (T-P12b, mimari-p13 §3). Kaynaklar: SMTP
 * (`mail/service.ts` SmtpFailure + not_configured), MySQL (`MYSQL_TEST_REASONS`), WhatsApp (`WA_TEST_REASONS`), sunucu
 * görünümünün izdüşümü (`audit/view.ts`: biçim dışı → `other`). Aynı kod tüm kanallarda aynı anlamı taşır; bilinmeyen ham.
 */
export const OUTBOUND_REASON_LABELS: Readonly<Record<string, string>> = {
  // ortak
  connect: "Sunucuya bağlanılamadı",
  auth: "Kimlik reddedildi (kullanıcı adı veya şifre hatalı)",
  timeout: "Zaman aşımı",
  other: "Diğer hata",
  // SMTP
  tls: "TLS/sertifika hatası",
  rejected: "Alıcı veya ileti sunucu tarafından reddedildi",
  port_not_allowed: "İzin verilmeyen port",
  not_configured: "SMTP ayarı yapılandırılmamış",
  no_smtp: "SMTP ayarı yok",
  // MySQL
  database: "Veritabanı bulunamadı veya erişim yok",
  secret_unreadable: "Kayıtlı şifre okunamadı",
  // WhatsApp
  unconfigured: "Servis yapılandırılmamış",
  insecure: "Güvensiz adres (canlı ortamda kanal kapalı)",
  http_error: "Servis hata döndürdü",
  redirect: "Servis yönlendirme döndürdü (izlenmez)",
  unreachable: "Servise ulaşılamadı",
  invalid_response: "Servis geçersiz yanıt döndürdü",
};

/**
 * P15 (AC-234): `share.state.reason` — istemcinin paylaşım hatası neden kodu (Go `capture.Reason`). Kişisel veri yok.
 * Bilinmeyen kod (yeni istemci) `describeShareFailure` ile "Bilinmeyen neden (KOD)" olarak gösterilir (S17-2).
 */
export const SHARE_FAIL_REASON_LABELS: Readonly<Record<string, string>> = {
  DXGI_UNSUPPORTED: "Ekran yakalama bu ekran kartında/ayarda desteklenmiyor (hibrit GPU, HDR veya eski sürücü)",
  DXGI_ACCESS_DENIED: "Ekran yakalamaya izin verilmedi (kilit ekranı veya güvenli masaüstü)",
  DXGI_NOT_AVAILABLE: "Ekran yakalama şu an kullanılamıyor (tam ekran uygulama veya uzak masaüstü)",
  NO_OUTPUT: "Seçilen monitör bulunamadı",
  D3D_DEVICE: "Grafik aygıtı başlatılamadı",
  FIRST_FRAME_TIMEOUT: "Ekran görüntüsü zamanında alınamadı",
  GDI_FAILED: "Yedek ekran yakalama yöntemi de başarısız oldu",
  MF_STARTUP: "Windows medya bileşenleri eksik (Media Feature Pack)",
  NO_H264_ENCODER: "Bilgisayarda görüntü kodlayıcı (H.264) bulunamadı",
  ENCODER_CONFIG: "Görüntü kodlayıcı ayarları kabul etmedi",
  ENCODE_FAILED: "Yayın sırasında görüntü kodlama hatası",
  // P17 I4 (AC-248): pencere modu (WGC). Go `capture.Reason` ile eşleşme `test/p17-share-reasons.test.ts`'te denetlenir.
  WGC_UNSUPPORTED: "Bu Windows sürümü pencere paylaşımını desteklemiyor",
  WINDOW_CLOSED: "Paylaşılan pencere kapatıldı",
  WINDOW_UNAVAILABLE: "Seçilen pencere paylaşılamadı (pencereye erişilemiyor)",
  OTHER: "Diğer hata",
};

/** P15 (AC-234): `share.state.method` — son denenen yakalama yolu. */
export const SHARE_METHOD_LABELS: Readonly<Record<string, string>> = {
  DXGI: "Masaüstü çoğaltma (DXGI)",
  GDI: "Yedek yakalama (GDI)",
  WGC: "Pencere yakalama (WGC)",
};

/**
 * P15 (AC-234): konsoldaki paylaşım hatası metni. Bilinen kod → Türkçe etiket; bilinmeyen → "Bilinmeyen neden (KOD)"
 * (ham kod korunur). `method` varsa parantez içinde eklenir. `reason` yoksa null (0.10.x istemci: metin yok).
 */
export function describeShareFailure(reason: string | null | undefined, method?: string | null): string | null {
  if (!reason) return null;
  const base = Object.hasOwn(SHARE_FAIL_REASON_LABELS, reason)
    ? (SHARE_FAIL_REASON_LABELS[reason] ?? reason)
    : `Bilinmeyen neden (${reason})`;
  return method ? `${base} — ${labelOf(SHARE_METHOD_LABELS, method)}` : base;
}

/** P15 (AC-238): `session_files.reported_by`. */
export const FILE_REPORTED_BY_LABELS: Readonly<Record<string, string>> = {
  TECH: "Teknisyen",
  CUSTOMER: "Müşteri",
};
/** P15 (AC-238): teknisyen raporlu ya da iki tarafça eşleşen satır. */
export const FILE_VERIFIED_LABEL = "Doğrulanmış";
/** P15 (AC-238): yalnız müşteri tarafının bildirdiği satır (sunucu teknisyen tarafından doğrulamadı). */
export const FILE_CUSTOMER_REPORT_LABEL = "Müşteri bildirimi";
export const fileVerificationLabel = (verified: boolean): string => (verified ? FILE_VERIFIED_LABEL : FILE_CUSTOMER_REPORT_LABEL);

/** P21 (mimari-p21 §4.5): audit süzgecinde `portal.*` grubunun adı (web `AUDIT_GROUP_LABELS`'a yayılır; RECORDING kalıbı). */
export const PORTAL_AUDIT_GROUP_LABELS: Readonly<Record<string, string>> = { portal: "Müşteri portalı" };
/** P21 eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const PORTAL_AUDIT_LABELS: Readonly<Record<PortalAuditAction, string>> = {
  [PORTAL_AUDIT.LOGIN]: "Portal girişi",
  [PORTAL_AUDIT.LOCKED]: "Portal hesabı kilitlendi",
  [PORTAL_AUDIT.LOGOUT]: "Portal çıkışı",
  [PORTAL_AUDIT.PASSWORD_CHANGE]: "Portal şifresi değiştirildi",
  [PORTAL_AUDIT.MFA_ENABLED]: "Portal 2FA etkinleştirildi",
  [PORTAL_AUDIT.MFA_DISABLED]: "Portal 2FA kapatıldı",
  [PORTAL_AUDIT.ACCOUNT_CREATED]: "Portal hesabı oluşturuldu",
  [PORTAL_AUDIT.ACCOUNT_DEACTIVATED]: "Portal hesabı pasife alındı",
  [PORTAL_AUDIT.ACCOUNT_REACTIVATED]: "Portal hesabı yeniden etkinleştirildi",
  [PORTAL_AUDIT.ACCOUNT_PASSWORD_RESET]: "Portal hesabı şifresi sıfırlandı",
  [PORTAL_AUDIT.ACCOUNT_DELETED]: "Portal hesabı silindi (saklama süresi)",
};
