// P28e oturum kaydı REST sözleşmesi (mimari-p28e r2 §5; AC-380, 383, 384, 385, 386, 447, 450). Ortak hata zarfı
// `errors.ts`; YENİ hata kodu yok — `STORAGE_QUOTA` (409), `RATE_LIMITED` (429), `CONFLICT` (409), `NOT_FOUND` (404),
// `VALIDATION` (400) yeniden kullanılır. Parça uçları çerez OKUMAZ: kimlik yalnız `Authorization: Bearer` (URL'de asla — Caddy
// yol loglar). Başka tenant / kapsam dışı / belirteç uyuşmazlığı her yerde 404. Sabitler ve WS mesajları `ws-rec.ts`'te.
import { z } from "zod";
import type { ConsentMode } from "../unattended-consent.ts";
import {
  REC_CONSENT_LINE,
  REC_PART_CONTENT_TYPE,
  REC_PART_DURATION_MAX_MS,
  REC_PART_DURATION_MIN_MS,
  REC_PART_MAX_BYTES,
  REC_RETENTION_MAX,
  REC_RETENTION_MIN,
  REC_RID_PATTERN,
  REC_SERIES_MAX,
  REC_SERIES_MAX_PART,
  REC_TOKEN_PATTERN,
  type RecBasis,
  type RecDeleteReason,
  type RecState,
  type RecStateReason,
  type RecStopReason,
} from "../ws-rec.ts";
import type { TenantStorageUsage } from "./fsrv.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const sessionId = z.string().regex(ULID, "Geçersiz kimlik");

/** Ondalık, baştaki sıfırsız tam sayı dizesi → sayı (yol/başlık parametresi). */
const decimal = (maxDigits: number) =>
  z
    .string()
    .regex(new RegExp(`^(0|[1-9][0-9]{0,${maxDigits - 1}})$`), "Geçersiz sayı")
    .transform(Number);

// ---------------------------------------------------------------------------------------------------------------
// PUT /api/v1/rec/:rid/series/:s/parts/:p — `Content-Type: video/webm`, gövde ≤ REC_PART_MAX_BYTES (rota `bodyLimit`).
// Bearer YÜKLEME belirteci `onRequest`'te, gövde okunmadan (S-P28e-5/6). Akış §5.1; durma payı §5.3.
// GET  /api/v1/rec/:rid/series/:s/parts/:p — Bearer İZLEME belirteci; 200 düz WebM (`REC_PART_CONTENT_HEADERS`), Range yok.
// ---------------------------------------------------------------------------------------------------------------

/** Yol parametreleri. `s > 65535` / `p > 59` / biçim dışı → 400 `VALIDATION` (mimari §5; P28b'nin 404'ünden farklı). */
export const recPartParamsSchema = z.strictObject({
  rid: z.string().regex(REC_RID_PATTERN, "Geçersiz kimlik"),
  s: decimal(5).pipe(z.number().int().max(REC_SERIES_MAX)),
  p: decimal(2).pipe(z.number().int().max(REC_SERIES_MAX_PART)),
});
export type RecPartParams = z.output<typeof recPartParamsSchema>;

/**
 * PUT başlıkları (Fastify küçük harfli verir; diğer başlıklar atılır). `x-rec-series-start-ms` (epoch ms) YALNIZ `p = 0`'da
 * zorunlu, `p > 0`'da yasak — kural parametreye bağlı olduğundan `recSeriesStartValid` ile rota uygular (400 `VALIDATION`,
 * `fields["x-rec-series-start-ms"]`). Sunucu değeri `clamp(start, son parça bitişi, now)` ile sınırlar (§5.1 m.4).
 * `Content-Length` zorunlu (1..REC_PART_MAX_BYTES), `Transfer-Encoding` yasak (D-P28e-K1-3).
 */
