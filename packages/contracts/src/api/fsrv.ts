// P28b sunucu üzerinden dosya aktarımı REST sözleşmesi (mimari-p28b §4 r2; AC-354, 356, 358..363). Bayt uçları çerez OKUMAZ:
// kimlik yalnız `Authorization: Bearer <belirteç>` (URL'de asla — Caddy yol loglar). Belirteç yok / süresi dolmuş / fid uyuşmaz
// → tek tip 404 (IP başına `FSRV_NOTFOUND_PER_MIN_IP`/dk, aşım 429). WS mesajları ve sabitler `ws-fsrv.ts`'te.
import { z } from "zod";
import {
  FSRV_FID_PATTERN,
  FSRV_MAX_CHUNKS,
  FSRV_TOKEN_PATTERN,
  type AvScanReason,
  type FsrvDirection,
  type FsrvPurpose,
  type StoredFileState,
} from "../ws-fsrv.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const fid = z.string().regex(FSRV_FID_PATTERN, "Geçersiz kimlik");

// ---------------------------------------------------------------------------------------------------------------
// PUT /api/v1/fsrv/uploads/:fid/chunks/:n — `application/octet-stream`, gövde = `n`. parça (0'dan); `bodyLimit` 1 MiB + 1.
// Belirteç denetimi `onRequest`'te, gövde okunmadan (D-P28b-2).
// ---------------------------------------------------------------------------------------------------------------

/** Yol parametreleri: `n` ondalık, baştaki sıfırsız, 0..255. Biçim dışı → 404 (belirteç/fid uyuşmazlığıyla aynı gövde). */
export const fsrvChunkParamsSchema = z.strictObject({
  fid,
  n: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,2})$/, "Geçersiz parça")
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .max(FSRV_MAX_CHUNKS - 1),
    ),
});
export type FsrvChunkParams = z.output<typeof fsrvChunkParamsSchema>;

/** `Authorization` başlığı: `Bearer ` + 43 karakter base64url (yükleme ve indirme belirteci aynı biçim). */
export const fsrvBearerSchema = z
  .string()
  .regex(new RegExp(`^Bearer ${FSRV_TOKEN_PATTERN.source.slice(1, -1)}$`))
  .transform((v) => v.slice("Bearer ".length));

/** 200: parça yazıldı (ya da `n < next` → idempotent, yazılmadı). `next` = beklenen sonraki parça, `received` = alınan bayt. */
export interface FsrvChunkResponse {
  next: number;
  received: number;
}
/** 202: son parça alındı, SHA-256 + boyut doğrulandı; tarama başladı (sonuç WS `fsrv.status` ile). */
export interface FsrvUploadCompleteResponse {
  state: "SCANNING";
}
/** 409 (`n > next`): gövde hata zarfı DEĞİL, istemci `next`'ten devam eder (Go/web aynı). Disk %10 → 409 `STORAGE_QUOTA` zarfı. */
export interface FsrvChunkGapResponse {
  next: number;
}

// ---------------------------------------------------------------------------------------------------------------
// GET /api/v1/fsrv/files/:fid/content — Bearer indirme belirteci (≤ 5 dk; fid + tenant + oturum (+ HISTORY: authSessionId)).
// 200 akış; her istek `file.download` audit. `state ≠ CLEAN` → 404.
// ---------------------------------------------------------------------------------------------------------------

export const fsrvContentParamsSchema = z.strictObject({ fid });

/** İçerik yanıtının sabit güvenlik başlıkları (D-P28b-5); `Content-Disposition` ve `Content-Length` dosyaya göre eklenir. */
export const FSRV_CONTENT_HEADERS = {
  "Content-Type": "application/octet-stream",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// POST /api/v1/sessions/:id/stored-files/:fid/link — çerez + Origin + CSRF; `session_history.view` + `file_transfer.use`;
// `historyScope`. Saklanan dosya değil (FILE + CLEAN + teslim edilmiş) / kapsam dışı → 404; 20/dk/kullanıcı → 429.
// ---------------------------------------------------------------------------------------------------------------

export const storedFileLinkParamsSchema = z.strictObject({ id: z.string().regex(ULID, "Geçersiz kimlik"), fid });
/** Gövde `{}` veya boş. */
export const storedFileLinkInputSchema = z.strictObject({});

/** Belirteç çağıranın `authSessionId`'sine bağlı; 5 dk içinde tekrar kullanılabilir (kopan indirme), çıkışta düşer. */
export interface StoredFileLinkResponse {
  fid: string;
  token: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------------------------------------------
// GET /api/v1/sessions/:id (P8 detay) eki: `storedFiles`
// ---------------------------------------------------------------------------------------------------------------

/**
 * Oturumun sunucu dosyaları (yükleme sırasıyla). `name`: `PRINT` satırında `belge.pdf`. `canDownload` = saklanan dosya
 * (`FILE` + `CLEAN` + teslim edilmiş, §3.2) **ve** çağıranda `session_history.view` + `file_transfer.use`.
 */
export interface StoredFileItem {
  id: string;
  direction: FsrvDirection;
  purpose: FsrvPurpose;
  name: string;
  sizeBytes: number;
  state: StoredFileState;
  /** Yalnız `SCAN_FAILED`. */
  scanReason?: AvScanReason;
  /** Yalnız `INFECTED` (biçim dışı imza yazılmaz → yok). */
  signature?: string;
  /** Teslim edilmiş `FILE` + `CLEAN`: saklamanın bittiği an (ISO). */
  expiresAt?: string;
  canDownload: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Kota (AC-362) ve tenant Dosyalar ayarı (AC-354) — alanlar `api/tenants.ts` şemalarında; burada ortak tip ve metinler.
// ---------------------------------------------------------------------------------------------------------------

/** `storageUsage(tenantId)` (UPLOADING + SCANNING + CLEAN beyan toplamı; P28e kayıt toplamı eklenir) ve kota (bayt). */
export interface TenantStorageUsage {
  usedBytes: number;
  quotaBytes: number;
}

/** 409 `STORAGE_QUOTA` ve `fsrv.status{REJECTED, QUOTA}` metni (AC-362). */
export const STORAGE_QUOTA_MESSAGE = "Firma depolama kotası doldu";
/** 409 `AV_NOT_READY` (`fields.fileServerMode`) metni (AC-354). */
export const AV_NOT_READY_MESSAGE = "Önce virüs tarama bağlantısını başarıyla test edin";
/** Dosyalar sekmesinde anahtar pasifken gösterilen neden (Admin ClamAV'ı test edemez). */
export const AV_NOT_READY_HINT = "Sistem yöneticisi virüs tarama bağlantısını test etmedi";
/** AC-354 aydınlatma onay kutusu metni ve eksikse 400 `fields.consentUpdated`. */
export const FILE_MODE_CONSENT_LABEL = "Aydınlatma metnimi bu değişikliği kapsayacak şekilde güncelledim";
export const FILE_MODE_CONSENT_REQUIRED_MESSAGE = "Açmadan önce aydınlatma metnini güncellediğinizi onaylayın";
/** AC-363: SERVER modunda konsol + müşteri dosya alanının bilgi satırı (Go `messages_p28.go` aynı metin). */
export const FSRV_SERVER_MODE_NOTICE = "Dosyalar sunucuda virüs taramasından geçer; bu modda uçtan uca şifreli değildir";
/** K-P28b-7: gözetimsiz SERVER odasında dosya alanı metni. */
export const FSRV_UNATTENDED_NOTICE = "Bu firmada dosyalar sunucuda taranır; gözetimsiz oturumda dosya aktarımı kapalı";
