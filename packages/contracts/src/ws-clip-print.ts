// P28a pano + uzaktan yazdırma WS sözleşmesi (mimari-p28 §4.2–4.3, §8.3, §14 r2; AC-343..352). İçerik (pano metni, PDF
// baytları, dosya adı, hash) WS'den GEÇMEZ; yalnız kimlik + bayt sayısı + sonuç. Şemalar `z.strictObject` (ekstra alan → 1008).
// Birlik bağlantısı `ws.ts`'tedir (teknisyen/sunucu birlikleri + misafir şeması soketin bildirdiği özelliğe göre seçilir,
// S-P18-T1 kalıbı). Bu dosya `ws.ts`'i içe aktarmaz (import döngüsü yok, PT-K1). Go eşi `internal/signal`; ortak örnekler
// `fixtures/clip-print.json` (valid.* geçer, invalid.* reddedilir).
import { z } from "zod";

// --- Özellik bildirimi (§4.2) ---
/** `/ws/guest` alt protokol belirteçleri (Windows istemci gönderir; tarayıcı ve P27 yardımcısı göndermez). Kimlik değildir. */
export const WS_GUEST_CAP_CLIP = "rs.cap.clip1";
export const WS_GUEST_CAP_PRINT = "rs.cap.print1";
/** Misafirin bildirdiği özellikler (sunucu gözetimsiz odada belirteçleri okumaz → boş küme, O-P28a-4). */
export const GUEST_FEATURES = ["clipboard", "print"] as const;
export type GuestFeature = (typeof GUEST_FEATURES)[number];
/** Belirteç → özellik (sunucu `ws-auth.ts` bilinmeyen belirteci yok sayar). */
export const GUEST_FEATURE_BY_SUBPROTOCOL: Readonly<Record<string, GuestFeature>> = {
  [WS_GUEST_CAP_CLIP]: "clipboard",
  [WS_GUEST_CAP_PRINT]: "print",
};

// --- Sınırlar (§8.3; Go eşi aynı değerler, fikstür `constants`) ---
/** AC-345: düz metin üst sınırı (UTF-8 bayt). */
export const CLIP_MAX_BYTES = 65_536;
/** DC `clip.data` parça boyutu (ham bayt) → en çok 8 parça (`seq` 0..7). */
export const CLIP_CHUNK_BYTES = 8_192;
export const CLIP_MAX_CHUNKS = CLIP_MAX_BYTES / CLIP_CHUNK_BYTES;
/** Oda başına kayan 60 sn'de en çok pano isteği (`clip.push` + `clip.pull`). */
export const CLIP_PER_MIN = 30;
/** Sunucu: `clip.report` beklemesi; aşımda `TIMEOUT` üretir. */
export const CLIP_PENDING_TIMEOUT_MS = 10_000;
/** r2 O-P28a-5 (AC-347): oda başına dakikada en çok `clip.consent` değişimi. */
export const CLIP_CONSENT_PER_MIN = 6;
/** r2 O-P28a-1: misafir pano kimliği son tarihi (sunucununkinden kısa). */
export const CLIP_GUEST_DEADLINE_MS = 8_000;
/** AC-348: PDF üst sınırı (bayt) ve en küçük boyut (`%PDF-` öneki). */
export const PRINT_MAX_BYTES = 20 * 1024 * 1024;
export const PRINT_MIN_BYTES = 5;
export const PDF_MAGIC = "%PDF-";
/** AC-349: müşteri onay diyaloğu yanıtsızlık süresi. */
export const PRINT_CONSENT_TIMEOUT_MS = 60_000;
/** Sunucu: `print.report` beklemesi; aşımda `ABANDONED` üretir. */
export const PRINT_PENDING_TIMEOUT_MS = 600_000;
/** Oturum başına iletilen en çok yazdırma isteği. */
export const PRINT_PER_SESSION = 20;
/** Müşteri reddi / yanıtsızlık sonrası bekleme (G-03 kalıbı). */
export const PRINT_DENY_COOLDOWN_MS = 30_000;
/** r2 O-P28a-1: misafir yazdırma aktarım + inceleme son tarihi (diyalog 60 sn ayrı; toplam < 10 dk). */
export const PRINT_GUEST_TRANSFER_DEADLINE_MS = 480_000;
/** r2 O-P28a-1 m.3: oda / misafir başına tutulan son kimlik sayısı (yeniden kullanım → VALIDATION / DENIED). */
export const ID_REUSE_WINDOW = 64;
/** r2 O-P28a-3 (Go işleyici): sayfa başına render piksel üst sınırı ve boru çerçevesi üst sınırı. */
export const PRINT_RENDER_MAX_PX = 40_000_000;
export const PRINT_PIPE_FRAME_MAX = 64 * 1024 * 1024;
/** AC-349: sayfa sayısı aralığı. */
export const PRINT_MAX_PAGES = 100_000;

/** `cid`/`pid`: konsol üretir (16 bayt rastgele base64url = 22 karakter); sunucu ve misafir aynı ifadeyle doğrular. */
export const CLIP_PRINT_ID_PATTERN = /^[A-Za-z0-9_-]{8,26}$/;

// --- Sonuç kümeleri (§4.3; audit `new_value.result`, metrik etiketi) ---
export const CLIP_DIRECTIONS = ["TO_CUSTOMER", "TO_TECH"] as const;
export type ClipDirection = (typeof CLIP_DIRECTIONS)[number];
export const CLIP_RESULTS = ["OK", "EMPTY", "TOO_LARGE", "SENSITIVE", "INVALID", "DENIED", "ERROR", "TIMEOUT", "DISCONNECTED"] as const;
export type ClipResult = (typeof CLIP_RESULTS)[number];
/**
 * Misafirin raporlayabildiği pano sonuçları. `DISCONNECTED` yalnız sunucu üretir. `TIMEOUT`: r2 O-P28a-1 m.1 misafirin 8 sn
 * son tarihinde `report{TIMEOUT}` göndermesini gerektirir (§4.3'teki "son ikisi yalnız sunucu" notunu r2 daraltır).
 */
