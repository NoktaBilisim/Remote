// /ws/device sözleşmesi — gözetimsiz servis ↔ sunucu kalıcı kanalı (P27; mimari-p27 §4.4, `"v":1`; AC-273, 275, 295, 339).
// Bağlantı `wss://<host>/ws/device`, alt protokol `rs.device.v1`, sorgu dizesi yok (G-10), Origin başlığı OLMAMALI (ADR-0012).
// Kimlik bant içi meydan okuma (K-P27-6): sunucu `device.hello{nonce}` gönderir; 10 sn içinde geçerli `device.auth` gelmezse
// 4401. Kimliksiz soket `device.auth` dışında mesaj gönderemez ve hiçbir mesaj almaz. Mesaj ≤ 4 KB, cihaz başına 5 msg/sn.
// Sunucuda paneli/anahtarı değiştiren mesaj YOKTUR (AC-295, ADR-0028): yerel anahtar yalnız cihazdan beyan edilir.
// Go eşi `internal/servis/wsdevice.go` (K5); ortak örnekler `fixtures/ws-device.json` (valid.* geçer, invalid.* reddedilir).
// P28u (mimari-p28u §6): yetenek belirteci `rs.cap.consent1`; yeni mesajlar AYRI birliklerde (`deviceConsent*Schema`) — yalnız
// belirteci bildiren sokette geçerli (S-P18-T1 / `rs.cap.chat1` kalıbı). Fikstürde `consent1*` anahtarları.
// r3 (mimari-p28u §r3.3, K-P28u-r3-2..5): onaysız tek yol. Yeni belirteç `rs.cap.direct1` (yalnız sunucu `DeviceConn.caps`'ine
// girer, `device.features.caps`'e girmez); `connect.consent` yalnız `ask`, `consent.result.mode` ve `rejoin.mode` yalnız
// `no_user`; `indicatorControl` ve izleme/kontrol gösterge metinleri kaldırıldı.
import { z } from "zod";
import { UNSAFE_NAME_CHARS } from "./api/shared.ts";
import { REJOIN_TICKET_TTL_SEC } from "./rejoin-const.ts";
import { CONSENT_REQUESTS, DEVICE_USER_STATES } from "./unattended-consent.ts";
import { refineUpdateEvent, UPDATE_EVENT_SHAPE, UPDATE_VERSION_PATTERN, updateOfferSchema } from "./api/update.ts";
import { SESSION_ENDED_REASONS } from "./ws.ts";
import { deviceRecStateSchema, WS_DEVICE_CAP_RECORD } from "./ws-rec.ts";

export const WS_DEVICE_PATH = "/ws/device";
export const WS_DEVICE_SUBPROTOCOL = "rs.device.v1";
export const WS_DEVICE_PROTOCOL_VERSION = 1;
/** Tek mesaj üst sınırı (bayt); aşım → 1009. */
export const WS_DEVICE_MAX_PAYLOAD = 4 * 1024;
/** Cihaz başına gelen mesaj kovası (msg/sn); aşım → 1008. */
export const WS_DEVICE_RATE_PER_SEC = 5;
/** `device.hello` → geçerli `device.auth` süresi; aşımda 4401. */
export const DEVICE_AUTH_TIMEOUT_MS = 10_000;

/**
 * P28u (§6.1, K-P28u-7): servis 0.15.0 upgrade'de `rs.device.v1` yanına bu belirteci ekler (kimlik değildir; Caddy loglamaz,
 * G-10). Sunucu `device.ready`'den hemen sonra yalnız belirteci bildiren sokete `device.features` gönderir; servis yeni C→S
 * mesajlarını yalnız onu aldıktan sonra yollar (eski sunucuya bilinmeyen mesaj gitmez, K-P28u-8). Belirteçsiz soket → bağlantı
 * 409 `DEVICE_OUTDATED` (AC-435). Tek belirteç onay + müdahale + yeniden katılımı kapsar.
 */
export const WS_DEVICE_CAP_CONSENT = "rs.cap.consent1";
/**
 * r3 (K-P28u-r3-2, AC-435): onaysız yolu bilen servis (yardımcıda onay diyaloğu yok; `connect.consent="ask"` → sormadan açar +
 * `consent.result{no_user}`). Sunucu gözetimsiz bağlantıyı YALNIZ bunu bildiren sokete açar, aksi 409 `DEVICE_OUTDATED`.
 * `consent1` ile birlikte gönderilir (`device.features`, `device.user`, `intervene`, `rejoin` hâlâ `consent1`'e bağlı).
 */
