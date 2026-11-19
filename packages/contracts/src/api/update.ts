// P29 istemci otomatik güncelleme sözleşmesi (mimari-p29 r2 §4, §14; ADR-0040; AC-470..493). zod tek kaynak.
// Yaprak modül (yalnız zod): `ws-device.ts` `update.*` mesajları için buradan alır — bu yüzden `ws-device.ts`/`requests.ts`
// İMPORT EDİLMEZ (PT-K1 döngü kuralı). Oradaki desenlerin eşleri aşağıda yeniden yazılır; eşitliği
// `test/update-p29.test.ts` `.source` karşılaştırmasıyla sabitler.
// Go eşi `apps/agent-win/internal/update/{manifest,reason,verify}.go`; ortak örnekler `test/fixtures/update-manifest/`
// (`cases.json` dizini; iki dil aynı baytları aynı sonuçla değerlendirir, §14.6).
import { z } from "zod";

// ------------------------------------------------------------------------------------------- desenler (eşleri)

/** `ws-device.ts` `DEVICE_VERSION_PATTERN` eşi (K-P29-4: sayısal üçlü, ön sürüm etiketi yok). */
export const UPDATE_VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
/** `ws-device.ts` `DEVICE_SHA256_PATTERN` eşi (küçük hex). */
export const UPDATE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** `ws-device.ts` `B64URL_64_PATTERN` eşi: Ed25519 imzası, base64url dolgusuz 86 karakter (`.sig` dosyası ve `signature`). */
export const UPDATE_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{85}[AQgw]$/;
/** `ws-device.ts` `B64URL_32_PATTERN` eşi: servis dosyası belirteci (32 bayt) ve Ed25519 açık anahtarı. */
export const UPDATE_B64URL_32_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** `requests.ts` `bindingKeySchema` deseninin eşi (`rsb_` + base64url 32 bayt). */
export const UPDATE_BINDING_KEY_PATTERN = /^rsb_[A-Za-z0-9_-]{43}$/;
/** Manifest zaman biçimi (§14.6): `YYYY-MM-DDTHH:MM:SSZ` — kesirli saniye ve ofset yok. */
export const UPDATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ------------------------------------------------------------------------------------------- sabitler (§4.1, K-P29-3)

/** İmzalanan bayt = bu önek ‖ manifest dosyasının ham baytları (K-P29-3). */
export const UPDATE_MANIFEST_CONTEXT = "rs-update-manifest-v1\n";
/** Manifest ham bayt üst sınırı (2 KiB). */
export const UPDATE_MANIFEST_MAX_BYTES = 2048;
/** `size` üst sınırı (100 MiB). */
export const UPDATE_MAX_BINARY_SIZE = 104_857_600;
/** Ed25519 imza uzunluğu (bayt); `.sig` = base64url dolgusuz 86 karakter. */
export const UPDATE_SIGNATURE_BYTES = 64;

export const UPDATE_ENVS = ["prod", "staging"] as const;
export type UpdateEnv = (typeof UPDATE_ENVS)[number];
export const UPDATE_PLATFORMS = ["windows", "macos", "linux"] as const;
export type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number];
/** windows/linux `amd64`, macOS `universal` (`UPDATE_ARCH_BY_PLATFORM`). */
export const UPDATE_ARCHES = ["amd64", "universal"] as const;
export type UpdateArch = (typeof UPDATE_ARCHES)[number];
/** `service` yalnız windows/amd64. */
export const UPDATE_COMPONENTS = ["client", "service"] as const;
export type UpdateComponent = (typeof UPDATE_COMPONENTS)[number];
/** Platform → tek geçerli mimari. */
export const UPDATE_ARCH_BY_PLATFORM: Readonly<Record<UpdatePlatform, UpdateArch>> = {
  windows: "amd64",
  macos: "universal",
  linux: "amd64",
};

/** `expiresAt − issuedAt` üst sınırı, component'e göre (r2 S-P29-T-7, §14.8): istemci 30 g, servis 90 g. */
export const UPDATE_MAX_VALIDITY_DAYS: Readonly<Record<UpdateComponent, number>> = { client: 30, service: 90 };
const DAY_MS = 86_400_000;

/** Kanonik alan sırası (§14.6); serileştirme ve doğrulama yalnız bu sırayı kabul eder. */
export const UPDATE_MANIFEST_FIELDS = [
  "schema",
  "env",
  "platform",
  "arch",
  "component",
  "version",
  "sha256",
  "size",
  "issuedAt",
  "expiresAt",
  "minUpdaterVersion",
] as const;

