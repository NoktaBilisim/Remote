// /ws/device sözleşmesi — gözetimsiz servis ↔ sunucu kalıcı kanalı (P27; mimari-p27 §4.4, `"v":1`; AC-273, 275, 295, 339).
// Bağlantı `wss://<host>/ws/device`, alt protokol `rs.device.v1`, sorgu dizesi yok (G-10), Origin başlığı OLMAMALI (ADR-0012).
// Kimlik bant içi meydan okuma (K-P27-6): sunucu `device.hello{nonce}` gönderir; 10 sn içinde geçerli `device.auth` gelmezse
// 4401. Kimliksiz soket `device.auth` dışında mesaj gönderemez ve hiçbir mesaj almaz. Mesaj ≤ 4 KB, cihaz başına 5 msg/sn.
// Sunucuda paneli/anahtarı değiştiren mesaj YOKTUR (AC-295, ADR-0028): yerel anahtar yalnız cihazdan beyan edilir.
// Go eşi `internal/servis/wsdevice.go` (K5); ortak örnekler `fixtures/ws-device.json` (valid.* geçer, invalid.* reddedilir).
// P28u (mimari-p28u §6): yetenek belirteci `rs.cap.consent1`; yeni mesajlar AYRI birliklerde (`deviceConsent*Schema`) — yalnız
// belirteci bildiren sokette geçerli (S-P18-T1 / `rs.cap.chat1` kalıbı). Fikstürde `consent1*` anahtarları.
import { z } from "zod";
import { UNSAFE_NAME_CHARS } from "./api/shared.ts";
import { REJOIN_TICKET_TTL_SEC } from "./rejoin-const.ts";
import {
  CONSENT_MODES,
  CONSENT_REQUESTS,
  CONSENT_RESULT_DECISIONS,
  CONSENT_RESULT_MS_MAX,
  DEVICE_USER_STATES,
} from "./unattended-consent.ts";
import { SESSION_ENDED_REASONS } from "./ws.ts";

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
/** `device.features.caps` / hub `DeviceConn.caps` değerleri. */
export const DEVICE_FEATURES = ["consent1"] as const;
export type DeviceFeature = (typeof DEVICE_FEATURES)[number];
/** Belirteç → özellik (sunucu bilinmeyen `rs.cap.*` belirtecini yok sayar; P28a kalıbı). */
export const DEVICE_FEATURE_BY_SUBPROTOCOL: Readonly<Record<string, DeviceFeature>> = { [WS_DEVICE_CAP_CONSENT]: "consent1" };
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
 * P28u (§6.2): `consent_denied` / `consent_timeout` kullanıcı reddetti / yanıt vermedi (konsola aynı adla gider);
 * `protocol` `consent1` sokette `connect.consent ∉ {ask, silent}` (D-P28u-5 fail-closed) — yalnız DB bitiş nedeni, konsola
 * `device_timeout` (P27 K3 `helper_failed` kalıbı).
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
    reason: z.enum(DEVICE_CONNECT_FAIL_REASONS).optional(),
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
 * Onay sonucu (§2 adım 4–5, AC-431–433): `asked` ⇔ `decision` + `ms` zorunlu; `no_user` ⇔ ikisi de yok. Oturum başına tek;
 * sunucu ikincisini ve bu cihazın canlı odası olmayan `sessionId`'yi yok sayar (+ `rs_unattended_device_msg_rejected_total`).
 */