export const DEVICE_CAP_DIRECT = "rs.cap.direct1";
/**
 * P29 (mimari-p29 §4.3, AC-493): güncelleyiciyi bilen servis (0.22.0+). Sunucu `update.*` mesajlarını YALNIZ bunu bildiren
 * sokete gönderir/kabul eder; eski servis (≤ 0.21) hiç görmez.
 */
export const WS_DEVICE_CAP_UPDATE = "rs.cap.update1";
/** Hub `DeviceConn.caps` değerleri (soketin bildirdiği belirteçlerden). */
export const DEVICE_FEATURES = ["consent1", "record1", "direct1", "update1"] as const;
export type DeviceFeature = (typeof DEVICE_FEATURES)[number];
/**
 * `device.features.caps`'e girebilen özellikler — `direct1` BİLİNÇLİ OLARAK yok (r3.3): 0.15–0.19 Go `validFeatures` bilinmeyen
 * değeri reddeder; sunucu `caps`'i bu kümeye süzerek gönderir.
 */
// P29 sapması (implementation.md K2): `update1` BİLİNÇLİ OLARAK yok — `direct1` ile aynı gerekçe (0.15–0.21 Go `validFeatures`
// katı); P29 desteğini `update.offer`/`update.none`'ın kendisi duyurur (§4.3), `device.features` yankısına gerek yok.
export const DEVICE_ANNOUNCED_FEATURES = ["consent1", "record1"] as const satisfies readonly DeviceFeature[];
export type DeviceAnnouncedFeature = (typeof DEVICE_ANNOUNCED_FEATURES)[number];
/** Belirteç → özellik (sunucu bilinmeyen `rs.cap.*` belirtecini yok sayar; P28a kalıbı). */
export const DEVICE_FEATURE_BY_SUBPROTOCOL: Readonly<Record<string, DeviceFeature>> = {
  [WS_DEVICE_CAP_CONSENT]: "consent1",
  // P28e (§6.1, K-P28e-7): servis 0.16.0; `connect.recording` ve `rec.state` yalnız bu özellikteki sokete.
  [WS_DEVICE_CAP_RECORD]: "record1",
  [DEVICE_CAP_DIRECT]: "direct1",
  // P29 (§4.3): servis 0.22.0; `update.*` yalnız bu özellikteki sokete.
  [WS_DEVICE_CAP_UPDATE]: "update1",
};
/** `device.user` gönderimi değişimden sonra bu kadar ms debounce edilir (§6.2; kova `WS_DEVICE_RATE_PER_SEC` aynen). */
export const DEVICE_USER_DEBOUNCE_MS = 500;

/**
 * Kapanış kodları (ws.ts `WS_CLOSE` ile birlikte). 4401: imza/iptal/tenant pasif/zaman aşımı (servis yeniden bağlanmayı
 * `revoked{}` almışsa bırakır); 4403: imza kapısı (AC-297, mod `off` ya da imzasız beyan); 4409: aynı cihaz yeniden bağlandı —
 * eski soket kapanır, yeni kalır (D-P27-3 sayacı).
 */
export const WS_DEVICE_CLOSE = { AUTH_FAILED: 4401, GATE: 4403, REPLACED: 4409 } as const;

/** Ed25519 imza girdisinin bağlam öneki (alan ayırma; başka imzalarla karışmaz). */
export const DEVICE_AUTH_CONTEXT = "rs-device-auth-v1";

/**
 * `device.auth.sig`'in imzaladığı dize: `"rs-device-auth-v1\n" + nonce + "\n" + deviceId + "\n" + origin`. `origin` sunucunun
 * `PUBLIC_BASE_URL` kökeni (şema + host [+ port], sonda `/` yok) — başka sunucuya yönelik imza yeniden kullanılamaz.
 */
export function deviceAuthMessage(nonce: string, deviceId: string, origin: string): string {
  return `${DEVICE_AUTH_CONTEXT}\n${nonce}\n${deviceId}\n${origin}`;
}

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
/** base64url (dolgusuz) 32 bayt = 43 karakter; son karakterin 2 dolgu biti 0 (kanonik biçim). */
export const B64URL_32_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** base64url (dolgusuz) 64 bayt (Ed25519 imzası) = 86 karakter; son karakterin 4 dolgu biti 0. */
export const B64URL_64_PATTERN = /^[A-Za-z0-9_-]{85}[AQgw]$/;
/** Servis sürümü (`unattended_devices.agent_version` VARCHAR(20) semver CHECK ile aynı). */
export const DEVICE_VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
/** İkilinin SHA-256'sı, küçük hex (`binary_sha256` CHECK ile aynı). */
export const DEVICE_SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Cihazın beyan ettiği kısa metin (bilgisayar adı, işletim sistemi): 1..64, görünmez/kontrol karakteri yok. */
export const deviceTextSchema = z
  .string()
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Görünmez veya kontrol karakteri içeremez")
  .trim()
  .min(1)
  .max(64);