export const CLIP_GUEST_RESULTS = ["OK", "EMPTY", "TOO_LARGE", "SENSITIVE", "INVALID", "DENIED", "ERROR", "TIMEOUT"] as const;
export const PRINT_DECISIONS = ["APPROVED", "REJECTED", "TIMEOUT", "NONE"] as const;
export type PrintDecision = (typeof PRINT_DECISIONS)[number];
export const PRINT_RESULTS = [
  "PRINTED",
  "NO_PRINTER",
  "REJECTED",
  "TIMEOUT",
  "INVALID_PDF",
  "TOO_LARGE",
  "BUSY",
  "CANCELLED",
  "ERROR",
  "ABANDONED",
  "DISCONNECTED",
] as const;
export type PrintResult = (typeof PRINT_RESULTS)[number];
/** Misafirin raporlayabildiği yazdırma sonuçları (`ABANDONED`, `DISCONNECTED` yalnız sunucu). */
export const PRINT_GUEST_RESULTS = [
  "PRINTED",
  "NO_PRINTER",
  "REJECTED",
  "TIMEOUT",
  "INVALID_PDF",
  "TOO_LARGE",
  "BUSY",
  "CANCELLED",
  "ERROR",
] as const;
/** Audit `clipboard.consent.reason` (sunucu kapattığında; müşteri değişiminde yok). */
export const CLIP_CONSENT_REASONS = ["control_closed", "permission", "disconnect", "session_ended"] as const;
export type ClipConsentReason = (typeof CLIP_CONSENT_REASONS)[number];

const id = z.string().max(26).optional();
const cpId = z.string().regex(CLIP_PRINT_ID_PATTERN);
const clipBytes = z.number().int().min(0).max(CLIP_MAX_BYTES);
const printSize = z.number().int().min(PRINT_MIN_BYTES).max(PRINT_MAX_BYTES);
const pages = z.number().int().min(1).max(PRINT_MAX_PAGES);

// --- Teknisyen → sunucu (sunucu kapıdan geçirip alanları yeniden kurarak misafire iletir) ---
export const clipPushSchema = z.strictObject({
  t: z.literal("clip.push"),
  id,
  cid: cpId,
  bytes: z.number().int().min(1).max(CLIP_MAX_BYTES),
});
export const clipPullSchema = z.strictObject({ t: z.literal("clip.pull"), id, cid: cpId });
export const printRequestSchema = z.strictObject({ t: z.literal("print.request"), id, pid: cpId, sizeBytes: printSize });
export const printCancelSchema = z.strictObject({ t: z.literal("print.cancel"), id, pid: cpId });
/** `ws.ts` `techInboundSchema` birliğine eklenen üyeler. */
export const techClipPrintInbound = [clipPushSchema, clipPullSchema, printRequestSchema, printCancelSchema] as const;

// --- Misafir → sunucu (yalnız ilgili özelliği bildiren sokette şemadadır; aksi 1008) ---
/** Müşteri anahtarı. `on:true` yalnız kontrol GRANTED iken kabul (sunucu); değişim ≤ 6/dk/oda. */
export const clipConsentSchema = z.strictObject({ t: z.literal("clip.consent"), id, on: z.boolean() });
export const clipReportSchema = z.strictObject({
  t: z.literal("clip.report"),
  id,
  cid: cpId,
  dir: z.enum(CLIP_DIRECTIONS),
  bytes: clipBytes,
  result: z.enum(CLIP_GUEST_RESULTS),
});
/** AC-351: dosya adı ve hash yok. */
export const printReportSchema = z.strictObject({
  t: z.literal("print.report"),
  id,
  pid: cpId,
  decision: z.enum(PRINT_DECISIONS),
  result: z.enum(PRINT_GUEST_RESULTS),
  pages: pages.optional(),
  sizeBytes: z.number().int().min(0).max(PRINT_MAX_BYTES),
});
/** `ws.ts` `guestInboundSchemaFor` için özellik başına misafir mesajları. */
export const guestClipInbound = [clipConsentSchema, clipReportSchema] as const;
export const guestPrintInbound = [printReportSchema] as const;

// --- Sunucu → istemci (`ws.ts` `serverOutboundSchema` birliğine eklenir) ---
export const serverClipPrintOutbound = [
  /** S→tech: müşteri anahtarı değişti; S→guest: yalnız `on:false` (sunucu kapattı — istemci yanıt göndermez). */
  z.strictObject({ t: z.literal("clip.consent"), on: z.boolean() }),
  z.strictObject({ t: z.literal("clip.push"), cid: cpId, bytes: z.number().int().min(1).max(CLIP_MAX_BYTES) }),
  z.strictObject({ t: z.literal("clip.pull"), cid: cpId }),
  z.strictObject({ t: z.literal("clip.status"), cid: cpId, result: z.enum(CLIP_RESULTS), bytes: clipBytes }),
  z.strictObject({ t: z.literal("print.request"), pid: cpId, sizeBytes: printSize }),
  z.strictObject({ t: z.literal("print.cancel"), pid: cpId }),
  z.strictObject({ t: z.literal("print.status"), pid: cpId, result: z.enum(PRINT_RESULTS), pages: pages.optional() }),
] as const;