export const recPartHeadersSchema = z.object({
  "content-type": z.literal(REC_PART_CONTENT_TYPE, { error: "İçerik türü video/webm olmalı" }),
  "content-length": decimal(7).pipe(z.number().int().min(1).max(REC_PART_MAX_BYTES)),
  "transfer-encoding": z.undefined({ error: "Parça gövdesi Content-Length ile gönderilmeli" }).optional(),
  "x-rec-duration-ms": decimal(5).pipe(z.number().int().min(REC_PART_DURATION_MIN_MS).max(REC_PART_DURATION_MAX_MS)),
  "x-rec-series-start-ms": decimal(16).pipe(z.number().int().max(Number.MAX_SAFE_INTEGER)).optional(),
});
export type RecPartHeaders = z.output<typeof recPartHeadersSchema>;
/** `X-Rec-Series-Start-Ms` yalnız bölümün ilk parçasında (`p = 0`) ve orada zorunlu. */
export const recSeriesStartValid = (p: number, seriesStartMs: number | undefined): boolean => (p === 0) === (seriesStartMs !== undefined);

/** `Authorization: Bearer <43 karakter base64url>` (yükleme ve izleme belirteci aynı biçim; tür tablodan). */
export const recBearerSchema = z
  .string()
  .regex(new RegExp(`^Bearer ${REC_TOKEN_PATTERN.source.slice(1, -1)}$`))
  .transform((v) => v.slice("Bearer ".length));

/** 200: parça yazıldı ya da (s,p) zaten vardı (idempotent, yazılmadı). `next` = bu bölümde beklenen sonraki parça. */
export interface RecPartResponse {
  next: number;
}
/**
 * 409 sıra dışı (`p ≠ next`): gövde hata zarfı DEĞİL; konsol `next`'ten sürer (P28b `FsrvChunkGapResponse` kalıbı). Yeni
 * bölüm kuralı ihlali (`s ≤ son s` ya da `p ≠ 0`) 409 `CONFLICT` zarfıdır. Kota/disk → 409 `STORAGE_QUOTA` zarfı.
 */
export interface RecPartGapResponse {
  next: number;
}