/**
 * `connect.result.reason` (§4.4): servis bağlantıyı açamadı → oturum `CANCELLED(<reason>)`. `local_disabled` yerel anahtar
 * kapalı; `indicator_failed` gösterge çizilemedi (AC-294 fail-closed); `helper_failed` yardımcı başlatılamadı; `no_console`
 * fiziksel konsol oturumu yok; `busy` cihazda başka gözetimsiz oturum var.
 * P28u (§6.2): `consent_denied` / `consent_timeout` kullanıcı reddetti / yanıt vermedi — r3: cihaz artık göndermez, yalnız eski
 * DB kayıtlarını okumak için bu dizide kalır (K-P28u-r3-12); tel şeması `DEVICE_CONNECT_RESULT_REASONS`'ı kullanır.
 * `protocol` `consent1` sokette geçersiz `connect` (ör. eski sunucunun `silent`'ı, D-P28u-5 fail-closed) — yalnız DB bitiş
 * nedeni, konsola `device_timeout` (P27 K3 `helper_failed` kalıbı).
 */
export const DEVICE_CONNECT_FAIL_REASONS = [
  "local_disabled",
  "indicator_failed",
  "helper_failed",
  "no_console",
  "busy",
  "consent_denied",
  "consent_timeout",
  "protocol",
] as const;
export type DeviceConnectFailReason = (typeof DEVICE_CONNECT_FAIL_REASONS)[number];
/** r3: `connect.result.reason` tel değerleri — `consent_*` yok (cihazda onay diyaloğu yok; Go eşi aynı kümeyi gönderir). */
export const DEVICE_CONNECT_RESULT_REASONS = [
  "local_disabled",
  "indicator_failed",
  "helper_failed",
  "no_console",
  "busy",
  "protocol",
] as const satisfies readonly DeviceConnectFailReason[];

/**
 * `session.closed.reason`: yardımcının çıkış nedeni (bilgi; oda zaten bitmiş olabilir). Enum DEĞİL — yeni servis sürümünün
 * bilinmeyen nedeni mesajı düşürmesin; küçük harf/rakam/alt çizgi, ≤ 32 (kişisel veri taşıyamaz).
 */
export const DEVICE_CLOSE_REASON_PATTERN = /^[a-z0-9_]{1,32}$/;

// --- Cihaz → sunucu ---

/** Kimliksiz soketin kabul ettiği TEK mesaj. Başarıda sunucu `agent_version/sha/signed/local_enabled/last_seen_at/last_ip` yazar. */
export const deviceAuthSchema = z.strictObject({
  t: z.literal("device.auth"),
  deviceId: ulid,
  /** Ed25519(`deviceAuthMessage(nonce, deviceId, origin)`), base64url. */
  sig: z.string().regex(B64URL_64_PATTERN),
  version: z.string().regex(DEVICE_VERSION_PATTERN),
  sha256: z.string().regex(DEVICE_SHA256_PATTERN),
  /** WinVerifyTrust beyanı — kimlik doğrulama DEĞİL, kullanılabilirlik kapısı (AC-297). */
  signed: z.boolean(),
  localEnabled: z.boolean(),
  osVersion: deviceTextSchema,
});
export type DeviceAuth = z.infer<typeof deviceAuthSchema>;

export const deviceConnectResultSchema = z
  .strictObject({
    t: z.literal("connect.result"),
    sessionId: ulid,
    ok: z.boolean(),
    reason: z.enum(DEVICE_CONNECT_RESULT_REASONS).optional(),
  })
  .refine((m) => (m.ok ? m.reason === undefined : m.reason !== undefined), {
    message: "ok:false iken reason zorunlu, ok:true iken yasak",
    path: ["reason"],
  });
