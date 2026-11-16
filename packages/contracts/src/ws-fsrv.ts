// P28b sunucu üzerinden dosya aktarımı WS sözleşmesi (mimari-p28b §5, §11.3 r2; AC-355..360, 363). Bayt WS'den GEÇMEZ:
// yükleme/indirme HTTPS (`api/fsrv.ts`, Bearer belirteç); WS yalnız kimlik, boyut, SHA-256, durum. Şemalar `z.strictObject`
// (ekstra alan → 1008). Birlik bağlantısı `ws.ts`'tedir: teknisyen birliğinde `fsrv.*` her zaman vardır (P2P odasında sunucu
// `fsrv.status{REJECTED, MODE}` döner); misafir şemasına yalnız SERVER odası + `hasFsrv(peer)` soketinde girer (aksi 1008).
// Bu dosya `ws.ts`'i içe aktarmaz (import döngüsü yok, PT-K1). Go eşi `internal/signal`; ortak örnekler `fixtures/fsrv.json`.
import { z } from "zod";
import { CLIP_PRINT_ID_PATTERN, GUEST_FEATURES, PRINT_MAX_BYTES } from "./ws-clip-print.ts";

// --- Mod ve yetenek (§5.1) ---
/** Oturumun dosya modu (`support_sessions.file_mode`); oturum açılışında bir kez sabitlenir (AC-355). */
export const FILE_MODES = ["P2P", "SERVER"] as const;
export type FileMode = (typeof FILE_MODES)[number];
/** `/ws/guest` alt protokol belirteci (Windows istemci ≥ 0.14.0). Tarayıcı misafiri bildirmez ama yetenekli sayılır (K-P28b-20). */
export const WS_GUEST_CAP_FSRV = "rs.cap.fsrv1";
/** Misafir özelliği (teknisyene giden `guestFeatures` dizisinde). `CAPS`'e girmez: SERVER odası caps'i yalnız daraltır (§5.4). */
export const FSRV_FEATURE = "fsrv";
/**
 * Teknisyene bildirilen misafir özellikleri: P28a `GUEST_FEATURES` + `fsrv`. P28a `GuestFeature` (= `Cap` alt kümesi) bilerek
 * genişletilmedi; sunucu `hasFsrv(peer)` (= belirteç ∋ `rs.cap.fsrv1` veya BROWSER misafir) tek yardımcıdan karar verir.
 */
export const PEER_FEATURES = [...GUEST_FEATURES, FSRV_FEATURE] as const;
export type PeerFeature = (typeof PEER_FEATURES)[number];