/** Parça GET yanıtının sabit güvenlik başlıkları (K-P28e-5): `Content-Disposition` ve `Accept-Ranges` YOK. */
export const REC_PART_CONTENT_HEADERS = {
  "Content-Type": REC_PART_CONTENT_TYPE,
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "sandbox; default-src 'none'",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// GET /api/v1/sessions/:id/recording — çerez; `session_history.view` + `sessions.view_recording` + historyScope.
// POST /api/v1/sessions/:id/recording/view — çerez + CSRF; aynı yetki; REC_VIEW_PER_MIN/dk/kullanıcı. Audit `recording.view`.
// DELETE /api/v1/sessions/:id/recording — çerez + CSRF; `session_history.edit` + historyScope; 204, ACTIVE → 409 CONFLICT.
// ---------------------------------------------------------------------------------------------------------------

export const recordingParamsSchema = z.strictObject({ id: sessionId });

/** Bölüm içi parça (oynatıcı dizini). `offsetMs` kayıt başından. */
export interface RecordingPartItem {
  p: number;
  offsetMs: number;
  durationMs: number;
}
/** Bölüm = bir MediaRecorder çalışması (`p = 0` başlık içerir); `offsetMs` MSE `timestampOffset`'idir. */
export interface RecordingSeriesItem {
  s: number;
  offsetMs: number;
  parts: RecordingPartItem[];
}
/** GET yanıtı. Kayıt yok ya da `deleted` → 404 (silinmiş kaydın izi geçmiş detayındaki `recording` alanında). */
export interface RecordingView {
  id: string;
  state: Exclude<RecState, "deleted">;
  basis: RecBasis;
  stopReason?: RecStopReason;
  startedAt: string;
  stoppedAt?: string;
  durationMs: number;
  sizeBytes: number;
  expiresAt: string;
  /** Gözetimsiz kayıtta oturumun kipi (AC-450). */
  consentMode?: ConsentMode;
  /** `silent` kipte ve anonimleştirilmemiş oturumda gerekçe (AC-450). */
  silentReason?: string;
  series: RecordingSeriesItem[];
  canDelete: boolean;
}

/** POST /view gövdesi `{}` (ya da boş). */
export const recordingViewInputSchema = z.strictObject({});
/**
 * İzleme belirteci (`authSessionId`'ye bağlı; kullanıcı + kayıt başına tek etkin — yeni POST eskisini düşürür). Kayan süre:
 * her parça GET'i `idleUntil = now + idleTtlMs`; `maxUntil` (ISO) = `min(now + durationMs + 30 dk, now + 8 sa)`.
 * Yanıt gövdesi loglanmaz.
 */
export interface RecordingViewResponse {
  token: string;
  idleTtlMs: number;
  maxUntil: string;
}

/** DELETE gövdesi: `confirm: true` zorunlu (onay diyaloğu; step-up yok — K-P28e-15). */
export const deleteRecordingInputSchema = z.strictObject({ confirm: z.literal(true, { error: "Onay gerekli" }) });
export type DeleteRecordingInput = z.infer<typeof deleteRecordingInputSchema>;
/** 409 `CONFLICT` metni (ACTIVE kayıt). */
export const REC_DELETE_ACTIVE_MESSAGE = "Oturum sürerken kayıt silinemez";

// ---------------------------------------------------------------------------------------------------------------
// GET/PUT /api/v1/settings/recording — `settings.view` / `settings.edit`; `unattendedEnabled` false→true step-up ister.
// ---------------------------------------------------------------------------------------------------------------

export interface RecordingSettingsView {
  enabled: boolean;
  retentionDays: number;
  unattendedEnabled: boolean;
  /** Gözetimsiz kayıt bilgilendirme kutusunun son işaretlendiği an (ISO). */
  unattendedAckAt?: string;
  /** Dosya + kayıt tek kota (V50, `storageUsage`). */
  storage: TenantStorageUsage;
  /** = firma oturum saklama süresi ile `REC_RETENTION_MAX`'ın küçüğü (sayı alanının üst sınırı). */
  maxRetentionDays: number;
  /** Dört göz alıcı kümesi boş (S-P28e-4) → ekranda tek yönetici uyarısı. */
  soleManager: boolean;
}

/**
 * PUT gövdesi. Durumsuz kural burada: `unattendedEnabled ∧ ¬enabled` → `fields.unattendedEnabled`. Geçişe bağlı kurallar
 * SERVİSTE (mevcut değere bağlı): `enabled` false→true ∧ `consentUpdated ≠ true` → 400 `fields.consentUpdated`;
 * `unattendedEnabled` false→true ∧ `employeeNoticeAck ≠ true` → 400 `fields.employeeNoticeAck` + step-up;
 * `retentionDays > tenant.retentionDays` → 400 `fields.retentionDays`. `retentionDays` yalnız yeni kayıtlara (S-P28e-8).
 */
export const putRecordingSettingsInputSchema = z
  .strictObject({
    enabled: z.boolean(),
    retentionDays: z
      .number({ error: "Gün sayısı girin" })
      .int("Tam sayı girin")
      .min(REC_RETENTION_MIN, `En az ${REC_RETENTION_MIN} gün`)
      .max(REC_RETENTION_MAX, `En çok ${REC_RETENTION_MAX} gün`),
    unattendedEnabled: z.boolean(),
    consentUpdated: z.literal(true).optional(),
    employeeNoticeAck: z.literal(true).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.unattendedEnabled && !v.enabled)
      ctx.addIssue({ code: "custom", path: ["unattendedEnabled"], message: REC_UNATTENDED_REQUIRES_ENABLED_MESSAGE });
  });
export type PutRecordingSettingsInput = z.infer<typeof putRecordingSettingsInputSchema>;

export const REC_UNATTENDED_REQUIRES_ENABLED_MESSAGE = "Önce oturum kaydını açın";
/** `fields.consentUpdated` (AC-380/354; P28b `FILE_MODE_CONSENT_REQUIRED_MESSAGE` ile aynı cümle). */
export const REC_CONSENT_UPDATED_REQUIRED_MESSAGE = "Açmadan önce aydınlatma metnini güncellediğinizi onaylayın";
/** `fields.employeeNoticeAck` (AC-436 kutusu; P28u `POLICY_ACK_REQUIRED_MESSAGE` ile aynı cümle). */
export const REC_EMPLOYEE_NOTICE_REQUIRED_MESSAGE = "Açmak için bilgilendirme kutusunu işaretleyin";
export const REC_RETENTION_EXCEEDS_MESSAGE = "Kayıt saklama süresi firma oturum saklama süresini aşamaz";
/** Saklama alanı yardımı (S-P28e-8 Sonra, K-P28e-22). */
export const REC_RETENTION_FORWARD_HINT = "Yeni süre yalnız bundan sonraki kayıtlara uygulanır";
/** `soleManager` uyarısı (S-P28e-4). */
export const REC_SOLE_MANAGER_WARNING = "Politika değişikliği e-postası yalnız size gider; en az iki yönetici tanımlayın";

