// P28e oturum kaydı WS sözleşmesi ve sabitleri (mimari-p28e r2 §4, §6, §7, §11.4; ADR-0034; AC-381, 382, 383, 384, 388).
// Yaprak modül (yalnız zod): `ws.ts`, `ws-device.ts`, `api/recording.ts` buradan alır — import döngüsü yok (PT-K1).
// Şemalar `z.strictObject` (ekstra alan → 1008). `rec.*` misafir mesajları YALNIZ `rs.cap.rec1` bildiren `/ws/guest` soketinde
// şemadadır (`guestInboundSchemaFor(_, _, true)`); cihaz eki YALNIZ `rs.cap.record1` bildiren `/ws/device` soketine gider.
// Go eşi `internal/signal/rec.go` + `internal/servis/wire_rec.go`; ortak örnekler `fixtures/rec.json` (valid.* geçer, invalid.* reddedilir).
// Kelime düzeni: tel üstünde küçük harf (`consent`, `session_end`), DB CHECK'lerinde büyük harf (`CONSENT`, `SESSION_END`);
// dönüşüm yalnız `recToDb` / `recFromDb` ile yapılır (tek kural: harf büyütme).
import { z } from "zod";

// --- Yetenek belirteçleri (§6.1; kimlik değildir, Caddy loglamaz — G-10) ---
/** `/ws/guest` (Go istemci 0.16.0, tarayıcı misafir) ve `/ws/tech` (konsol `MediaRecorder` VP8 destekliyorsa). */
export const WS_CAP_REC = "rs.cap.rec1";
/** `/ws/device` (servis 0.16.0): `connect.recording` ve `rec.state` yalnız bu sokete gider (K-P28e-7). */
export const WS_DEVICE_CAP_RECORD = "rs.cap.record1";

// --- Rıza metni (§4) ---
/** Katılımlı oturumda onay ekranındaki ayrı, işaretsiz kutunun metni (web + Go aynı cümle). */
export const REC_CONSENT_LINE = "Oturumun görüntü kaydının alınmasına izin veriyorum";
/**
 * `REC_CONSENT_LINE`'ın UTF-8 SHA-256'sı (küçük hex). Tarayıcıda eşzamanlı SHA olmadığından sabit yazılır; birim testi
 * cümleden yeniden hesaplayıp eşitliği sabitler (cümle değişirse test kırılır → SHA da güncellenir). Sunucu yalnız bunu kabul eder.
 */
export const REC_CONSENT_LINE_SHA256 = "367c841cafd53771a4efd842c46c744a476c9801859791434a388e1d17e39dc9";
/** Gözetimsiz `asked` diyaloğundaki satır (AC-449; yardımcı çizer). */
export const REC_UNATTENDED_LINE = "Bu bağlantının ekran kaydı alınacaktır";

