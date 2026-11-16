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
  /**
   * P14a (AC-215, ADR-0022): hassas işlem son 5 dk içinde step-up ister (`POST /auth/step-up`). Oturum geçerli;
   * istemci kodu sorar ve isteği bir kez tekrarlar. TOTP'si kurulu olmayan kullanıcıya 403 `MFA_SETUP_REQUIRED`.
   */
  MFA_STEP_UP_REQUIRED: 401,
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
  /** P14a (AC-206, ADR-0023): `If-Match` sürümü güncel değil — kayıt başkası tarafından değiştirildi; yeniden yükleyin. */
  STALE_WRITE: 409,
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
  /** P28c (§4.1): davet süresi doldu / geri çekildi / yanıtlandı / oturum bitti — tek gövde. */
  INVITE_GONE: 410,
  /** joinNonce süresi dolmuş/kullanılmış (P3). */
  NONCE_INVALID: 410,
  /** P10 (AC-66): şifre sıfırlama bağlantısı geçersiz, kullanılmış veya süresi dolmuş (tek yanıt). */
  RESET_TOKEN_INVALID: 410,
  /** P19 (AC-259, S-P19-1): web form token'ı bozuk/süresi dolmuş/kullanılmış/önceki süreç/küme dolu — web yeni token alır. */
  FORM_TOKEN_INVALID: 400,
  /** P19 (AC-260): SMS/WA kanalı kullanılamıyor (anahtar/adres yok, güvensiz ya da okunamıyor). */
  CHANNEL_UNAVAILABLE: 409,
  /** P8b: firma dosyası ref'i geçersiz/yenilenmiş/pasif tenant/ayarı yok — tek gövde (AC-131, 132, 145). */
  REQUEST_REF_INVALID: 404,
  /** P8b: bu istemci örneğinin zaten bekleyen talebi var (AC-143). */
  REQUEST_PENDING: 409,
  /** P8b: talep başka teknisyen tarafından kabul edildi (AC-153). */
  REQUEST_TAKEN: 409,
  /** P8b: talep iptal/süre dolumu/ret/bağlanamadı ile kapanmış (AC-153). */
  REQUEST_CLOSED: 409,
  /** P15 düzeltme 2 (S15-6): firmada kabul kodu açık, talep istemcisi < ACCEPT_CODE_MIN_CLIENT_VERSION; talep PENDING kalır. */
  ACCEPT_CODE_CLIENT_UNSUPPORTED: 409,
  /**
   * P18 (AC-258, K-P18-7): firma mesai dışında ve `afterHoursMode = REJECT`; `fields.nextOpeningAt` (ISO; açık an yoksa
   * yok). `clientVersion < CHAT_MIN_CLIENT_VERSION` istemciye aynı mesaj 429 `QUEUE_FULL` olarak döner.
   */
  OUTSIDE_HOURS: 409,
  /** P18 (AC-255, H3): müşteri soketi bağlı ve mesajlaşmayı desteklemiyor. */
  CHAT_UNSUPPORTED: 409,
  /** P8c: bilgisayar kaydı geçersiz (yok/unutulmuş/değiştirilmiş/müşteri yenilendi-pasif/Genel yenilendi/tenant pasif/süresi doldu) — tek gövde (AC-185). */
  BINDING_INVALID: 404,
  /** P20 (AC-254, protokol §6.1): bilgisayar 5 firmaya kayıtlı; yalnız WS `error` kodu (HTTP ucunda üretilmez). */
  BINDING_LIMIT: 409,
  /** P27 (AC-297, §4.5): gözetimsiz erişim kapalı (`UNATTENDED_MODE=off`) ya da imza kapısı reddetti. */
  UNATTENDED_DISABLED: 409,
  /** P27 (§4.3 adım 8): cihaz `/ws/device`'a bağlı değil. */
  DEVICE_OFFLINE: 409,
  /** P27 (AC-338, K-P27-7): cihazda etkin/bekleyen gözetimsiz oturum var. */
  DEVICE_BUSY: 409,
  /** P27 (AC-295): cihazda yerel anahtar kapalı (son beyan). */
  DEVICE_LOCAL_DISABLED: 409,
  /** P27 (AC-296): müşteride bildirim adresi yok — bağlantı ve kayıt kodu açılmaz. */
  NOTIFY_CONTACT_REQUIRED: 409,
  /** P27 (AC-336, Y-P27-1): tenant SMTP kaydı yok — bağlantı ve kayıt kodu açılmaz. */
  NOTIFY_CHANNEL_UNAVAILABLE: 409,
  /**
   * P28b (AC-362, mimari-p28b §4): firma depolama kotası dolu ya da disk boş alanı %10'un altında — "Firma depolama kotası
   * doldu" (`api/fsrv.ts` `STORAGE_QUOTA_MESSAGE`). Parça yüklemede (disk) ve ileride kayıt (P28e) uçlarında.
   */
  STORAGE_QUOTA: 409,
  /**
   * P28b (AC-354): Dosyalar ayarı açılırken son ClamAV testi başarılı değil — `fields.fileServerMode` "Önce virüs tarama
   * bağlantısını başarıyla test edin" (`AV_NOT_READY_MESSAGE`).
   */
  AV_NOT_READY: 409,
  /** P28u (AC-435, §6.1): cihaz soketi `rs.cap.consent1` bildirmedi (servis < 0.15.0) — bağlantı/müdahale açılmaz. */
  DEVICE_OUTDATED: 409,
  /** P28u (AC-437, §5.1 adım 2b): firma politikası izin istemeden bağlanmaya kapalı (connect TX içinde yeniden denetlenir). */
  SILENT_DISABLED: 409,
  /** P28u (§5.3): bu odada yanıtı beklenen müdahale komutu var. */
  INTERVENE_PENDING: 409,
  /** P28c (AC-365, mimari-p28c §4): oturumda sahip dahil 3 teknisyen koltuğu dolu (bekleyen davet koltuk tutar). */
  SESSION_FULL: 409,
  /**
   * P28c (AC-372, D-PC-1): misafir soketi `rs.cap.multi1` bildirmedi — davet/İzle açılmaz (AC-352 metni). P15
   * `ACCEPT_CODE_CLIENT_UNSUPPORTED` yeniden kullanılmaz (ayrı anlam).
   */
  CLIENT_UNSUPPORTED: 409,
  /** P28c (§4.1, O-PC-5): gözetimsiz `asked` odaya ek teknisyen katılamaz (§4.3 adım 6a). */
  JOIN_NOT_ALLOWED: 409,
  /** P27 (AC-273): kayıt kodu yok/kullanılmış/süresi dolmuş — tek gövde (oracle yok). */
  REGISTRATION_CODE_INVALID: 404,
  /** P12 (AC-84): yükleme 2 MB'ı aşıyor. */
  PAYLOAD_TOO_LARGE: 413,
  ACCOUNT_LOCKED: 423,
  /**
   * P16 (AC-242, ADR-0030): firma kalıcı silmeye uygun değil — `fields.eligibleAt` (ISO; pasiflik 30 günü dolmadı) ya da
   * `fields.reason` (`TENANT_PURGE_NOT_ELIGIBLE_REASONS`).
   */
  PURGE_NOT_ELIGIBLE: 409,
  /** P16 (AC-242, S16-6): `previewId` yok, süresi geçmiş, başka oturuma/duruma ait ya da kullanılmış → önizleme yeniden alınmalı. */
  PREVIEW_REQUIRED: 428,
  /** P14a (AC-206): `PATCH /users/:id` `If-Match: "v<n>"` başlığı olmadan (ya da bozuk biçimde) geldi. */
  PRECONDITION_REQUIRED: 428,
  /** P8b r2 (§13.4): AGENT sürümü MIN_AGENT_VERSION'dan düşük; `fields.minVersion`. */
  CLIENT_OUTDATED: 426,
  RATE_LIMITED: 429,
  /** P8b: tenant'ta 50 bekleyen talep ya da ≥ 40 iken bilinmeyen kaynak (AC-143, §13.6). */
  QUEUE_FULL: 429,
  INTERNAL: 500,
  /** Dış servis (WhatsApp, P10: SMTP) yapılandırılmamış/güvensiz ya da ulaşılamadı (P8b AC-152, P10 AC-10/80/151). */
  UPSTREAM: 502,
  /** P28u (§5.3): cihaz komutu uygulamadı/yanıtlamadı — `fields.reason` ∈ `INTERVENE_FAIL_REASONS` (ws-device). */
  INTERVENE_FAILED: 502,
  /** /ready: DB'ye ulaşılamıyor veya migration uygulanmamış. */
  NOT_READY: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; requestId: string };
}
