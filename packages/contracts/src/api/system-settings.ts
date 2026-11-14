// P11 sistem ayarları (SUPER_ADMIN; mimari-api "Yönetim", ADR-0003; AC-77, AC-78) ve tenant aydınlatma metni
// düzenleme (settings.view/edit; AC-29). Kurallar DB CHECK'leriyle birebir (db-notlari "P11" system_settings).
import { z } from "zod";
import { phoneSchema } from "./requests.ts";
import { smtpHostSchema } from "./tenants.ts";

const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const blankToUndefined = (v: unknown) => (typeof v === "string" && v === "" ? undefined : v);

// ---------------------------------------------------------------------------------------------------------------
// MySQL — GET/PUT /admin/settings/mysql, POST /admin/settings/mysql/test
// ---------------------------------------------------------------------------------------------------------------

export const MYSQL_DEFAULT_PORT = 3306;
/** Test bağlantısının kesin üst süresi (AC-77). */
export const MYSQL_TEST_TIMEOUT_MS = 10_000;

/**
 * `system_settings_mysql_chk` ile aynı: host = SMTP host kuralı (ASCII ad / IPv4 / [IPv6], IDN → punycode, küçük harf);
 * port 1..65535 tamsayı; database `[A-Za-z0-9_$-]{1,64}`; user 1..32, kontrol/biçim karakteri yok.
 * `password`: boş/verilmemiş → kayıtlı şifre korunur (AC-78); en çok 200.
 */
export const mysqlSettingsInputSchema = z.strictObject({
  host: smtpHostSchema,
  port: z.number({ error: "Port 1-65535 arası olmalı" }).int("Port 1-65535 arası olmalı").min(1, "Port 1-65535 arası olmalı").max(65535, "Port 1-65535 arası olmalı").default(MYSQL_DEFAULT_PORT),
  database: z.string().trim().regex(/^[A-Za-z0-9_$-]{1,64}$/, "Veritabanı adı 1-64 karakter; harf, rakam, _ $ - içerebilir"),
  user: z
    .string()
    .trim()
    .min(1, "Kullanıcı adı gerekli")
    .max(32, "Kullanıcı adı en çok 32 karakter olabilir")
    .refine((v) => !CONTROL_CHARS.test(v), "Kullanıcı adı kontrol karakteri içeremez"),
  password: z.preprocess(blankToUndefined, z.string().max(200, "Şifre en çok 200 karakter olabilir").optional()),
});
export type MysqlSettingsInput = z.input<typeof mysqlSettingsInputSchema>;
export type MysqlSettingsData = z.output<typeof mysqlSettingsInputSchema>;

/** Panel kaydı yoksa `source: "env"` ve alanlar çalışan `DATABASE_URL`'den türetilir. Şifre asla dönmez. */
export interface MysqlSettingsView {
  host: string;
  port: number;
  database: string;
  user: string;
  hasPassword: boolean;
  updatedAt: string | null;
  source: "panel" | "env";
  /** host/port/database/user çalışan bağlantıyla (DATABASE_URL) aynı mı. false → .env güncellenip yeniden başlatılmalı. */
  matchesRunning: boolean;
}

/** ADR-0003: canlı geçiş yok — kayıt bilgi amaçlıdır. */
export const MYSQL_APPLY_NOTE = "Ayar kaydedildi. Uygulamak için sunucudaki .env (DATABASE_URL) güncellenip servis yeniden başlatılmalıdır.";

export interface MysqlSettingsSaveResponse extends MysqlSettingsView {
  restartRequired: true;
  message: string;
}

export const MYSQL_TEST_REASONS = ["connect", "auth", "database", "timeout", "secret_unreadable"] as const;
export type MysqlTestReason = (typeof MYSQL_TEST_REASONS)[number];

/** Sınıflandırılmış genel mesajlar (ham sürücü hatası yalnız server logunda). */
export const MYSQL_TEST_MESSAGES: Readonly<Record<MysqlTestReason | "ok", string>> = {
  ok: "Bağlantı başarılı.",
  connect: "Sunucuya bağlanılamadı.",
  auth: "Kimlik reddedildi (kullanıcı adı veya şifre hatalı).",
  database: "Veritabanı bulunamadı veya bu kullanıcının erişimi yok.",
  timeout: "Bağlantı 10 saniye içinde kurulamadı (zaman aşımı).",
  secret_unreadable: "Kayıtlı şifre okunamadı; şifreyi yeniden girin.",
};

