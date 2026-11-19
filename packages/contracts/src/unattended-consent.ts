// P28u gözetimsiz bağlantı kip sözlükleri (mimari-p28u §1, §3.2, §6.2, §r3; AC-430, 445, 451). Yaprak modül (import yok):
// `ws.ts`, `ws-device.ts`, `api/sessions.ts`, `api/audit.ts`, `api/unattended.ts` buradan alır — import döngüsü olmaz (PT-K1).
// Üç ayrı sözlük bilinçli olarak birleştirilmez: İSTEK (`ask`, sunucu → cihaz), KİP (`asked|no_user|silent`, DB
// `support_sessions_consent_mode_chk` ile bayt bayt aynı) ve KARAR (`granted|denied|timeout`, eski onay diyaloğu).
// r3 (K-P28u-r3-1, 12): tek yol onaysız; yeni yazım yalnız `no_user`. `asked`/`silent` ve kararlar yalnız eski kayıt okumada.

/**
 * `connect.consent` (§6.2, K-P28u-r3-3): tek değer `ask`. Tarihsel ad — r3'ten itibaren anlamı "gözetimsiz bağlantı isteği;
 * cihaz kullanıcıya sormaz ve `consent.result{no_user}` döner". `silent` kaldırıldı.
 */
export const CONSENT_REQUESTS = ["ask"] as const;
export type ConsentRequest = (typeof CONSENT_REQUESTS)[number];

/**
 * Oturumun gerçekleşen kipi — `support_sessions.consent_mode` (ikili CHECK), audit `consentMode`, geçmiş/audit filtresi.
 * r3: yeni yazım yalnız `no_user`; `asked`/`silent` eski kayıtları okumak için kalır (AC-451).
 */
export const CONSENT_MODES = ["asked", "no_user", "silent"] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];

/** Eski (r3 öncesi) onay diyaloğunun sonucu — yalnız eski `unattended.consent` audit satırlarını okumak için (AC-451). */
export const CONSENT_RESULT_DECISIONS = ["granted", "denied", "timeout"] as const;
export type ConsentResultDecision = (typeof CONSENT_RESULT_DECISIONS)[number];

/** Cihazdaki etkileşimli kullanıcı durumu (§7.2): oturum açık+kilitsiz / kilitli / konsolda kullanıcı yok. DB'ye yazılmaz. */
export const DEVICE_USER_STATES = ["active", "locked", "none"] as const;
export type DeviceUserState = (typeof DEVICE_USER_STATES)[number];