// --- Sınırlar (§11.3; Go eşi aynı değerler, fikstür `constants`) ---
/** Yükleme parçası (K-P28b-4); son parça hariç her parça tam bu boyda. */
export const FSRV_CHUNK_BYTES = 1_048_576;
/** Sunucu modu dosya tavanı (K-P28b-12 r2); etkin sınır `min(max_file_mb, 256 MiB)`. DB CHECK ile aynı. */
export const FSRV_MAX_BYTES = 268_435_456;
/** En çok parça sayısı (256 MiB / 1 MiB). */
export const FSRV_MAX_CHUNKS = FSRV_MAX_BYTES / FSRV_CHUNK_BYTES;
/** Oturum başına toplam beyan (tüm durumlar; O-P28b-2) → `SESSION_LIMIT`. */
export const FSRV_SESSION_MAX_BYTES = 2_147_483_648;
/** Yazdırma belgesi tavanı (D-P28b-3) = P28a `PRINT_MAX_BYTES`. */
export const FSRV_PRINT_MAX_BYTES = PRINT_MAX_BYTES;
/** Yazdırma satırının sabit adı (K-P28b-13 r2): gerçek ad WS'den geçmez, DB'ye yazılmaz. */
export const FSRV_PRINT_FILE_NAME = "belge.pdf";
/** İçerik/parça uçlarında IP başına dakikada en çok 404 (aşım → 429; D-P28b-2). */
export const FSRV_NOTFOUND_PER_MIN_IP = 60;
/** Şifreli dosya segmenti (§6). */
export const FSRV_SEGMENT_BYTES = 65_536;
/** İndirme belirteci ömrü (AC-356). */
export const FSRV_DOWNLOAD_TTL_MS = 300_000;
/** Yükleme belirtecinin hareketsizlik sınırı → satır `CANCELLED`. */
export const FSRV_UPLOAD_IDLE_MS = 600_000;
/** Oda başına dakikada en çok `fsrv.init` → `RATE_LIMITED`. */
export const FSRV_INIT_PER_MIN = 20;
/** Aynı fid için en çok indirme belirteci (`fsrv.accept`); üçüncü başarısız indirmeden sonra `CANCELLED`. */
export const FSRV_DOWNLOAD_TOKENS_PER_FILE = 3;
/** Geçmişten indirme bağlantısı: kullanıcı başına dakikada en çok (§4). */
export const FSRV_LINK_PER_MIN = 20;
/** Alıcıya yükleme ilerlemesi en çok saniyede bir. */
export const FSRV_PROGRESS_INTERVAL_MS = 1_000;
/** Büyük dosya eşiği: aynı anda en çok bir tarama bu boyutun üstünde (O-P28b-3). */
export const AV_LARGE_BYTES = 67_108_864;
/** Sistem geneli eşzamanlı tarama yuvası. */
export const AV_CONCURRENCY = 2;
/** Bekleyen tarama toplamı / firma başına (aşan → `SCAN_FAILED/BUSY`). */
export const AV_QUEUE_MAX = 20;
export const AV_TENANT_QUEUE_MAX = 3;
/** Kuyrukta bekleme üst sınırı → `SCAN_FAILED/BUSY`. */
export const AV_QUEUE_WAIT_MS = 30_000;
/** Tarama toplam süresi (yuva alındığı anda başlar; AC-359). */
export const AV_SCAN_TIMEOUT_MS = 60_000;
/** Bağlantı aşaması: tek deneme zaman aşımı, deneme aralığı, toplam (K-P28b-23). */
export const AV_CONNECT_TIMEOUT_MS = 3_000;
export const AV_CONNECT_RETRY_INTERVAL_MS = 2_000;
export const AV_CONNECT_RETRY_MS = 15_000;
/** Öz-sınama yoklama aralığı (§7.3). */
export const AV_SELFTEST_INTERVAL_MS = 600_000;
/** İmza yaşı uyarı eşiği (gün; AC-361). */
export const AV_STALE_DAYS = 3;
/** Disk boş alanı alt sınırı (oran; AC-362). */
export const DISK_MIN_FREE_RATIO = 0.1;
/** Firma kotası (GB) varsayılanı ve aralığı — `tenants.storage_quota_gb` DB CHECK ile aynı. */
export const DEFAULT_STORAGE_QUOTA_GB = 20;
export const STORAGE_QUOTA_GB_MIN = 1;
export const STORAGE_QUOTA_GB_MAX = 2000;
/** Teslim edilen dosyanın saklama süresi (gün) — `tenant_settings.file_retention_days` DB CHECK ile aynı. */
export const FILE_RETENTION_DAYS_MIN = 1;
export const FILE_RETENTION_DAYS_MAX = 7;
export const FILE_RETENTION_DAYS_DEFAULT = 1;

// --- Kimlikler ---
/** `xid`: istemcinin istek kimliği (P28a `cid` kalıbı; son 64 tekrar → VALIDATION). */
export const FSRV_XID_PATTERN = CLIP_PRINT_ID_PATTERN;
/** `fid`: sunucunun ULID'i (`session_stored_files.id`). */
export const FSRV_FID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** Yükleme/indirme belirteci: 32 bayt rastgele, base64url (43). Yalnız `Authorization: Bearer` başlığında; URL'de asla. */
export const FSRV_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