// --- Sabitler (§11.4; Go eşi ve fikstür `constants` aynı değerler) ---
/** MediaRecorder timeslice = bir parça. */
export const REC_PART_MS = 5_000;
/** Bölüm = bir MediaRecorder çalışması (K0s, K-P28e-16); geçiş parça sayısıyla (60. parça). */
export const REC_SERIES_MS = 300_000;
/** Bölüm başına parça sayısı (`REC_SERIES_MS / REC_PART_MS`). */
export const REC_SERIES_PARTS = REC_SERIES_MS / REC_PART_MS;
/** En büyük `part_no` (DB CHECK 0..59). */
export const REC_SERIES_MAX_PART = REC_SERIES_PARTS - 1;
/** En büyük `series_no` (DB `SMALLINT UNSIGNED`). */
export const REC_SERIES_MAX = 65_535;
/** Durma payında aynı bölümde kabul edilen en çok parça (3 kuyruk + 1 uçuşta; S-P28e-1). */
export const REC_STOP_GRACE_PARTS = 4;
/** Durma / kaynak eş yokken / oda kapanışında yükleme payı (S-P28e-1/2). */
export const REC_STOP_GRACE_MS = 15_000;
/** Durma payında `offset + duration ≤ (stopped_at − started_at) + bu` (S-P28e-1). */
export const REC_STOP_OFFSET_SLACK_MS = 2_000;
/** `rec.revoke`'tan sonra bu sürede `rec.state{on:false}` gelmezse istemci görüntüyü yerelde duraklatır (S-P28e-2, AC-382). */
export const REC_REVOKE_ACK_MS = 2_000;
/** Yükleme belirteci başına kayan pencerede dakikada en çok PUT (S-P28e-5). */
export const REC_PUT_PER_MIN = 30;
/** Süreç geneli eşzamanlı PUT semaforu (S-P28e-5). */
export const REC_PUT_CONCURRENCY = 32;
/** İzleme jeton kovası kapasitesi: 2 tam bölüm seek'i + 6 (S-P28e-3). */
export const REC_VIEW_BURST_PARTS = 126;
/** İzleme kovası dolumu (parça/dk; 5 sn parçada oynatma hızının 2 katı). */
export const REC_VIEW_REFILL_PER_MIN = 24;
/** Kullanılmayan izleme kovası bu süre sonra atılır. */
export const REC_VIEW_BUCKET_IDLE_MS = 1_800_000;
/** `p>0` gövdesi Cluster (`1F43B675`) ile başlamalı mı (K7 ölçümüyle güncellenir; S-P28e-7). */
export const REC_REQUIRE_CLUSTER_START = false;
/** Parça gövdesi üst sınırı (rota `bodyLimit`; DB CHECK `size_bytes ≤ 2097152`). */
export const REC_PART_MAX_BYTES = 2_097_152;
/** Konsol kaydedicisinin hedef bit hızı (yalnız hedef; sunucu tavanı ayrı). */
export const REC_TARGET_BPS = 1_500_000;
/** Sunucu oran tavanı: toplam bayt ≤ `REC_MAX_BYTES_PER_HOUR × geçen saat + REC_RATE_SLACK_BYTES` (AC-384). */
export const REC_MAX_BYTES_PER_HOUR = 1_073_741_824;
export const REC_RATE_SLACK_BYTES = 33_554_432;
/** `rec.consent` ilk admit `hello`'sundan en geç bu sürede gelmeli (aksi `consent_rejected{window}`). */
export const REC_CONSENT_WINDOW_MS = 30_000;
/** Parça gözcüsü: kaydedici bağlı + görüntü akıyor + bu sürede parça yok → `STOPPED{ERROR, no_upload}` (K-P28e-8). */
export const REC_WATCHDOG_MS = 30_000;
/** Teknisyen (kaydedici) bu sürede dönmezse ve oturum sürerse aynı stop yazılır (§6.3). */
export const REC_RECORDER_RETURN_MS = 120_000;
/** İzleme belirtecinin kayan boşta süresi (her GET `idleUntil = now + bu`). */
export const REC_VIEW_IDLE_MS = 300_000;
/** İzleme belirteci en çok: `durationMs + bu` … */
export const REC_VIEW_MAX_EXTRA_MS = 1_800_000;
/** … ve her durumda en çok 8 sa. */
export const REC_VIEW_MAX_MS = 28_800_000;
/** `POST /sessions/:id/recording/view`: kullanıcı başına dakikada en çok. */
export const REC_VIEW_PER_MIN = 20;
/** Parça uçlarında IP başına dakikada en çok 404 (aşım → 429; P28b kalıbı). */
export const REC_NOTFOUND_PER_MIN_IP = 60;
/** `X-Rec-Duration-Ms` aralığı (DB CHECK `duration_ms 1..15000`). */
export const REC_PART_DURATION_MIN_MS = 1;
export const REC_PART_DURATION_MAX_MS = 15_000;
/** `p>0`: `Σduration + X-Rec-Duration-Ms ≤ now − started_at + bu` (S-P28e-7). */
export const REC_DURATION_SLACK_MS = 15_000;
/** Konsol yükleme kuyruğu (parça) ve yeniden deneme aralıkları (§7). */
export const REC_UPLOAD_QUEUE_PARTS = 3;
export const REC_UPLOAD_RETRY_MS = [1_000, 2_000, 4_000] as const;
/** Bölüm geçişi / oturum sonunda `requestData()` sonrası en çok bekleme (K-P28e-17). */
export const REC_REQUEST_DATA_WAIT_MS = 500;
/** Oynatıcının önden tamponladığı en çok süre. */
export const REC_VIEW_PREBUFFER_MS = 30_000;
/** Kayıt saklama süresi (gün; DB CHECK 1..90, varsayılan 30). */
export const REC_RETENTION_MIN = 1;
export const REC_RETENTION_MAX = 90;
export const REC_RETENTION_DEFAULT = 30;
/** Kaydedici biçimi ve yükleme/oynatma içerik türü. */
export const REC_MIME_TYPE = "video/webm;codecs=vp8";
export const REC_PART_CONTENT_TYPE = "video/webm";
/** Kayıt açıkken misafir sekme başlığı öneki (S-P28e-12). */
export const REC_TITLE_PREFIX = "● Kayıt — ";