// ---------------------------------------------------------------------------------------------------------------
// Mevcut uçlara ekler: geçmiş detayı `recording`, geçmiş listesi `hasRecording` + süzgeç `recorded` (`api/sessions.ts`),
// `ConsentTextView.recording` (resolve + talep formu + web talep formu metin yanıtları).
// ---------------------------------------------------------------------------------------------------------------

/** GET /sessions/:id/history `recording` alanı (satır yoksa null). `deleted` satırda `deleteReason` dolu. */
export interface SessionRecordingSummary {
  state: RecState;
  basis: RecBasis;
  stopReason?: RecStopReason;
  deleteReason?: RecDeleteReason;
  durationMs: number;
  expiresAt: string;
  canView: boolean;
  canDelete: boolean;
}

/**
 * `ConsentTextView.recording` — YALNIZ `offered = true` iken eklenir (`tenant.recording_enabled ∧ kota boş ∧ disk ≥ %10`,
 * AC-381/384). İstemci `lineSha256` derlemedeki `REC_CONSENT_LINE_SHA256` değilse kutuyu göstermez (güvenli yön).
 */
export interface RecordingConsentOffer {
  offered: boolean;
  line: string;
  lineSha256: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Etiketler ve metinler (web + kılavuz; Go kendi `messages_p28e.go` tablosunu tutar).
// ---------------------------------------------------------------------------------------------------------------

export const REC_BASIS_LABELS: Readonly<Record<RecBasis, string>> = {
  consent: "Müşteri rızası",
  tenant_policy: "Firma politikası",
};
/** Konsol göstergesi / misafir bilgi satırı (`rec.state.reason`). */
export const REC_STATE_REASON_LABELS: Readonly<Record<RecStateReason, string>> = {
  revoked: "Müşteri kayıt iznini geri aldı",
  quota: "Depolama kotası doldu, kayıt durdu",
  session_end: "Oturum bitti, kayıt durdu",
  error: "Kayıt durdu (hata)",
  policy_off: "Firma kayıt ayarı kapatıldı, kayıt durdu",
  unavailable: "Bu firmada oturum kaydı kapalı",
};
/** Geçmiş detayı (silinmiş kayıt satırı). */
export const REC_DELETE_REASON_LABELS: Readonly<Record<RecDeleteReason, string>> = {
  expired: "Kayıt silindi — süresi doldu",
  manual: "Kayıt silindi — elle silindi",
  missing: "Kayıt silindi — kayıt dosyası bulunamadı",
};
export const REC_INDICATOR_LABEL = "Kayıt yapılıyor";
export const REC_REVOKE_BUTTON_LABEL = "Kaydı durdur";
export const REC_GUEST_STOPPED_MESSAGE = "Kayıt durduruldu; o ana kadarki kısım saklanır";
/** `rec.revoke`'tan `REC_REVOKE_ACK_MS` içinde `off` gelmedi (S-P28e-2). */
export const REC_REVOKE_PAUSED_MESSAGE = "Kayıt durdurulamadı, paylaşım duraklatıldı";
/** Konsol `rec1` bildiremiyor (K-P28e-9, V-PE-5). */
export const REC_UNSUPPORTED_MESSAGE = "Bu tarayıcı oturum kaydını desteklemiyor; Chrome, Edge veya Firefox kullanın";
/** Gözetimsiz konsol: politika açık, cihaz `record1` bildirmedi (§6.1). */
export const REC_DEVICE_OUTDATED_MESSAGE = "Cihaz istemcisi eski; kayıt için 0.16.0 gerekli";
/** Onay kutusu metni (yeniden dışa aktarım; tek kaynak `ws-rec.ts`). */
export { REC_CONSENT_LINE };
