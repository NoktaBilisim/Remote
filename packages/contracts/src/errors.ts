// Standart hata zarfı ve hata kodu → HTTP durum eşlemesi (mimari-api.md "Ortak kurallar").
// Sunucu yalnız bu kodları döndürür; web istemcisi `code` alanına göre davranır.
// Sonraki paketler kendi kodlarını (ör. OPEN_SESSION_LIMIT, SESSION_EXPIRED) buraya ekler.

export const ERROR_STATUS = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  /** CSRF başlığı/çerezi eksik ya da eşleşmiyor veya Origin izinli değil. */
  CSRF_INVALID: 403,
  /** must_change_password: yalnız /auth/me, /auth/logout, /auth/password/change serbest. */
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  /** Durum uygun değil (ör. iptal edilecek oturum PENDING değil). */
  CONFLICT: 409,
  /** Teknisyenin açık (PENDING/ACTIVE) oturum üst sınırı dolu (AC-11). */
  OPEN_SESSION_LIMIT: 409,
  /** Lobide bekleyen misafir sınırı (3) dolu (AC-112). */
  LOBBY_FULL: 409,
  /** Oturum/link/kod süresi dolmuş (AC-5). */
  SESSION_EXPIRED: 410,
  /** Token/kod tüketilmiş — oturum ACTIVE/ENDED (AC-7). */
  SESSION_CONSUMED: 410,
  /** Oturum iptal edilmiş (AC-8). */
  SESSION_CANCELLED: 410,
  /** joinNonce süresi dolmuş/kullanılmış (P3). */
  NONCE_INVALID: 410,
  /** P8b: firma dosyası ref'i geçersiz/yenilenmiş/pasif tenant/ayarı yok — tek gövde (AC-131, 132, 145). */
  REQUEST_REF_INVALID: 404,
  /** P8b: bu istemci örneğinin zaten bekleyen talebi var (AC-143). */
  REQUEST_PENDING: 409,
  /** P8b: talep başka teknisyen tarafından kabul edildi (AC-153). */
  REQUEST_TAKEN: 409,
  /** P8b: talep iptal/süre dolumu/ret/bağlanamadı ile kapanmış (AC-153). */
  REQUEST_CLOSED: 409,
  ACCOUNT_LOCKED: 423,
  /** P8b r2 (§13.4): AGENT sürümü MIN_AGENT_VERSION'dan düşük; `fields.minVersion`. */
  CLIENT_OUTDATED: 426,
  RATE_LIMITED: 429,
  /** P8b: tenant'ta 50 bekleyen talep ya da ≥ 40 iken bilinmeyen kaynak (AC-143, §13.6). */
  QUEUE_FULL: 429,
  INTERNAL: 500,
  /** Dış servis (WhatsApp) yapılandırılmamış/güvensiz ya da ulaşılamadı (P8b, AC-152). */
  UPSTREAM: 502,
  /** /ready: DB'ye ulaşılamıyor veya migration uygulanmamış. */
  NOT_READY: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; requestId: string };
}
