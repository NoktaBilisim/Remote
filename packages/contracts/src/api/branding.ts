// P12 marka ve kişiselleştirme sözleşmesi (AC-81..85, T16; mimari-api "Yönetim"/"Public"; db-notlari "P12").
// Yol kuralları DB CHECK'leriyle (tenants_logo_path_chk, users_avatar_path_chk, system_settings_system_logo_chk) birebir.
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------
// Tema (AC-85)
// ---------------------------------------------------------------------------------------------------------------

export const THEMES = ["LIGHT", "DARK", "SYSTEM"] as const;
export type ThemeValue = (typeof THEMES)[number];
export const themeSchema = z.enum(THEMES, { error: "Tema Açık, Koyu veya Sistem olmalı" });

/** PATCH /auth/me/preferences — 200 `PreferencesResponse` + `rs_theme` çerezi. */
export const preferencesInputSchema = z.strictObject({ theme: themeSchema });
export type PreferencesInput = z.infer<typeof preferencesInputSchema>;
export interface PreferencesResponse {
  theme: ThemeValue;
}

/**
 * Flaşsız tema çerezi: HttpOnly DEĞİL (istemci de okur), SameSite=Lax, production'da Secure, Path=/, 1 yıl.
 * Değer küçük harf `light|dark|system`. Login, tema değişikliği ve GET /auth/me yanıtında yazılır; çıkışta silinmez
 * (login ekranı son tercihe uyar).
 */
export const THEME_COOKIE = "rs_theme";
export const THEME_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;
export const THEME_COOKIE_VALUES = ["light", "dark", "system"] as const;
export type ThemeCookieValue = (typeof THEME_COOKIE_VALUES)[number];
export const themeCookieValue = (t: ThemeValue): ThemeCookieValue => t.toLowerCase() as ThemeCookieValue;

// ---------------------------------------------------------------------------------------------------------------
// Yükleme (AC-81, 83, 84)
// ---------------------------------------------------------------------------------------------------------------

/** multipart/form-data, tek dosya alanı `file`. */
export const UPLOAD_FIELD = "file";
/** 2 MB; aşan istek 413 `PAYLOAD_TOO_LARGE`. */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** Kabul edilen türler (içerikten, magic bytes); SVG asla. Aksi 400 `INVALID_IMAGE`. */
export const UPLOAD_ACCEPT = ["image/png", "image/jpeg", "image/webp"] as const;
/** Logo PNG'ye çevrilir, oran korunarak en çok 512 px'e sığdırılır (büyütülmez). */
export const LOGO_MAX_PX = 512;
/** Avatar WEBP 256×256 kare (sunucu ortadan kırpar). */
export const AVATAR_PX = 256;
/** Kullanıcı başına yükleme sınırı (logo + avatar + sistem logosu ortak kova); aşım 429. */
export const UPLOADS_PER_HOUR = 20;

/** Her kenar en az bu kadar piksel (B-P12-2: 1×N/N×1 şeritler reddedilir). */
export const IMAGE_MIN_EDGE_PX = 16;
/** En-boy oranı üst sınırı (uzun kenar / kısa kenar): logo yatay şerit olabilir, avatar ortadan kare kırpılır. */
export const LOGO_MAX_ASPECT = 20;
export const AVATAR_MAX_ASPECT = 4;

export const INVALID_IMAGE_MESSAGE = "Yalnız PNG, JPG veya WEBP resim yükleyebilirsiniz.";
/** Boyut/oran ihlali de `INVALID_IMAGE` (400) döner; mesaj ayrıntılıdır. */
export const IMAGE_DIMENSIONS_MESSAGE = `Resim boyutları uygun değil: her kenar en az ${IMAGE_MIN_EDGE_PX} px, en-boy oranı logoda en çok ${LOGO_MAX_ASPECT}:1, profil resminde en çok ${AVATAR_MAX_ASPECT}:1 olmalı.`;
/** Resim işleme kuyruğu dolu → 429 `RATE_LIMITED` (Retry-After). */
export const IMAGE_BUSY_MESSAGE = "Sunucu şu an başka resimleri işliyor. Lütfen birkaç saniye sonra tekrar deneyin.";
export const PAYLOAD_TOO_LARGE_MESSAGE = "Dosya en çok 2 MB olabilir.";

