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
  /** Oturum/link/kod süresi dolmuş (AC-5). */
  SESSION_EXPIRED: 410,
  /** Token/kod tüketilmiş — oturum ACTIVE/ENDED (AC-7). */
  SESSION_CONSUMED: 410,
  /** Oturum iptal edilmiş (AC-8). */
  SESSION_CANCELLED: 410,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  /** /ready: DB'ye ulaşılamıyor veya migration uygulanmamış. */
  NOT_READY: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; requestId: string };
}