/**
 * Kayıtlı/env şifresi yalnız aynı host + port + kullanıcı için kullanılır (şifre başka sunucuya gönderilmez). PUT'ta da:
 * kayıtlı şifre varken hedef değişiyorsa şifre zorunlu (B-P11-1).
 */
export const MYSQL_PASSWORD_REQUIRED_MESSAGE = "Farklı sunucu veya kullanıcı için şifreyi girin";

/**
 * 200 `{ ok:false }` = bağlantı denendi ve başarısız (AC-77); 429 = 5/dk/kullanıcı veya 20/dk global sınır.
 * `latencyMs` yalnız başarıda; başarısızlıkta null (B-P11-4: süre, port tarama sinyali vermesin).
 */
export interface MysqlTestResponse {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

// ---------------------------------------------------------------------------------------------------------------
// TURN — GET/PUT/DELETE /admin/settings/turn (G-13)
// ---------------------------------------------------------------------------------------------------------------

export const TURN_URLS_MAX = 10;
export const TURN_SECRET_REQUIRED_MESSAGE = "turn:/turns: adresi için gizli anahtar gerekli";

/** `system_settings_turn_chk`: `stun:|turn:|turns:` + boşluksuz yazdırılabilir ASCII, 6..255. */
export const turnUrlSchema = z
  .string()
  .trim()
  .min(6, "Adres en az 6 karakter olmalı")
  .max(255, "Adres en çok 255 karakter olabilir")
  .regex(/^(stun|turn|turns):[!-~]+$/, "Adres stun:, turn: veya turns: ile başlamalı ve boşluk içermemeli");

/**
 * PUT gövdesi. DELETE = panel kaydını kaldır → env'e dön (DB'de satır kalır, `{urls: []}` + secret NULL = "panel yok";
 * app kullanıcısında system_settings DELETE yetkisi yok — db-notlari P11). Bu yüzden PUT'ta en az 1 adres.
 * coturn `static-auth-secret`: 32..256 yazdırılabilir ASCII (env TURN_SECRET ≥ 32 kuralı). Boş → kayıtlı korunur. */
export const turnSettingsInputSchema = z
  .strictObject({
    urls: z.array(turnUrlSchema).min(1, "En az bir adres girin (env ayarına dönmek için \"Varsayılana dön\")").max(TURN_URLS_MAX, `En çok ${TURN_URLS_MAX} adres girilebilir`),
    secret: z.preprocess(
      blankToUndefined,
      z
        .string()
        .min(32, "Gizli anahtar en az 32 karakter olmalı")
        .max(256, "Gizli anahtar en çok 256 karakter olabilir")
        // coturn `static-auth-secret` yapılandırma satırı: boşluk ve `#` (yorum başlangıcı) kesilir → ikisi de yasak.
        .regex(/^[!"$-~]+$/, "Gizli anahtar boşluk ve # içermeyen ASCII olmalı")
        .optional(),
    ),
  })
  .superRefine((o, ctx) => {
    if (new Set(o.urls).size !== o.urls.length) ctx.addIssue({ code: "custom", path: ["urls"], message: "Aynı adres birden çok kez girilmiş" });
  });
export type TurnSettingsInput = z.input<typeof turnSettingsInputSchema>;
export type TurnSettingsData = z.output<typeof turnSettingsInputSchema>;

/** Panel kaydı yoksa env (`TURN_URLS`/`TURN_SECRET`). Secret asla dönmez. */
export interface TurnSettingsView {
  urls: string[];
  hasSecret: boolean;
  source: "panel" | "env";
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// WhatsApp servisi — GET/PUT/DELETE /admin/settings/whatsapp, POST /admin/settings/whatsapp/test (P12b; AC-196)
// ---------------------------------------------------------------------------------------------------------------

export const WA_URL_MAX = 200;
export const WA_URL_MESSAGE = "Adres http:// veya https:// ile başlamalı; kullanıcı adı/şifre, ? ve # içeremez (en çok 200 karakter)";
/**
 * `system_settings_whatsapp_chk` ile birebir (P13a, B-P12b-4: + `\p{Cf}\p{Zl}\p{Zp}`; ICU `\z` ↔ JS `$` bayraksız: sondaki
 * `\n` kabul edilmez). Saklanan (kanonik) değere uygulanır.
 */
const WA_URL_RE = /^https?:\/\/[^@?#\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u;
/** Girdi: aynı küme, yalnız şema harf duyarsız (`HTTPS://…` reddedilmez, kanonikleşir). */
const WA_URL_INPUT_RE = /^https?:\/\/[^@?#\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/iu;
/** WHATWG URL (tarayıcı + Node global); contracts lib'inde DOM tipi yok (tenants.ts kalıbı). */
const UrlCtor = (globalThis as unknown as { URL: new (u: string) => { hostname: string; href: string } }).URL;
/** Uzunluk kod noktası ile (DB JSON şeması `maxLength` karakter sayar). */
const cpLength = (v: string): number => [...v].length;

/**
 * P13a (mimari-p13 §3): WHATWG kanonik biçim — şema/host küçük harf, ondalık/onaltılı IPv4 noktalı, IDN punycode,
 * varsayılan port atılır; sondaki `/` kırpılır (istek `{url}/test-send`, `{url}/send-message`). Kurala uymazsa null.
 */
export function canonicalWaUrl(v: string): string | null {
  if (cpLength(v) > WA_URL_MAX || !WA_URL_INPUT_RE.test(v)) return null;
  let href: string;
  try {
    const u = new UrlCtor(v);
    if (u.hostname === "") return null;
    href = u.href;
  } catch {
    return null;
  }
  const out = href.replace(/\/+$/, "");
  return WA_URL_RE.test(out) && cpLength(out) <= WA_URL_MAX ? out : null;
}

/** Panel adresi (ve env `WHATSAPP_SERVICE_URL`): doğrulanır ve kanonik biçimde döner. */
export const waServiceUrlSchema = z
  .string({ error: WA_URL_MESSAGE })
  .refine((v) => canonicalWaUrl(v) !== null, WA_URL_MESSAGE)
  .transform((v) => canonicalWaUrl(v) ?? v);

/** S-P13b-3: servis anahtarı (`x-api-key`) uzunluk sınırları; kontrol karakteri ve boşluk yok. */
export const WA_API_KEY_MIN = 16;
export const WA_API_KEY_MAX = 256;
export const WA_API_KEY_MESSAGE = `Servis anahtarı ${WA_API_KEY_MIN}–${WA_API_KEY_MAX} karakter olmalı; yalnız boşluksuz yazdırılabilir ASCII (Türkçe karakter, boşluk ve kontrol karakteri yok).`;
/** S-P13b-9: yalnız yazdırılabilir ASCII (0x21–0x7E) — HTTP başlık değerine güvenle girer (CR/LF, Unicode, boşluk yok). */
const WA_API_KEY_RE = /^[\x21-\x7E]{16,256}$/;

/** Anahtar değeri (env `WHATSAPP_SERVICE_API_KEY` ve panel; aynı şema). */
export const waApiKeySchema = z.string({ error: WA_API_KEY_MESSAGE }).regex(WA_API_KEY_RE, WA_API_KEY_MESSAGE);

/**
 * PUT gövdesi. Kaldırma (env'e dönüş) DELETE ile (anahtar da silinir).
 * `apiKey` (S-P13b-3): yok / `""` → mevcut panel anahtarı korunur; `null` → panel anahtarı silinir; dolu → yeni anahtar
 * (şifreli saklanır, hiçbir yanıtta dönmez). Adresin kökeni (şema+host+port) değişirken anahtar verilmezse 400 VALIDATION
 * `fields.apiKey` = `WA_API_KEY_REENTER` (kayıtlı anahtar eski adrese bağlıdır, yeni adrese gönderilmez).
 */
export const whatsappSettingsInputSchema = z.strictObject({
  url: waServiceUrlSchema,
  apiKey: z.union([z.literal(""), z.null(), waApiKeySchema]).optional(),
});
export type WhatsappSettingsInput = z.input<typeof whatsappSettingsInputSchema>;
export type WhatsappSettingsData = z.output<typeof whatsappSettingsInputSchema>;

/**
 * `url` = etkin adres (panel kaydı, yoksa `WHATSAPP_SERVICE_URL`; o da yoksa null). `insecure` = production + `http://` +
 * özel ağ dışı host → kanal kapalı (AC-150, K13); ekranda `WA_INSECURE_WARNING`. Tenant uçları adresi asla döndürmez.
 */
export interface WhatsappSettingsView {
  url: string | null;
  source: "panel" | "env";
  insecure: boolean;
  updatedAt: string | null;
  /** S-P13b-3: etkin adresle gönderilecek anahtar var mı (değer asla dönmez). */
  apiKeySet: boolean;
  /**
   * Anahtarın kaynağı; yoksa null. Anahtar adresiyle birlikte gelir: panel adresi → yalnız panel anahtarı, env adresi →
   * yalnız `WHATSAPP_SERVICE_API_KEY` (env anahtarı panelde girilen başka bir adrese gönderilmez).
   */
  apiKeySource: "panel" | "env" | null;
}

export const WA_API_KEY_REENTER = "Servis adresi değişti; servis anahtarını yeniden girin (ya da anahtarı kaldırın).";

export const WA_INSECURE_WARNING = "Güvensiz adres: canlı ortamda WhatsApp kanalı kapalı";

/** POST /admin/settings/whatsapp/test. Numara E.164 / `90…` (servise `90…` biçiminde gider). */
export const whatsappAdminTestInputSchema = z.strictObject({ phoneNumber: phoneSchema });
export type WhatsappAdminTestInput = z.input<typeof whatsappAdminTestInputSchema>;

export const WA_TEST_REASONS = ["unconfigured", "insecure", "timeout", "http_error", "redirect", "unreachable", "unauthorized"] as const;
export type WhatsappTestReason = (typeof WA_TEST_REASONS)[number];

/** Sabit mesajlar (servis yanıt gövdesi/iç hata ayrıntısı/adres kullanıcıya yansıtılmaz; ayrıntı yalnız sunucu logunda). */
export const WA_TEST_MESSAGES: Readonly<Record<WhatsappTestReason | "ok", string>> = {
  ok: "Test mesajı gönderildi.",
  unconfigured: "Servis yapılandırılmamış.",
  insecure: "Servis güvenli yapılandırılmamış.",
  timeout: "Servis 8 saniye içinde yanıt vermedi (zaman aşımı).",
  http_error: "Servise ulaşılamadı veya servis hata döndürdü.",
  redirect: "Servise ulaşılamadı veya servis hata döndürdü.",
  unreachable: "Servise ulaşılamadı veya servis hata döndürdü.",
  /** S-P13b-3: servis 401 döndü (anahtar yok/yanlış). */
  unauthorized: "Servis anahtarı reddetti.",
};

/** 200 `{ ok:false }` = denendi/denenemedi ve başarısız; 429 = 5/dk/kullanıcı (6. → 429). */
export interface WhatsappAdminTestResponse {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Aydınlatma metni — GET/PUT /settings/consent-text (etkin tenant; AC-29, AC-127)
// ---------------------------------------------------------------------------------------------------------------

export const CONSENT_BODY_MIN = 50;
export const CONSENT_BODY_MAX = 20_000;
export const CONSENT_VERSIONS_MAX = 100;
/** Gövdede yasak: satır sonu/sekme dışı kontrol karakteri, bidi ve sıfır genişlikli karakterler. */
const UNSAFE_BODY_CHARS = /(?![\n\t])\p{Cc}|[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/** CRLF/CR → LF, uçlar kırpılır; uzunluk kod noktası. Değişmeyen gövde yeni sürüm üretmez (`changed: false`). */
export const consentTextInputSchema = z.strictObject({
  body: z
    .string()
    .max(CONSENT_BODY_MAX * 4, `Metin en çok ${CONSENT_BODY_MAX} karakter olabilir`)
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .refine((v) => !UNSAFE_BODY_CHARS.test(v), "Metin görünmez veya kontrol karakteri içeremez")
    .refine((v) => [...v].length >= CONSENT_BODY_MIN, `Metin en az ${CONSENT_BODY_MIN} karakter olmalı`)
    .refine((v) => [...v].length <= CONSENT_BODY_MAX, `Metin en çok ${CONSENT_BODY_MAX} karakter olabilir`),
});
export type ConsentTextInput = z.input<typeof consentTextInputSchema>;

export interface ConsentTextVersion {
  id: string;
  version: number;
  sha256: string;
  createdAt: string;
  /** null = sistem metni (seed / firma oluşturma). */
  createdByName: string | null;
}

export interface ConsentTextSettings {
  current: (ConsentTextVersion & { body: string }) | null;
  /** Yeniden eskiye, en çok `CONSENT_VERSIONS_MAX`. */
  versions: ConsentTextVersion[];
}

/** PUT yanıtı: `changed:false` → gövde güncel sürümle aynı, yeni sürüm oluşturulmadı (çift gönderim güvenli). */
export interface ConsentTextSaveResponse extends ConsentTextSettings {
  changed: boolean;
}