// ------------------------------------------------------------------------------------------- manifest şeması

/** `YYYY-MM-DDTHH:MM:SSZ` + takvimde geçerli (ör. 02-30 yok) + yıl 2000..9999 (Go `parseTime`/`Validate` ile aynı). */
export function isUpdateTime(s: string): boolean {
  if (!UPDATE_TIME_PATTERN.test(s)) return false;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return false;
  const d = new Date(ms);
  return d.toISOString() === `${s.slice(0, -1)}.000Z` && d.getUTCFullYear() >= 2000;
}

const updateTime = z.string().refine(isUpdateTime, "Zaman YYYY-MM-DDTHH:MM:SSZ olmalı");
const version = z.string().regex(UPDATE_VERSION_PATTERN, "Geçersiz sürüm");

/**
 * İkili başına manifest (K-P29-2, §4.1, §14.8). Alan kuralları + çapraz kurallar: platform↔arch eşlemesi, `service` yalnız
 * windows/amd64, `issuedAt < expiresAt ≤ issuedAt + UPDATE_MAX_VALIDITY_DAYS[component]`. Saat (now) bu şemada DENETLENMEZ
 * (süre dolumu ve `issuedAt > now + 24 sa` doğrulayıcının işi). Bayt biçimi için `parseCanonicalManifest` kullanılır.
 */
export const updateManifestSchema = z
  .strictObject({
    schema: z.literal(1),
    env: z.enum(UPDATE_ENVS),
    platform: z.enum(UPDATE_PLATFORMS),
    arch: z.enum(UPDATE_ARCHES),
    component: z.enum(UPDATE_COMPONENTS),
    version,
    sha256: z.string().regex(UPDATE_SHA256_PATTERN, "sha256 64 küçük hex olmalı"),
    size: z.number().int().min(1).max(UPDATE_MAX_BINARY_SIZE),
    issuedAt: updateTime,
    expiresAt: updateTime,
    minUpdaterVersion: version,
  })
  .superRefine((m, ctx) => {
    if (UPDATE_ARCH_BY_PLATFORM[m.platform] !== m.arch) {
      ctx.addIssue({ code: "custom", path: ["arch"], message: "Platform ile mimari uyuşmuyor" });
    }
    if (m.component === "service" && m.platform !== "windows") {
      ctx.addIssue({ code: "custom", path: ["component"], message: "Servis yalnız windows/amd64" });
    }
    const issued = Date.parse(m.issuedAt);
    const expires = Date.parse(m.expiresAt);
    if (!(issued < expires) || expires - issued > UPDATE_MAX_VALIDITY_DAYS[m.component] * DAY_MS) {
      ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Geçerlilik süresi sınır dışı" });
    }
  });
export type UpdateManifest = z.infer<typeof updateManifestSchema>;

/**
 * Tek geçerli bayt biçimi (§14.6): sabit alan sırası, boşluksuz, yalnız ASCII. Değerler `updateManifestSchema`'dan geçmiş
 * olmalı (dizgilerde kaçış gerektiren karakter yok). İmzalayıcı (Go `Manifest.Canonical`) aynı baytı üretir.
 */
export function canonicalManifestJson(m: UpdateManifest): string {
  const str = (k: string, v: string): string => `,"${k}":"${v}"`;
  return (
    `{"schema":${m.schema}` +
    str("env", m.env) +
    str("platform", m.platform) +
    str("arch", m.arch) +
    str("component", m.component) +
    str("version", m.version) +
    str("sha256", m.sha256) +
    `,"size":${m.size}` +
    str("issuedAt", m.issuedAt) +
    str("expiresAt", m.expiresAt) +
    str("minUpdaterVersion", m.minUpdaterVersion) +
    "}"
  );
}

/**
 * Ham bayttan manifest (§14.6 doğrulama sırası): 1..2048 bayt, her bayt 0x20–0x7E (BOM/yeni satır/UTF-8 çok baytlı yok),
 * JSON ayrıştır, katı şema, kanonik serileştir → ham baytla BİREBİR eşit. Yinelenen anahtar (JSON.parse sonuncuyu tutar),
 * sıra farkı, boşluk, kaçışlı dizgi, `1.0`/`1e0`, sonda veri — hepsi son eşitlikte düşer. Başarısızlık nedeni bilinçli olarak
 * dönmez: istemci için hepsi `MANIFEST_SIGNATURE` (imzalı ama okunamayan = güvenilmez).
 */
