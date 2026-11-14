// Standart hata zarfı ve hata kodu → HTTP durum eşlemesi (mimari-api.md "Ortak kurallar").
// Sunucu yalnız bu kodları döndürür; web istemcisi `code` alanına göre davranır.
// Sonraki paketler kendi kodlarını (ör. OPEN_SESSION_LIMIT, SESSION_EXPIRED) buraya ekler.

export const ERROR_STATUS = {
  VALIDATION: 400,
  /** P12 (AC-84, T16): resim magic bytes ile PNG/JPEG/WEBP değil, bozuk veya piksel sınırını aşıyor. */
  INVALID_IMAGE: 400,
  /** P10 (G-12, AC-122): SMTP sunucu adresi özel/loopback/link-local/CGNAT/Docker ağına çözümlendi (genel mesaj). */
  HOST_NOT_ALLOWED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  /** CSRF başlığı/çerezi eksik ya da eşleşmiyor veya Origin izinli değil. */
  CSRF_INVALID: 403,
  /** must_change_password: yalnız /auth/me, /auth/logout, /auth/password/change serbest. */
  PASSWORD_CHANGE_REQUIRED: 403,
  /** P10 (AC-67): oturum 2FA doğrulaması bekliyor; yalnız /auth/mfa/verify, /auth/me, /auth/logout serbest. */
  MFA_REQUIRED: 403,
  /** P10 (AC-67): 2FA zorunlu ama kurulmamış; yalnız /auth/mfa/setup|enable, /auth/me, /auth/logout, /auth/password/change serbest. */
  MFA_SETUP_REQUIRED: 403,
  NOT_FOUND: 404,
  /** P11 (AC-76): audit kayıtları salt okunur — `/audit*` için POST/PUT/PATCH/DELETE; yanıtta `Allow` başlığı. */
  METHOD_NOT_ALLOWED: 405,
  /** Durum uygun değil (ör. iptal edilecek oturum PENDING değil). */
  CONFLICT: 409,
  /** Teknisyenin açık (PENDING/ACTIVE) oturum üst sınırı dolu (AC-11). */
  OPEN_SESSION_LIMIT: 409,
  /** Lobide bekleyen misafir sınırı (3) dolu (AC-112). */
  LOBBY_FULL: 409,
  /** P13a (AC-197): oturum saklama süresi dolduğu için anonimleştirildi; kişisel veri (not/ticket) yeniden yazılamaz. */
  SESSION_ANONYMIZED: 409,
  /** Oturum/link/kod süresi dolmuş (AC-5). */
  SESSION_EXPIRED: 410,
  /** Token/kod tüketilmiş — oturum ACTIVE/ENDED (AC-7). */
  SESSION_CONSUMED: 410,
  /** Oturum iptal edilmiş (AC-8). */
  SESSION_CANCELLED: 410,
  /** joinNonce süresi dolmuş/kullanılmış (P3). */
  NONCE_INVALID: 410,
  /** P10 (AC-66): şifre sıfırlama bağlantısı geçersiz, kullanılmış veya süresi dolmuş (tek yanıt). */
  RESET_TOKEN_INVALID: 410,
  /** P8b: firma dosyası ref'i geçersiz/yenilenmiş/pasif tenant/ayarı yok — tek gövde (AC-131, 132, 145). */
  REQUEST_REF_INVALID: 404,
  /** P8b: bu istemci örneğinin zaten bekleyen talebi var (AC-143). */
  REQUEST_PENDING: 409,
  /** P8b: talep başka teknisyen tarafından kabul edildi (AC-153). */
  REQUEST_TAKEN: 409,
  /** P8b: talep iptal/süre dolumu/ret/bağlanamadı ile kapanmış (AC-153). */
  REQUEST_CLOSED: 409,
  /** P8c: bilgisayar kaydı geçersiz (yok/unutulmuş/değiştirilmiş/müşteri yenilendi-pasif/Genel yenilendi/tenant pasif/süresi doldu) — tek gövde (AC-185). */
  BINDING_INVALID: 404,
  /** P12 (AC-84): yükleme 2 MB'ı aşıyor. */
  PAYLOAD_TOO_LARGE: 413,
  ACCOUNT_LOCKED: 423,
  /** P8b r2 (§13.4): AGENT sürümü MIN_AGENT_VERSION'dan düşük; `fields.minVersion`. */
  CLIENT_OUTDATED: 426,
  RATE_LIMITED: 429,
  /** P8b: tenant'ta 50 bekleyen talep ya da ≥ 40 iken bilinmeyen kaynak (AC-143, §13.6). */
  QUEUE_FULL: 429,
  INTERNAL: 500,
  /** Dış servis (WhatsApp, P10: SMTP) yapılandırılmamış/güvensiz ya da ulaşılamadı (P8b AC-152, P10 AC-10/80/151). */
  UPSTREAM: 502,
  /** /ready: DB'ye ulaşılamıyor veya migration uygulanmamış. */
  NOT_READY: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; requestId: string };
}