// ---------------------------------------------------------------------------------------------------------------
// Dosya yolu / URL (DB'deki göreli yol: `{öndek}/{ad}.{uzantı}`)
// ---------------------------------------------------------------------------------------------------------------

export const UPLOAD_NAME_RE = /^[A-Za-z0-9_-]{16,100}\.(png|jpg|webp)$/;
export const TENANT_PREFIX_RE = /^[0-9A-Z]{26}$/;
export const SYSTEM_PREFIX = "system";
/** `tenants_logo_path_chk` (öndek = tenant id). */
export const logoPathSchema = (tenantId: string) =>
  z
    .string()
    .max(200)
    .regex(/^[0-9A-Z]{26}\/[A-Za-z0-9_-]{16,100}\.(png|jpg|webp)$/)
    .refine((p) => p.split("/")[0] === tenantId);
/** `users_avatar_path_chk` (öndek = tenant id, Super Admin → `system`). */
export const avatarPathSchema = (tenantId: string | null) =>
  z
    .string()
    .max(200)
    .regex(/^([0-9A-Z]{26}|system)\/[A-Za-z0-9_-]{16,100}\.(png|jpg|webp)$/)
    .refine((p) => p.split("/")[0] === (tenantId ?? SYSTEM_PREFIX));
/**
 * `system_settings_system_logo_chk` value_json `{ path }`. P15 (AC-233, V31): kaldırma `{ path: null }` yazar (app'e
 * DELETE yetkisi yok) — okuyucu null'ı "satır yok" gibi ele alır (varsayılan Nokta logosu).
 */
export const systemLogoValueSchema = z.strictObject({
  path: z
    .string()
    .max(200)
    .regex(/^system\/[A-Za-z0-9_-]{16,100}\.(png|jpg|webp)$/)
    .nullable(),
});

/** Logo / sistem logosu herkese açık (login, müşteri sayfası, e-posta); avatar oturumlu (aynı tenant veya Super Admin). */
export const FILES_BASE = "/api/v1/files";
export const DEFAULT_LOGO_URL = "/img/logo.png";
export const logoFileUrl = (path: string): string => `${FILES_BASE}/logo/${path}`;
export const systemLogoFileUrl = (path: string): string => `${FILES_BASE}/system-logo/${path.slice(SYSTEM_PREFIX.length + 1)}`;
export const avatarFileUrl = (path: string): string => `${FILES_BASE}/avatar/${path}`;

// ---------------------------------------------------------------------------------------------------------------
// Yanıtlar
// ---------------------------------------------------------------------------------------------------------------

/** POST/DELETE /settings/logo (settings.edit; Super Admin seçili firma). Kaldırınca null (UI sistem logosuna düşer). */
export interface LogoResponse {
  logoUrl: string | null;
}
/** POST/DELETE /users/:id/avatar (`me` dahil). null → baş harf rozeti. */
export interface AvatarResponse {
  avatarUrl: string | null;
}
/**
 * POST /admin/settings/system-logo (SUPER_ADMIN). P15 (AC-233): DELETE /admin/settings/system-logo aynı yanıtı döner
 * (`logoUrl` = `DEFAULT_LOGO_URL`); kayıt yokken DELETE 200 ve audit yazmaz.
 */
export interface SystemLogoResponse {
  logoUrl: string;
}
/**
 * GET /public/branding?tenant=<slug>. Slug yok/geçersiz/pasif → `name: null` + sistem logosu (yoksa `/img/logo.png`).
 * Yanıt biçimi her durumda aynı; 60/dk/IP.
 */
export interface PublicBrandingResponse {
  name: string | null;
  logoUrl: string;
}
export const publicBrandingQuerySchema = z.object({ tenant: z.string().max(200).optional() });