export function parseCanonicalManifest(bytes: Uint8Array): UpdateManifest | null {
  if (bytes.length < 1 || bytes.length > UPDATE_MANIFEST_MAX_BYTES) return null;
  let text = "";
  for (const b of bytes) {
    if (b < 0x20 || b > 0x7e) return null;
    text += String.fromCharCode(b);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = updateManifestSchema.safeParse(raw);
  if (!parsed.success) return null;
  return canonicalManifestJson(parsed.data) === text ? parsed.data : null;
}

/** `parseCanonicalManifest(bytes) !== null` (kanonik bayt kuralı, §14.8). */
export function isCanonicalManifest(bytes: Uint8Array): boolean {
  return parseCanonicalManifest(bytes) !== null;
}

/** Ed25519'un imzaladığı/doğruladığı bayt dizisi: `UPDATE_MANIFEST_CONTEXT ‖ bytes` (K-P29-3). */
export function updateSigningInput(bytes: Uint8Array): Uint8Array {
  const ctx = Uint8Array.from(UPDATE_MANIFEST_CONTEXT, (c) => c.charCodeAt(0));
  const out = new Uint8Array(ctx.length + bytes.length);
  out.set(ctx, 0);
  out.set(bytes, ctx.length);
  return out;
}

/** Release/volume dosya adı `update-<component>-<platform>-<arch>.json` (K-P29-2); imza dosyası + `.sig`. */
export function updateManifestFileName(m: Pick<UpdateManifest, "component" | "platform" | "arch">): string {
  return `update-${m.component}-${m.platform}-${m.arch}.json`;
}

// ------------------------------------------------------------------------------------------- olaylar (§4.1, §4.6)

/** `installing` olay DEĞİL — yalnız WS `update.state` (§4.3, D-5). */
export const UPDATE_EVENT_TYPES = ["available", "installed", "failed", "rolled_back", "skipped"] as const;
export type UpdateEventType = (typeof UPDATE_EVENT_TYPES)[number];
/** `failed` ve `rolled_back` nedenleri. `HEALTH` = servis sağlık denetimi geçmedi (rolled_back). */
export const UPDATE_FAIL_REASONS = [
  "DOWNLOAD",
  "HASH_MISMATCH",
  "MANIFEST_SIGNATURE",
  "PLATFORM_SIGNATURE",
  "DOWNGRADE",
  "EXPIRED",
  "ENV_MISMATCH",
  "INSTALL",
  "HEALTH",
] as const;
export type UpdateFailReason = (typeof UPDATE_FAIL_REASONS)[number];
/** `skipped` nedenleri (`MANUAL_ONLY`: macOS ad-hoc / `minUpdaterVersion`, D-5). */
export const UPDATE_SKIP_REASONS = ["POLICY_OFF", "NOT_WRITABLE", "MANUAL_ONLY"] as const;
export type UpdateSkipReason = (typeof UPDATE_SKIP_REASONS)[number];
export const UPDATE_REASONS = [...UPDATE_FAIL_REASONS, ...UPDATE_SKIP_REASONS] as const;
export type UpdateReason = UpdateFailReason | UpdateSkipReason;
/** AC-489 güvenlik nedenleri (`EXPIRED` saat kaymasıyla da oluşur → güvenlik nedeni DEĞİL, §14 Diğer). */
export const UPDATE_SECURITY_REASONS = [
  "MANIFEST_SIGNATURE",
  "PLATFORM_SIGNATURE",
  "DOWNGRADE",
  "HASH_MISMATCH",
  "ENV_MISMATCH",
] as const satisfies readonly UpdateFailReason[];
export type UpdateSecurityReason = (typeof UPDATE_SECURITY_REASONS)[number];
export const isUpdateSecurityReason = (r: string | null | undefined): r is UpdateSecurityReason =>
  (UPDATE_SECURITY_REASONS as readonly string[]).includes(r ?? "");

/**
 * Olayın kaynağı (r2 §14.4) — sunucu kimlik kanalından belirler, istemci BEYAN ETMEZ (olay şemasında alan yok → strict ret).
 * Metrik etiketi `source` ve audit `new_value.source`.
 */
export const UPDATE_EVENT_SOURCES = ["device", "binding", "anonymous"] as const;
export type UpdateEventSource = (typeof UPDATE_EVENT_SOURCES)[number];

/** Olay alanları (WS `update.event` aynı alanları `t` ile düz taşır; `ws-device.ts`). */
export const UPDATE_EVENT_SHAPE = {
  type: z.enum(UPDATE_EVENT_TYPES),
  version,
  fromVersion: version,
  reason: z.enum(UPDATE_REASONS).optional(),
  at: z.iso.datetime(),
};

/** `type` ↔ `reason` kuralı: available/installed nedensiz; failed/rolled_back `UPDATE_FAIL_REASONS`; skipped `UPDATE_SKIP_REASONS`. */
export function refineUpdateEvent(e: { type: UpdateEventType; reason?: UpdateReason | undefined }, ctx: z.RefinementCtx): void {
  const fail = (UPDATE_FAIL_REASONS as readonly string[]).includes(e.reason ?? "");
  const skip = (UPDATE_SKIP_REASONS as readonly string[]).includes(e.reason ?? "");
  const ok = e.type === "available" || e.type === "installed" ? e.reason === undefined : e.type === "skipped" ? skip : fail;
  if (!ok) ctx.addIssue({ code: "custom", path: ["reason"], message: "Olay türü ile neden uyuşmuyor" });
}

export const updateEventSchema = z.strictObject(UPDATE_EVENT_SHAPE).superRefine(refineUpdateEvent);
export type UpdateEvent = z.infer<typeof updateEventSchema>;

// ------------------------------------------------------------------------------------------- public uçlar (§4.2, §4.4, §4.5)

export const UPDATE_CHECK_PATH = "/api/v1/public/agent/update";
export const UPDATE_SERVICE_FILE_PATH = "/api/v1/public/agent/update/service-file";
export const UPDATE_EVENTS_PATH = "/api/v1/public/agent/update-events";

/** Politika (K-P29-7): `notify` = indirme/kurulum yok, yalnız `available` (+ `skipped(POLICY_OFF)`). */
export const UPDATE_POLICIES = ["auto", "notify"] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];

