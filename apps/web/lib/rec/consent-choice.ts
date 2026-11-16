/*
 * P28e (mimari-p28e §9, K-P28e-3): müşterinin kayıt rızası seçimi YALNIZ bellekte tutulur (sessionStorage'a yazılmaz; sayfa
 * yenilenirse rıza yok sayılır). Onay ekranı (join formu / web talep formu) yazar; oturum (GuestSession) bir kez TÜKETİR.
 * Tek yol: kod/bağlantı ve web talep akışı aynı depoyu kullanır (talep → bekleme odası → oturum arası prop taşınmaz).
 */
import { REC_CONSENT_LINE_SHA256 } from "@remote/contracts/ws-rec";
import type { RecordingConsentOffer } from "@remote/contracts/api/recording";

let chosen = false;

/** Form gönderiminde yazılır (işaretsiz gönderim önceki seçimi de siler). */
export function setRecConsent(v: boolean): void {
  chosen = v;
}

/** Oturum başında bir kez okunur ve sıfırlanır (ikinci okuma false). */
export function takeRecConsent(): boolean {
  const v = chosen;
  chosen = false;
  return v;
}

/**
 * Kutu gösterilsin mi: yalnız `offered = true` ve SHA derlemedeki cümleninkiyle aynıysa (güvenli yön; eski/yanlış metinle
 * gösterilen kutu sunucuda zaten reddedilir). Alan yoksa / biçim dışıysa false (çalışma zamanı koruması — web talep formu
 * yanıt tipinde alan henüz tanımlı değil, K3 notu).
 */
export function recordingOffered(consentText: unknown): boolean {
  if (!consentText || typeof consentText !== "object") return false;
  const r = (consentText as { recording?: Partial<RecordingConsentOffer> }).recording;
  return Boolean(r && r.offered === true && r.lineSha256 === REC_CONSENT_LINE_SHA256);
}