// --- Durum ve neden kümeleri ---
export const FSRV_PURPOSES = ["FILE", "PRINT"] as const;
export type FsrvPurpose = (typeof FSRV_PURPOSES)[number];
export const FSRV_DIRECTIONS = ["TO_CUSTOMER", "TO_TECH"] as const;
export type FsrvDirection = (typeof FSRV_DIRECTIONS)[number];
/** DB/REST satır durumu (`session_stored_files.state`, §3.2; `DELETED` P28b'de yazılmaz — K-P28b-15). */
export const STORED_FILE_STATES = [
  "UPLOADING",
  "SCANNING",
  "CLEAN",
  "INFECTED",
  "SCAN_FAILED",
  "CORRUPT",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "DELETED",
] as const;
export type StoredFileState = (typeof STORED_FILE_STATES)[number];
/** Tel `fsrv.status.state` (§5.2): `DELIVERED` = alıcı `fsrv.result{ok:true}`; `EXPIRED`/`DELETED` tele çıkmaz. */
export const FSRV_WIRE_STATES = [
  "UPLOADING",
  "SCANNING",
  "CLEAN",
  "INFECTED",
  "SCAN_FAILED",
  "CORRUPT",
  "CANCELLED",
  "REJECTED",
  "DELIVERED",
] as const;
export type FsrvWireState = (typeof FSRV_WIRE_STATES)[number];
/** `fsrv.init` kapı sırası (§5.2 adım 1–8) → `fsrv.status{xid, state:"REJECTED", reason}`. */
export const FSRV_GATE_REASONS = [
  "MODE",
  "FORBIDDEN",
  "UNSUPPORTED",
  "BUSY",
  "TOO_LARGE",
  "RATE_LIMITED",
  "SESSION_LIMIT",
  "QUOTA",
] as const;
export type FsrvGateReason = (typeof FSRV_GATE_REASONS)[number];
/** Tarama başarısızlık nedeni (`session_stored_files.scan_reason`, §7.2) → `state:"SCAN_FAILED"`. */
export const AV_SCAN_REASONS = ["UNAVAILABLE", "TIMEOUT", "ENCRYPTED", "LIMIT", "BUSY", "ERROR"] as const;
export type AvScanReason = (typeof AV_SCAN_REASONS)[number];
/** `fsrv.status.reason` tel kümesi (iki kümenin birleşimi; `BUSY` ikisinde de — anlam `state`'e göre). */
export const FSRV_STATUS_REASONS = [
  ...FSRV_GATE_REASONS,
  "UNAVAILABLE",
  "TIMEOUT",
  "ENCRYPTED",
  "LIMIT",
  "ERROR",
] as const satisfies readonly (FsrvGateReason | AvScanReason)[];
export type FsrvStatusReason = (typeof FSRV_STATUS_REASONS)[number];
/** İmza adı (DB CHECK ile aynı); dışındaysa sunucu imzayı göndermez, arayüz "bilinmeyen imza" yazar. */
export const AV_SIGNATURE_PATTERN = /^[A-Za-z0-9._:/-]{1,120}$/;

const id = z.string().max(26).optional();
const xid = z.string().regex(FSRV_XID_PATTERN);
const fid = z.string().regex(FSRV_FID_PATTERN);
const pid = z.string().regex(CLIP_PRINT_ID_PATTERN);
const token = z.string().regex(FSRV_TOKEN_PATTERN);
const sha256 = z.string().regex(SHA256_HEX_PATTERN);
const size = z.number().int().min(1).max(FSRV_MAX_BYTES);
const name = z.string().min(1).max(255);

/**
 * Teklif kuralı (§5.2, §5.3, K-P28b-13): `PRINT` ⇒ `pid` zorunlu ve ad `belge.pdf`; `FILE` ⇒ `pid` yok. Boyut/pid eşleşmesi
 * (`printPending`) ve 20 MiB şemada DEĞİL: kapı adım 2'de `FORBIDDEN` döner (1008 değil).
 */
function printShape(m: { purpose: FsrvPurpose; pid?: string | undefined; name: string }, ctx: z.RefinementCtx): void {
  if (m.purpose === "PRINT") {
    if (m.pid === undefined) ctx.addIssue({ code: "custom", path: ["pid"], message: "PRINT için pid gerekli" });
    if (m.name !== FSRV_PRINT_FILE_NAME) ctx.addIssue({ code: "custom", path: ["name"], message: "PRINT adı belge.pdf olmalı" });
  } else if (m.pid !== undefined) ctx.addIssue({ code: "custom", path: ["pid"], message: "pid yalnız PRINT'te" });
}

// --- İstemci (teknisyen ve misafir) → sunucu ---
/** Yükleme isteği. `name` ham gelir (sunucu `sanitizeFileName`); `size` ≤ 256 MiB mutlak, firma sınırı kapıda (`TOO_LARGE`). */
export const fsrvInitSchema = z
  .strictObject({
    t: z.literal("fsrv.init"),
    id,
    xid,
    name,
    size,
    sha256,
    purpose: z.enum(FSRV_PURPOSES),
    pid: pid.optional(),
  })
  .superRefine(printShape);