const platformArch = (m: { platform: UpdatePlatform; arch: UpdateArch }, ctx: z.RefinementCtx): void => {
  if (UPDATE_ARCH_BY_PLATFORM[m.platform] !== m.arch) {
    ctx.addIssue({ code: "custom", path: ["arch"], message: "Platform ile mimari uyuşmuyor" });
  }
};

/**
 * GET `UPDATE_CHECK_PATH` sorgusu (§4.2, r2 T-9). `component=service` 400 (servis WS kullanır). `ref` DESENDEN BAĞIMSIZ
 * kabul edilir — desen dışı/boş ref 400 DEĞİL, sunucu `auto` sayar (desen denetimi ve DB araması sunucuda).
 */
export const updateCheckQuerySchema = z
  .strictObject({
    platform: z.enum(UPDATE_PLATFORMS),
    arch: z.enum(UPDATE_ARCHES),
    component: z.literal("client"),
    ref: z.string().optional(),
  })
  .superRefine(platformArch);
export type UpdateCheckQuery = z.infer<typeof updateCheckQuerySchema>;

/** `manifest` = ham baytların standart base64'ü (dolgulu; ≤ 2048 bayt → ≤ 2732 karakter). Sunucu baytı değiştirmez. */
export const UPDATE_MANIFEST_B64_MAX = 2732;
export const updateManifestB64Schema = z
  .string()
  .max(UPDATE_MANIFEST_B64_MAX)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "Geçersiz base64")
  .min(4);

/** 200 yanıtı (§4.2) ve WS `update.offer`'ın gövdesi. Sunulabilir manifest yoksa 204 / `update.none`. */
export const updateOfferSchema = z.strictObject({
  manifest: updateManifestB64Schema,
  signature: z.string().regex(UPDATE_SIGNATURE_PATTERN),
  policy: z.enum(UPDATE_POLICIES),
});
export type UpdateOffer = z.infer<typeof updateOfferSchema>;

/** Olay gövdesi sınırları (§4.5, r2 T-5). */
export const UPDATE_EVENTS_BODY_MAX = 8 * 1024;
export const UPDATE_EVENTS_MAX = 20;
export const UPDATE_EVENTS_BINDING_KEYS_MAX = 5;