export const deviceConsentResultSchema = z
  .strictObject({
    t: z.literal("consent.result"),
    sessionId: ulid,
    mode: z.enum(["asked", "no_user"]),
    decision: z.enum(CONSENT_RESULT_DECISIONS).optional(),
    ms: z.number().int().min(0).max(CONSENT_RESULT_MS_MAX).optional(),
  })
  .refine((m) => (m.mode === "asked" ? m.decision !== undefined && m.ms !== undefined : m.decision === undefined && m.ms === undefined), {
    message: "asked iken decision ve ms zorunlu, no_user iken yasak",
    path: ["decision"],
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
 */
export function deviceIndicatorText(techName: string, tenantName: string, test: boolean): string {
  return indicatorWith("Uzaktan bağlantı", techName, tenantName, test);
}

/** P28u §7.6 (AC-439): `silent` odada izleme kipi göstergesi (`connect.indicatorText` / `rejoin.indicatorText`). */
export function deviceSilentIndicatorText(techName: string, tenantName: string, test: boolean): string {
  return indicatorWith("Uzaktan izleniyor", techName, tenantName, test);
}

/** P28u §7.6: `silent` odada kontrol açıkken gösterge (`indicatorControl`; yardımcı ≤ 1 sn'de etiketi değiştirir). */
export function deviceControlIndicatorText(techName: string, tenantName: string, test: boolean): string {
  return indicatorWith("Uzaktan kontrol", techName, tenantName, test);
}

function indicatorWith(label: string, techName: string, tenantName: string, test: boolean): string {
  const text = `${test ? DEVICE_INDICATOR_TEST_PREFIX : ""}${label}: ${techName} — ${tenantName}`;
  return [...text].slice(0, DEVICE_INDICATOR_TEXT_MAX).join("");
}

const name = z.string().min(1).max(120);
const ticket = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const indicator = z.string().min(1).max(DEVICE_INDICATOR_TEXT_MAX);

/** `indicatorControl` yalnız `silent`'ta ve orada zorunlu (§6.2). */
const silentHasControl = (m: { consent?: string; mode?: string; indicatorControl?: string | undefined }): boolean =>
  (m.consent === "silent" || m.mode === "silent") === (m.indicatorControl !== undefined);

export const deviceOutboundSchema = z.discriminatedUnion("t", [
  /** Açılış meydan okuması; `nonce` 32 bayt rastgele, soket başına tek. */
  z.strictObject({ t: z.literal("device.hello"), v: z.literal(WS_DEVICE_PROTOCOL_VERSION), nonce: z.string().regex(B64URL_32_PATTERN) }),
  z.strictObject({ t: z.literal("device.ready"), tenantName: name, customerName: name }),
  /**
   * Bağlantı isteği (§2 adım 2). `ticket` yardımcının `/ws/guest` bileti (`rs.ticket.` + ticket); yalnız boruyla aktarılır.
   * P28u (§6.2): yalnız `consent1` cihaza gider → `consent` ZORUNLU (eksik/başka değer şema dışı; servis `protocol`, D-P28u-5);
   * `indicatorControl` yalnız `silent`'ta ve orada zorunlu; `silent`'ta `indicatorText` = `deviceSilentIndicatorText`.
   * `tenantName` sunucunun `tenants.name`'i — onay diyaloğundaki firma adı (K-P28u-23).
   */
  z
    .strictObject({
      t: z.literal("connect"),
      sessionId: ulid,
      ticket,
      techName: name,
      tenantName: name,
      techIp: z.string().min(2).max(45),
      expiresInSec: z.number().int().min(1).max(300),
      indicatorText: indicator,
      consent: z.enum(CONSENT_REQUESTS),
      indicatorControl: indicator.optional(),
    })
    .refine(silentHasControl, { message: "indicatorControl yalnız silent'ta ve orada zorunlu", path: ["indicatorControl"] }),
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
  /** `device.ready`'den hemen sonra, soket başına bir kez (§6.1). `device.ready` şeması DEĞİŞMEZ. */
  z.strictObject({
    t: z.literal("device.features"),
    caps: z
      .array(z.enum(DEVICE_FEATURES))
      .min(1)
      .max(DEVICE_FEATURES.length)
      .refine((a) => new Set(a).size === a.length, "Yinelenen yetenek"),
  }),
  /** Müdahale (§5.3): kilit 5 sn, oturum kapatma 15 sn içinde `intervene.result` beklenir. */
  z.strictObject({ t: z.literal("intervene"), sessionId: ulid, id: ulid, cmd: z.enum(INTERVENE_COMMANDS) }),
  /**
   * Yeniden katılım (§7.5, §8.3): yalnız başarılı `intervene{logoff}` sonucundan sonra, oturum başına en çok 1. `ticket` tek
   * kullanımlık (gen+1); `mode` oturumun kipi korunur, kontrol kapalı başlar; `indicatorControl` yalnız `silent`'ta ve zorunlu.
   */
  z
    .strictObject({
      t: z.literal("rejoin"),
      sessionId: ulid,
      ticket,
      mode: z.enum(CONSENT_MODES),
      indicatorText: indicator,
      indicatorControl: indicator.optional(),
      expiresInSec: z.number().int().min(1).max(REJOIN_TICKET_TTL_SEC),
    })
    .refine(silentHasControl, { message: "indicatorControl yalnız silent'ta ve orada zorunlu", path: ["indicatorControl"] }),
]);
export type DeviceConsentOutbound = z.infer<typeof deviceConsentOutboundSchema>;