/** Yalnız teklifin alıcısından (sunucu denetler) → `fsrv.download`. */
export const fsrvAcceptSchema = z.strictObject({ t: z.literal("fsrv.accept"), id, fid });
/** Alıcı reddi → satır `REJECTED`, disk hemen silinir (O-P28b-2). */
export const fsrvRejectSchema = z.strictObject({ t: z.literal("fsrv.reject"), id, fid });
/** Alıcı SHA-256 doğrulamasından sonra; sunucu `session_files` satırını kendisi yazar. */
export const fsrvResultSchema = z.strictObject({ t: z.literal("fsrv.result"), id, fid, ok: z.boolean() });
/** Gönderen ya da alıcı: yükleme/tarama/teslim edilmemiş teklif → `CANCELLED` + disk silinir. */
export const fsrvCancelSchema = z.strictObject({ t: z.literal("fsrv.cancel"), id, fid });
/** `ws.ts` `techInboundSchema` birliğine her zaman eklenir; misafire yalnız `guestInboundSchemaFor(…, true)`. */
export const fsrvInbound = [fsrvInitSchema, fsrvAcceptSchema, fsrvRejectSchema, fsrvResultSchema, fsrvCancelSchema] as const;

// --- Sunucu → istemci (`ws.ts` `serverOutboundSchema` birliğine eklenir) ---
export const fsrvUploadSchema = z.strictObject({
  t: z.literal("fsrv.upload"),
  xid,
  fid,
  token,
  chunkBytes: z.literal(FSRV_CHUNK_BYTES),
  chunks: z.number().int().min(1).max(FSRV_MAX_CHUNKS),
});
/**
 * Durum (iki tarafa). En az biri: `fid` (satır var) / `xid` (kapı reddi, satır yok). Ek kurallar (Go eşi aynı):
 * `SCAN_FAILED` ⇒ `reason` ∈ `AV_SCAN_REASONS`; `REJECTED` + `reason` ⇒ `FSRV_GATE_REASONS` (alıcı reddinde `reason` yok);
 * diğer durumlarda `reason` yok; `signature` yalnız `INFECTED` (biçim dışı imza gönderilmez).
 */
export const fsrvStatusSchema = z
  .strictObject({
    t: z.literal("fsrv.status"),
    fid: fid.optional(),
    xid: xid.optional(),
    state: z.enum(FSRV_WIRE_STATES),
    reason: z.enum(FSRV_STATUS_REASONS).optional(),
    signature: z.string().regex(AV_SIGNATURE_PATTERN).optional(),
    progress: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.fid === undefined && m.xid === undefined) ctx.addIssue({ code: "custom", path: ["fid"], message: "fid veya xid gerekli" });
    const r = m.reason;
    if (m.state === "SCAN_FAILED") {
      if (r === undefined || !(AV_SCAN_REASONS as readonly string[]).includes(r))
        ctx.addIssue({ code: "custom", path: ["reason"], message: "SCAN_FAILED için tarama nedeni gerekli" });
    } else if (m.state === "REJECTED") {
      if (r !== undefined && !(FSRV_GATE_REASONS as readonly string[]).includes(r))
        ctx.addIssue({ code: "custom", path: ["reason"], message: "Geçersiz ret nedeni" });
    } else if (r !== undefined) ctx.addIssue({ code: "custom", path: ["reason"], message: "Bu durumda neden yok" });
    if (m.signature !== undefined && m.state !== "INFECTED")
      ctx.addIssue({ code: "custom", path: ["signature"], message: "İmza yalnız INFECTED" });
  });
/** `CLEAN` sonrası alıcıya. `FILE` → mevcut kabul diyaloğu; `PRINT` → diyalog yok, Go `pid` + boyutla eşler (aksi `report{ERROR}`). */
export const fsrvOfferSchema = z
  .strictObject({
    t: z.literal("fsrv.offer"),
    fid,
    name,
    size,
    sha256,
    purpose: z.enum(FSRV_PURPOSES),
    pid: pid.optional(),
  })
  .superRefine(printShape);
export const fsrvDownloadSchema = z.strictObject({ t: z.literal("fsrv.download"), fid, token, expiresAt: z.iso.datetime() });
export const serverFsrvOutbound = [fsrvUploadSchema, fsrvStatusSchema, fsrvOfferSchema, fsrvDownloadSchema] as const;

/** Parça sayısı: `ceil(size / 1 MiB)` (1..256). */
export const fsrvChunkCount = (bytes: number): number => Math.ceil(bytes / FSRV_CHUNK_BYTES);
/** `n`. parçanın beklenen boyu (son parça hariç tam 1 MiB); aralık dışı `n` → 0. */
export function fsrvChunkSize(bytes: number, n: number): number {
  const count = fsrvChunkCount(bytes);
  if (!Number.isInteger(n) || n < 0 || n >= count) return 0;
  return n < count - 1 ? FSRV_CHUNK_BYTES : bytes - FSRV_CHUNK_BYTES * (count - 1);
}