/** Yerel anahtar değişti (AC-295) → DB + audit `unattended.local_state`; `false` ise etkin oda `local_disabled` ile hemen biter. */
export const deviceStateSchema = z.strictObject({ t: z.literal("device.state"), localEnabled: z.boolean() });
export const deviceSessionClosedSchema = z.strictObject({
  t: z.literal("session.closed"),
  sessionId: ulid,
  reason: z.string().regex(DEVICE_CLOSE_REASON_PATTERN),
});
/** Kaldırma (§5.3) → `revoke_reason = UNINSTALLED`, soket kapanır. */
export const deviceUnregisterSchema = z.strictObject({ t: z.literal("device.unregister") });

/** Kimliği doğrulanmış soketten kabul edilen mesajlar (`device.auth` yeniden gelirse şema dışı → 1008). */
export const deviceInboundSchema = z.discriminatedUnion("t", [
  deviceConnectResultSchema,
  deviceStateSchema,
  deviceSessionClosedSchema,
  deviceUnregisterSchema,
]);
export type DeviceInbound = z.infer<typeof deviceInboundSchema>;

// --- Cihaz → sunucu, yalnız `consent1` sokette `device.features` SONRASI (P28u §6.2) ---

/** Etkileşimli kullanıcı durumu (§7.2): değişimde (500 ms debounce) + her `device.features` sonrası bir kez. Hub belleğinde. */
export const deviceUserSchema = z.strictObject({ t: z.literal("device.user"), state: z.enum(DEVICE_USER_STATES) });

/**
 * Bağlantı açıldı bildirimi (K-P28u-r3-4, AC-433): cihaz sormadan açar ve yalnız `{mode:"no_user"}` gönderir (`asked` →
 * şema dışı). Sunucu `ask` odasında bunu bekler (yoksa `consent_missing`, K-P28u-3). Oturum başına tek; sunucu ikincisini ve
 * bu cihazın canlı odası olmayan `sessionId`'yi yok sayar (+ `rs_unattended_device_msg_rejected_total`).
 */
export const deviceConsentResultSchema = z.strictObject({
  t: z.literal("consent.result"),
  sessionId: ulid,
  mode: z.literal("no_user"),
});

/** Müdahale komutları (§5.3, AC-442–444). */
export const INTERVENE_COMMANDS = ["lock", "logoff"] as const;
export type InterveneCommand = (typeof INTERVENE_COMMANDS)[number];
/**
 * `intervene.result.reason` (§7.5): `no_session` komutun oturumu çalışan yardımcınınki değil / konsol oturumu yardımcınınkiyle
 * eşleşmiyor (D-P28u-3); `not_in_control` yardımcının son `control` değeri kapalı (AC-442 istemci tarafı ret); `not_locked`
 * 2 sn'de Winlogon görülmedi; `no_user` konsolda kullanıcı yok; `api_error` Windows çağrısı hata verdi; `timeout` 10 sn'de
 * `WTS_SESSION_LOGOFF` gelmedi. REST 502 `INTERVENE_FAILED` `fields.reason` aynı küme + sunucu süre aşımı `timeout`.
 */
export const INTERVENE_FAIL_REASONS = ["no_session", "not_in_control", "not_locked", "no_user", "api_error", "timeout"] as const;
export type InterveneFailReason = (typeof INTERVENE_FAIL_REASONS)[number];

/** `ok:false` ⇔ `reason`. `id` = sunucunun `intervene.id`'si (eşleşmeyen sonuç yok sayılır). */
export const deviceInterveneResultSchema = z
  .strictObject({
    t: z.literal("intervene.result"),
    sessionId: ulid,
    id: ulid,
    cmd: z.enum(INTERVENE_COMMANDS),
    ok: z.boolean(),
    reason: z.enum(INTERVENE_FAIL_REASONS).optional(),
  })
  .refine((m) => (m.ok ? m.reason === undefined : m.reason !== undefined), {
    message: "ok:false iken reason zorunlu, ok:true iken yasak",
    path: ["reason"],
  });

/**
 * `consent1` soketin `device.features` sonrası ek olarak gönderebildiği mesajlar. Sunucu önce `deviceInboundSchema`'yı, soket
 * `consent1` bildirmişse bunu dener; belirteçsiz sokette bu mesajlar şema dışıdır (1008).
 */
export const deviceConsentInboundSchema = z.discriminatedUnion("t", [
  deviceUserSchema,
  deviceConsentResultSchema,
  deviceInterveneResultSchema,
]);
export type DeviceConsentInbound = z.infer<typeof deviceConsentInboundSchema>;

// --- Sunucu → cihaz ---