/** Yükleme / izleme belirteci: 32 bayt base64url (dolgusuz) = 43 karakter (P28b `newSecretToken`). */
export const REC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Kayıt kimliği (`rid` = `session_recordings.id`, ULID). */
export const REC_RID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** SHA-256 küçük hex (`session_consents.line_sha256` CHECK ile aynı). */
export const REC_SHA256_PATTERN = /^[0-9a-f]{64}$/;

// --- Sözlükler (tel üstünde küçük harf; DB eşi `recToDb`) ---
/** Kaydın dayanağı (`session_recordings.basis`). */
export const REC_BASES = ["consent", "tenant_policy"] as const;
export type RecBasis = (typeof REC_BASES)[number];
/** Kayıt durumu (`session_recordings.state`). REST'te `deleted` görünmez (404). */
export const REC_STATES = ["active", "stopped", "deleted"] as const;
export type RecState = (typeof REC_STATES)[number];
/** Durma nedeni (`stop_reason`, audit `recording.stop.reason`; V-PE-1 `policy_off`). */
export const REC_STOP_REASONS = ["revoked", "quota", "session_end", "error", "policy_off"] as const;
export type RecStopReason = (typeof REC_STOP_REASONS)[number];
/** Silinme nedeni (`delete_reason`, geçmiş `deleteReason`; K-P28e-18 `missing`). */
export const REC_DELETE_REASONS = ["expired", "manual", "missing"] as const;
export type RecDeleteReason = (typeof REC_DELETE_REASONS)[number];
/** `rec.state.reason`: durma nedenleri + `unavailable` (tenant ayarı kapalıyken gelen `rec.consent`). */
export const REC_STATE_REASONS = [...REC_STOP_REASONS, "unavailable"] as const;
export type RecStateReason = (typeof REC_STATE_REASONS)[number];
/** `rec.error.code` (yalnız kaydedici konsoldan). */
export const REC_ERROR_CODES = ["unsupported", "recorder_failed", "upload_failed"] as const;
export type RecErrorCode = (typeof REC_ERROR_CODES)[number];
/**
 * Audit `recording.stop{reason:"error", code}` kodları: konsolun `rec.error` kodları + sunucunun ürettikleri — `no_upload`
 * (gözcü / kaydedici 120 sn dönmedi), `rate` (oran tavanı), `invalid` (WebM başlık / `p>0` içerik / süre denetimi), `orphan`
 * (açılış süpürmesi: çökme sonrası odasız `ACTIVE`).
 */
export const REC_STOP_ERROR_CODES = [...REC_ERROR_CODES, "no_upload", "rate", "invalid", "orphan"] as const;
export type RecStopErrorCode = (typeof REC_STOP_ERROR_CODES)[number];
/** Audit `recording.start` result=fail `reason` (V-PE-2). */
export const REC_START_FAIL_REASONS = ["quota", "device_outdated", "unsupported", "consent_rejected"] as const;
export type RecStartFailReason = (typeof REC_START_FAIL_REASONS)[number];
/** `consent_rejected` alt kodu (S-P28e-10): SHA uyuşmazlığı / 30 sn penceresi aşıldı. */
export const REC_CONSENT_REJECT_CODES = ["sha", "window"] as const;
export type RecConsentRejectCode = (typeof REC_CONSENT_REJECT_CODES)[number];
/** Audit `recording.view.end.endReason` (S-P28e-3). */
export const REC_VIEW_END_REASONS = ["idle", "max", "replaced", "logout", "revoked"] as const;
export type RecViewEndReason = (typeof REC_VIEW_END_REASONS)[number];

/** Tel değeri → DB CHECK değeri (`consent` → `CONSENT`). */
export const recToDb = <T extends string>(v: T): Uppercase<T> => v.toUpperCase() as Uppercase<T>;
/** DB CHECK değeri → tel değeri (`SESSION_END` → `session_end`). */
export const recFromDb = <T extends string>(v: T): Lowercase<T> => v.toLowerCase() as Lowercase<T>;

// --- Mesajlar ---
const id = z.string().max(26).optional();
const rid = z.string().regex(REC_RID_PATTERN);

// İstemci → sunucu (`/ws/guest`, yalnız `rec1` sokette; §6.2)
/** Müşteri rızası: admit sonrası ilk `hello`'yu alan `rec1` soketi, kutu işaretliyse bir kez gönderir (K-P28e-3). */
export const recConsentSchema = z.strictObject({
  t: z.literal("rec.consent"),
  id,
  lineSha256: z.string().regex(REC_SHA256_PATTERN),
});
/** "Kaydı durdur" (geri alınamaz). Yeniden bağlanan misafirin `hello` sonrası ilk mesajı olarak da gelir (S-P28e-2). */
export const recRevokeSchema = z.strictObject({ t: z.literal("rec.revoke"), id });
export const guestRecInbound = [recConsentSchema, recRevokeSchema] as const;