/**
 * POST `UPDATE_EVENTS_PATH` gövdesi (§4.5). Yanıt her durumda 204 (anahtar oracle'ı yok); biçim hatası 400 — doğrulama
 * mesajları DEĞER YANSITMAZ (T-12; buradaki özel mesajlar sabit metin). `bindingKeys` yalnız gövdede, loglanmaz.
 */
export const updateEventsInputSchema = z
  .strictObject({
    platform: z.enum(UPDATE_PLATFORMS),
    arch: z.enum(UPDATE_ARCHES),
    component: z.literal("client"),
    bindingKeys: z
      .array(z.string().regex(UPDATE_BINDING_KEY_PATTERN, "Geçersiz kayıt"))
      .min(1)
      .max(UPDATE_EVENTS_BINDING_KEYS_MAX)
      .optional(),
    events: z.array(updateEventSchema).min(1).max(UPDATE_EVENTS_MAX),
  })
  .superRefine(platformArch);
export type UpdateEventsInput = z.infer<typeof updateEventsInputSchema>;

/** Hız ve süre sınırları (§4.2–§4.5, §4.3, K-P29-12; sunucu ve Go aynı değerleri kullanır). */
export const UPDATE_LIMITS = {
  /** GET update: IP (IPv6 /64) başına istek/sa. */
  checkPerHourIp: 60,
  /** update-events: IP başına istek/sa ve olay/sa; kimlik (binding) başına olay/sa. */
  eventsRequestsPerHourIp: 10,
  eventsPerHourIp: 30,
  eventsPerHourIdentity: 10,
  /** WS: cihaz başına `update.check` / `update.token.request` / `update.event` (saatlik; fazlası yok sayılır). */
  deviceChecksPerHour: 4,
  deviceTokenRequestsPerHour: 4,
  deviceEventsPerHour: 10,
  /** Servis dosyası belirteci: ömür (sn), IP başına istek/dk, global eşzamanlı akış, aşımda `Retry-After` (sn). */
  serviceTokenTtlSec: 600,
  serviceFilePerMinIp: 20,
  serviceFileMaxStreams: 8,
  serviceFileRetryAfterSec: 300,
  /** `update.state{installing}` → hub "güncelleniyor" bayrağı (sn); bu sürede bağlantı 409 `DEVICE_UPDATING`. */
  deviceUpdatingTtlSec: 180,
  /** İstemci olay kuyruğu üst sınırı (K-P29-17). */
  queueMax: 20,
} as const;

// ------------------------------------------------------------------------------------------- ayar (§4.8, AC-485)

/** GET/PUT `/api/v1/settings/client-update` (PUT `settings.edit`, step-up yok; audit `settings.client_update` `{old,new}`). */
export const clientUpdateSettingsSchema = z.strictObject({ autoUpdate: z.boolean() });
export type ClientUpdateSettings = z.infer<typeof clientUpdateSettingsSchema>;
export const CLIENT_UPDATE_SETTINGS_PATH = "/api/v1/settings/client-update";

// ------------------------------------------------------------------------------------------- etiketler (AC-490, AC-491)

/** Neden etiketleri (panel rozeti "Güncelleme başarısız (<neden>)" ve audit ayrıntısı). Güvenlik nedenleri §4.7 metni. */
export const UPDATE_REASON_LABELS: Readonly<Record<UpdateReason, string>> = {
  DOWNLOAD: "indirme",
  HASH_MISMATCH: "bütünlük",
  MANIFEST_SIGNATURE: "imza",
  PLATFORM_SIGNATURE: "platform imzası",
  DOWNGRADE: "eski sürüm",
  EXPIRED: "süresi dolmuş",
  ENV_MISMATCH: "ortam",
  INSTALL: "kurulum",
  HEALTH: "sağlık denetimi",
  POLICY_OFF: "otomatik güncelleme kapalı",
  NOT_WRITABLE: "konum yazılamıyor",
  MANUAL_ONLY: "elle güncelleme gerekli",
};
/** AC-491: `failed` + güvenlik nedeni satırının etiketi `"Güncelleme reddedildi (<neden>)"`. */
export const UPDATE_REJECTED_LABEL = "Güncelleme reddedildi";
/** r2 §14.4: `binding` kaynaklı (istemci beyanı, doğrulanmamış) `failed` satırının öneki. */
export const UPDATE_CLIENT_REPORTED_PREFIX = "İstemci bildirdi: ";