/** Gösterge metni üst sınırı (yardımcıya giden; `ui.indicator` etiketi). */
export const DEVICE_INDICATOR_TEXT_MAX = 160;
/** `unsigned` modda (yalnız staging) gösterge metninin öneki (O-P27-6, AC-342). */
export const DEVICE_INDICATOR_TEST_PREFIX = "TEST — imzasız · ";

/**
 * AC-294 gösterge metni: `Uzaktan bağlantı: <teknisyen> — <destek firması>`; `test` (mod `unsigned`) iken `TEST — imzasız · `
 * önekli. Metin sunucuda üretilir ve `connect.indicatorText` ile yardımcıya gider (§4.5 r2); üst sınırı aşan kısım kesilir.
 * r3 (K-P28u-r3-7): tek metin — `connect` ve `rejoin` aynı metni taşır.
 */
export function deviceIndicatorText(techName: string, tenantName: string, test: boolean): string {
  const text = `${test ? DEVICE_INDICATOR_TEST_PREFIX : ""}Uzaktan bağlantı: ${techName} — ${tenantName}`;
  return [...text].slice(0, DEVICE_INDICATOR_TEXT_MAX).join("");
}

const name = z.string().min(1).max(120);
const ticket = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const indicator = z.string().min(1).max(DEVICE_INDICATOR_TEXT_MAX);

export const deviceOutboundSchema = z.discriminatedUnion("t", [
  /** Açılış meydan okuması; `nonce` 32 bayt rastgele, soket başına tek. */
  z.strictObject({ t: z.literal("device.hello"), v: z.literal(WS_DEVICE_PROTOCOL_VERSION), nonce: z.string().regex(B64URL_32_PATTERN) }),
  z.strictObject({ t: z.literal("device.ready"), tenantName: name, customerName: name }),
  /**
   * Bağlantı isteği (§2 adım 2). `ticket` yardımcının `/ws/guest` bileti (`rs.ticket.` + ticket); yalnız boruyla aktarılır.
   * P28u (§6.2): yalnız `consent1` cihaza gider → `consent` ZORUNLU (eksik/başka değer şema dışı; servis `protocol`, D-P28u-5).
   * r3 (K-P28u-r3-3): `consent` tek değer `ask` (cihaz sormaz); `indicatorControl` yok (bilinmeyen alan → şema dışı).
   */
  z.strictObject({
    t: z.literal("connect"),
    sessionId: ulid,
    ticket,
    techName: name,
    tenantName: name,
    techIp: z.string().min(2).max(45),
    expiresInSec: z.number().int().min(1).max(300),
    indicatorText: indicator,
    consent: z.enum(CONSENT_REQUESTS),
    /**
     * P28e (§2.2, §6.2): YALNIZ `record1` cihaza ve yalnız `true` (eski 0.15.0 katı ayrıştırıcısına alan gitmez). Servis →
     * yardımcı gösterge eki " — Kayıt yapılıyor" (AC-448).
     */
    recording: z.literal(true).optional(),
  }),
  /** Sunucu tarafı bitiş (yedek yol; asıl bitiş yardımcının `/ws/guest`'ine `session.ended`). */
  z.strictObject({ t: z.literal("disconnect"), sessionId: ulid, reason: z.enum(SESSION_ENDED_REASONS) }),
  /** Admin iptali (AC-275); ardından 4401. Servis "İptal edildi" olur ve yeniden bağlanmayı bırakır. */
  z.strictObject({ t: z.literal("revoked") }),
]);
export type DeviceOutbound = z.infer<typeof deviceOutboundSchema>;

/**
 * P28u: yalnız `consent1` sokete giden mesajlar — `deviceOutboundSchema`'dan AYRI birlik (tip düzeyinde ayrım; hub yetenek
 * denetimiyle gönderir). Eski servis (`ParseServer` strict) bunları tanımaz; bu yüzden fikstürde ayrı anahtarlar (`consent1*`).
 */
