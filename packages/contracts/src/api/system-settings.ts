// P11 sistem ayarları (SUPER_ADMIN; mimari-api "Yönetim", ADR-0003; AC-77, AC-78) ve tenant aydınlatma metni
// düzenleme (settings.view/edit; AC-29). Kurallar DB CHECK'leriyle birebir (db-notlari "P11" system_settings).
import { z } from "zod";
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
