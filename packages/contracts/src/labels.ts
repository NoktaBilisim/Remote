// Enum → Türkçe etiket eşlemesinin TEK yeri (mimari-api "Oturum geçmişi (P8)"). Web ve sunucu CSV'si aynı eşlemeyi kullanır.
// CHECK'i olmayan değerler (`end_reason`, audit `action`) bilinmiyorsa ham gösterilir: `labelOf` boş bırakmaz, hata atmaz.
import type { CustomerStatus } from "./api/customers.ts";
import type { CancelReason, NetworkMatch, RequestStatus } from "./api/requests.ts";
import type { ConsentDecision, ConsentLevel, ConsentRecordSource, SessionEndedBy, SessionMode, SessionSource, SessionStatus, TimelineEvent } from "./api/sessions.ts";

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
};

/** P8b (AC-158): geçmiş listesi/CSV "Kaynak". */
export const SESSION_SOURCE_LABELS: Readonly<Record<SessionSource, string>> = {
  TECH: "Teknisyen",
  REQUEST: "Talep",
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
export const viaBindingLabel = (customerFirmName: string | null): string => `${VIA_BINDING_LABEL} — ${customerFirmName ?? GENERAL_CUSTOMER_LABEL}`;

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
    default:
      return plain(base);
  }
}