export const deviceConsentOutboundSchema = z.discriminatedUnion("t", [
  /** `device.ready`'den hemen sonra, soket başına bir kez (§6.1). `device.ready` şeması DEĞİŞMEZ. `direct1` girmez (r3.3). */
  z.strictObject({
    t: z.literal("device.features"),
    caps: z
      .array(z.enum(DEVICE_ANNOUNCED_FEATURES))
      .min(1)
      .max(DEVICE_ANNOUNCED_FEATURES.length)
      .refine((a) => new Set(a).size === a.length, "Yinelenen yetenek"),
  }),
  /** Müdahale (§5.3): kilit 5 sn, oturum kapatma 15 sn içinde `intervene.result` beklenir. */
  z.strictObject({ t: z.literal("intervene"), sessionId: ulid, id: ulid, cmd: z.enum(INTERVENE_COMMANDS) }),
  /**
   * Yeniden katılım (§7.5, §8.3): yalnız başarılı `intervene{logoff}` sonucundan sonra, oturum başına en çok 1. `ticket` tek
   * kullanımlık (gen+1); kontrol kapalı başlar. r3: `mode` her zaman `no_user`, `indicatorControl` yok.
   */
  z.strictObject({
    t: z.literal("rejoin"),
    sessionId: ulid,
    ticket,
    mode: z.literal("no_user"),
    indicatorText: indicator,
    expiresInSec: z.number().int().min(1).max(REJOIN_TICKET_TTL_SEC),
  }),
]);
export type DeviceConsentOutbound = z.infer<typeof deviceConsentOutboundSchema>;

/**
 * P28e (§6.2): yalnız `record1` sokete giden mesajlar — ayrı birlik (P28u kalıbı; hub yetenek denetimiyle gönderir). Eski
 * servis tanımaz. Kayıt ortada durursa (`on:false`) gösterge eki kalkar; cihaz yanıt göndermez.
 */
export const deviceRecordOutboundSchema = z.discriminatedUnion("t", [deviceRecStateSchema]);
export type DeviceRecordOutbound = z.infer<typeof deviceRecordOutboundSchema>;

// --- P29 güncelleme eki (mimari-p29 §4.3; yalnız `update1` soket) ---
// Ayrı birlikler (P28u/P28e kalıbı): eski servisin katı ayrıştırıcısı bunları tanımaz; sunucu yalnız `hub.has(id, "update1")`
// iken gönderir/kabul eder. Eski sunucu kuralı (AC-493): servis C→S `update.*` mesajlarını YALNIZ o bağlantıda `update.offer`
// ya da `update.none` aldıktan sonra yollar (eski `device-ws.ts` bilinmeyen `t`'de 1008 kapatır). Fikstür `update1*` anahtarları.

/**
 * Sunucu → cihaz. `update.offer` (belirteçsiz): `device.ready`'den hemen sonra, `update.check` yanıtı ve politika değişince;
 * `update.none`: sunulabilir servis manifesti yok (AC-492 "204" karşılığı); `update.token`: yalnız `update.token.request`
 * yanıtı (`policy=auto`, `version` = sunulabilir sürüm > cihaz sürümü; aksi `update.none`), tek kullanımlık 32 bayt belirteç
 * `Authorization: Bearer` ile servis dosyası ucunda kullanılır (§4.4).
 */
export const deviceUpdateOutboundSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("update.offer"), ...updateOfferSchema.shape }),
  z.strictObject({ t: z.literal("update.none") }),
  z.strictObject({
    t: z.literal("update.token"),
    version: z.string().regex(UPDATE_VERSION_PATTERN),
    token: z.string().regex(B64URL_32_PATTERN),
  }),
]);
export type DeviceUpdateOutbound = z.infer<typeof deviceUpdateOutboundSchema>;

/** `update.state.phase` — `installing` güncelleniyor durumunun TEK kanalıdır (olay değil, audit yok; D-5). */
export const DEVICE_UPDATE_PHASES = ["installing"] as const;

/**
 * Cihaz → sunucu (`deviceInboundSchema`'dan sonra denenir). `update.check` 24 sa ± 2 sa (cihaz başına 4/sa);
 * `update.token.request` offer doğrulandıktan sonra 0–120 dk rastgele gecikmeyle (4/sa); `update.state{installing}` →
 * hub `markUpdating` (3 dk) + DB `INSTALLING`; `update.event` = `updateEventSchema` alanları düz (10/sa; fazlası yok sayılır).
 */
export const deviceUpdateInboundSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("update.check") }),
  z.strictObject({ t: z.literal("update.token.request"), version: z.string().regex(UPDATE_VERSION_PATTERN) }),
  z.strictObject({
    t: z.literal("update.state"),
    phase: z.enum(DEVICE_UPDATE_PHASES),
    version: z.string().regex(UPDATE_VERSION_PATTERN),
  }),
  z.strictObject({ t: z.literal("update.event"), ...UPDATE_EVENT_SHAPE }).superRefine(refineUpdateEvent),
]);
export type DeviceUpdateInbound = z.infer<typeof deviceUpdateInboundSchema>;
