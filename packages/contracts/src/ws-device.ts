// /ws/device sözleşmesi — gözetimsiz servis ↔ sunucu kalıcı kanalı (P27; mimari-p27 §4.4, `"v":1`; AC-273, 275, 295, 339).
// Bağlantı `wss://<host>/ws/device`, alt protokol `rs.device.v1`, sorgu dizesi yok (G-10), Origin başlığı OLMAMALI (ADR-0012).
// Kimlik bant içi meydan okuma (K-P27-6): sunucu `device.hello{nonce}` gönderir; 10 sn içinde geçerli `device.auth` gelmezse
// 4401. Kimliksiz soket `device.auth` dışında mesaj gönderemez ve hiçbir mesaj almaz. Mesaj ≤ 4 KB, cihaz başına 5 msg/sn.
// Sunucuda paneli/anahtarı değiştiren mesaj YOKTUR (AC-295, ADR-0028): yerel anahtar yalnız cihazdan beyan edilir.
// Go eşi `internal/servis/wsdevice.go` (K5); ortak örnekler `fixtures/ws-device.json` (valid.* geçer, invalid.* reddedilir).
import { z } from "zod";
import { UNSAFE_NAME_CHARS } from "./api/shared.ts";
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
 */
export const DEVICE_CONNECT_FAIL_REASONS = ["local_disabled", "indicator_failed", "helper_failed", "no_console", "busy"] as const;
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
  const text = `${test ? DEVICE_INDICATOR_TEST_PREFIX : ""}Uzaktan bağlantı: ${techName} — ${tenantName}`;
  return [...text].slice(0, DEVICE_INDICATOR_TEXT_MAX).join("");
}

const name = z.string().min(1).max(120);

export const deviceOutboundSchema = z.discriminatedUnion("t", [
  /** Açılış meydan okuması; `nonce` 32 bayt rastgele, soket başına tek. */
  z.strictObject({ t: z.literal("device.hello"), v: z.literal(WS_DEVICE_PROTOCOL_VERSION), nonce: z.string().regex(B64URL_32_PATTERN) }),
  z.strictObject({ t: z.literal("device.ready"), tenantName: name, customerName: name }),
  /** Bağlantı isteği (§2 adım 2). `ticket` yardımcının `/ws/guest` bileti (`rs.ticket.` + ticket); yalnız boruyla aktarılır. */
  z.strictObject({
    t: z.literal("connect"),
    sessionId: ulid,
    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    techName: name,
    tenantName: name,
    techIp: z.string().min(2).max(45),
    expiresInSec: z.number().int().min(1).max(300),
    indicatorText: z.string().min(1).max(DEVICE_INDICATOR_TEXT_MAX),
  }),
  /** Sunucu tarafı bitiş (yedek yol; asıl bitiş yardımcının `/ws/guest`'ine `session.ended`). */
  z.strictObject({ t: z.literal("disconnect"), sessionId: ulid, reason: z.enum(SESSION_ENDED_REASONS) }),
  /** Admin iptali (AC-275); ardından 4401. Servis "İptal edildi" olur ve yeniden bağlanmayı bırakır. */
  z.strictObject({ t: z.literal("revoked") }),
]);
export type DeviceOutbound = z.infer<typeof deviceOutboundSchema>;