// Teknisyen → sunucu (`/ws/tech`; sunucu yalnız `recorderOf(room)` soketinden işler, diğerini yok sayar)
export const recErrorSchema = z.strictObject({ t: z.literal("rec.error"), id, code: z.enum(REC_ERROR_CODES) });
export const techRecInbound = [recErrorSchema] as const;

// Sunucu → istemci
/** Yalnız kaydedici teknisyen soketine: PUT belirteci + bölüm başlangıcı. */
export const recUploadSchema = z.strictObject({
  token: z.string().regex(REC_TOKEN_PATTERN),
  series: z.number().int().min(0).max(REC_SERIES_MAX),
  nextPart: z.number().int().min(0).max(REC_SERIES_MAX_PART),
});
export type RecUpload = z.infer<typeof recUploadSchema>;

type RecStateShape = {
  on: boolean;
  reason?: RecStateReason | undefined;
  rid?: string | undefined;
  basis?: RecBasis | undefined;
  upload?: RecUpload | undefined;
};
/** Ortak kural: açıkken neden yok; `upload` yalnız açıkken ve `rid` ile. */
const recStateBase = (m: RecStateShape): boolean =>
  (!m.on || m.reason === undefined) && (m.upload === undefined || (m.on && m.rid !== undefined));
/** Teknisyen kuralı: açıkken `rid` ve `basis` zorunlu (gösterge dayanağı). */
const recStateTech = (m: RecStateShape): boolean => recStateBase(m) && (!m.on || (m.rid !== undefined && m.basis !== undefined));
const RULE_BASE = { message: "on:true iken reason yasak; upload yalnız on:true ve rid ile", path: ["on"] };
const RULE_TECH = { message: "Teknisyene on:true iken rid ve basis zorunlu", path: ["rid"] };

const recStateFields = {
  on: z.boolean(),
  reason: z.enum(REC_STATE_REASONS).optional(),
  rid: rid.optional(),
  basis: z.enum(REC_BASES).optional(),
  upload: recUploadSchema.optional(),
};
const recGuestFields = { on: z.boolean(), reason: z.enum(REC_STATE_REASONS).optional() };

/**
 * `serverOutboundSchema` birliğindeki `rec.state` (iki yön için üst küme; tek `t` tek şema). Rol başına kesin biçim
 * `recStateGuestSchema` / `recStateTechSchema` — sunucu misafire YALNIZ misafir biçimini gönderir (Go katı ayrıştırıcı
 * `rid`/`basis`/`upload`'ı reddeder).
 */
export const recStateSchema = z.strictObject({ t: z.literal("rec.state"), ...recStateFields }).refine(recStateBase, RULE_BASE);
/** S → misafir (`rec1`): gösterge ve "Kaydı durdur" yalnız buna göre çizilir. */
export const recStateGuestSchema = z.strictObject({ t: z.literal("rec.state"), ...recGuestFields }).refine(recStateBase, RULE_BASE);
/** S → tüm teknisyen soketleri; `upload` yalnız kaydediciye. */
export const recStateTechSchema = z.strictObject({ t: z.literal("rec.state"), ...recStateFields }).refine(recStateTech, RULE_TECH);
export type RecStateMessage = z.infer<typeof recStateSchema>;
export type RecStateGuestMessage = z.infer<typeof recStateGuestSchema>;
export type RecStateTechMessage = z.infer<typeof recStateTechSchema>;
export const serverRecOutbound = [recStateSchema] as const;

/** `hello.rec` (yeniden bağlanma): `rec.state` gövdesi (`t` yok). Teknisyende yeni belirteç + `series = son + 1`. */
export const recHelloSchema = z.strictObject(recStateFields).refine(recStateBase, RULE_BASE);
export const recHelloGuestSchema = z.strictObject(recGuestFields).refine(recStateBase, RULE_BASE);
export const recHelloTechSchema = z.strictObject(recStateFields).refine(recStateTech, RULE_TECH);
export type RecHello = z.infer<typeof recHelloSchema>;

/** S → cihaz (`record1`): kayıt ortada durursa gösterge eki kalkar. Cihaz yanıt göndermez. */
export const deviceRecStateSchema = z.strictObject({ t: z.literal("rec.state"), on: z.boolean() });
