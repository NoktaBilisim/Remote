// P28u gözetimsiz bağlantı kip sözlükleri ve onay süreleri (mimari-p28u §1, §3.2, §6.2; AC-430, 431, 445). Yaprak modül (import
// yok): `ws.ts`, `ws-device.ts`, `api/sessions.ts`, `api/audit.ts`, `api/unattended.ts` buradan alır — import döngüsü olmaz (PT-K1).
// Üç ayrı sözlük bilinçli olarak birleştirilmez: İSTEK (`ask|silent`, sunucu → cihaz), KİP (`asked|no_user|silent`, DB
// `support_sessions_consent_mode_chk` ile bayt bayt aynı) ve KARAR (`granted|denied|timeout`, cihazdaki onay diyaloğu).

/** `connect.consent` (§6.2): teknisyenin istediği. `ask` → cihaz canlı duruma göre `asked`/`no_user` seçer (K-P28u-2). */
export const CONSENT_REQUESTS = ["ask", "silent"] as const;
export type ConsentRequest = (typeof CONSENT_REQUESTS)[number];

/** Oturumun gerçekleşen kipi — `support_sessions.consent_mode` (ikili CHECK), audit `consentMode`, geçmiş/audit filtresi. */
export const CONSENT_MODES = ["asked", "no_user", "silent"] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];

/** Cihazdaki onay diyaloğunun sonucu (`consent.result.decision`, audit `unattended.consent.decision`). */
export const CONSENT_RESULT_DECISIONS = ["granted", "denied", "timeout"] as const;
export type ConsentResultDecision = (typeof CONSENT_RESULT_DECISIONS)[number];

/** Cihazdaki etkileşimli kullanıcı durumu (§7.2): oturum açık+kilitsiz / kilitli / konsolda kullanıcı yok. DB'ye yazılmaz. */
export const DEVICE_USER_STATES = ["active", "locked", "none"] as const;
export type DeviceUserState = (typeof DEVICE_USER_STATES)[number];

/** AC-431: cihazdaki onay diyaloğu süresi (sn); dolunca `timeout` (yardımcı, Go eşi K6). */
export const CONSENT_DIALOG_SEC = 60;
/** `consent.result.ms` üst sınırı: diyalog süresi + 5 sn pay. */
export const CONSENT_RESULT_MS_MAX = 65_000;

/**
 * K-P28u-4: PENDING cihaz oturumu ömrü. `ask` → 150 sn (60 sn diyalog + gösterge + katılım), `silent` → P27'nin 60 sn'si
 * (`DEVICE_CONNECT_WINDOW_MS`, sunucu `connect-tx.ts`). DB `support_sessions_ttl_chk` cihaz dalı 55..155 sn — bu değer 155'i
 * aşamaz (K1 devir notu 3).
 */
export const DEVICE_CONSENT_WINDOW_MS = 150_000;
