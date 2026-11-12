// P9: Super Admin firma (tenant) yönetimi + firma geçişi + tenant ayarları sözleşmesi (mimari-api "Yönetim";
// AC-70, AC-4). `/admin/*` yalnız SUPER_ADMIN (rol kontrolü, toggle değil); `/settings/tenant` settings.view/edit.
import { z } from "zod";
import type { TenantRef } from "./auth.ts";
import { UNSAFE_NAME_CHARS } from "./sessions.ts";

// ---------------------------------------------------------------------------------------------------------------
// Firmalar (Super Admin)
// ---------------------------------------------------------------------------------------------------------------

export const TENANT_STATUSES = ["ACTIVE", "PASSIVE"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];
export const TENANT_STATUS_FILTERS = ["active", "passive", "all"] as const;
export type TenantStatusFilter = (typeof TENANT_STATUS_FILTERS)[number];

export const TENANT_NAME_MIN = 2;
export const TENANT_NAME_MAX = 120;
export const TENANT_SLUG_MIN = 2;
export const TENANT_SLUG_MAX = 60;
export const TENANT_PAGE_SIZE_DEFAULT = 25;
export const TENANT_PAGE_SIZE_MAX = 100;

/** 409 `fields.slug`. */
export const TENANT_SLUG_CONFLICT_MESSAGE = "Bu kısa ad başka bir firmada kullanılıyor";

const codePoints = (v: string): number => [...v].length;

export const tenantNameSchema = z
  .string()
  .max(500, `Firma adı en çok ${TENANT_NAME_MAX} karakter olabilir`)
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Firma adı görünmez veya kontrol karakteri içeremez")
  .trim()
  .refine((v) => codePoints(v) >= TENANT_NAME_MIN, `Firma adı en az ${TENANT_NAME_MIN} karakter olmalı`)
  .refine((v) => codePoints(v) <= TENANT_NAME_MAX, `Firma adı en çok ${TENANT_NAME_MAX} karakter olabilir`);

/** Kısa ad (giriş `tenantSlug` ve URL'de): küçük harf, rakam, tek tire; tireyle başlayıp bitmez; 2..60. */
export const tenantSlugSchema = z
  .string()
  .trim()
  .min(TENANT_SLUG_MIN, `Kısa ad en az ${TENANT_SLUG_MIN} karakter olmalı`)
  .max(TENANT_SLUG_MAX, `Kısa ad en çok ${TENANT_SLUG_MAX} karakter olabilir`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Kısa ad yalnız küçük harf, rakam ve tire içerebilir");

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const tenantIdSchema = z.string().regex(ULID, "Geçersiz kimlik");

/**
 * POST /admin/tenants (AC-70). Firma ayarları varsayılanlarla ve sistem aydınlatma metni v1 ile aynı TX'te oluşur.
 * İlk Admin, Super Admin firmaya geçip `/users` ile oluşturur. Oluşturmadan önce firma doğrulaması: runbook.
 */
export const createTenantInputSchema = z.strictObject({ name: tenantNameSchema, slug: tenantSlugSchema });
export type CreateTenantInput = z.input<typeof createTenantInputSchema>;
export type CreateTenantData = z.output<typeof createTenantInputSchema>;

/** PATCH /admin/tenants/:id — ad ve/veya kısa ad (en az biri). Durum yalnız deactivate/reactivate uçlarıyla. */
export const updateTenantInputSchema = z
  .strictObject({ name: tenantNameSchema.optional(), slug: tenantSlugSchema.optional() })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "Değiştirilecek alan yok", path: ["_"] });
export type UpdateTenantInput = z.input<typeof updateTenantInputSchema>;
export type UpdateTenantData = z.output<typeof updateTenantInputSchema>;

/** POST /admin/tenants/:id/deactivate | reactivate — gövde `{}` veya boş. */
export const tenantActionInputSchema = z.strictObject({});

/** GET /admin/tenants: `q` ad veya kısa adda içerir; vars. tüm durumlar, ada göre; sayfalı, üst 100. */
export const listTenantsQuerySchema = z.strictObject({
  q: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .max(400, "Arama en çok 100 karakter olabilir")
      .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Görünmez veya kontrol karakteri içeremez")
      .trim()
      .refine((v) => codePoints(v) <= 100, "Arama en çok 100 karakter olabilir")
      .optional(),
  ),
  status: z.enum(TENANT_STATUS_FILTERS).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(TENANT_PAGE_SIZE_MAX).default(TENANT_PAGE_SIZE_DEFAULT),
});
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;

/**
 * POST /admin/switch-tenant (AC-70): `tenantId` → o firmanın bağlamına geç (yalnız ACTIVE firma; değilse 404);
 * `null` → firma bağlamından çık. Mevcut oturuma yazılır (`auth_sessions.acting_tenant_id`), audit `tenant.switched`.
 * Eski bağlamın `/ws/panel` soketleri 4401 ile kapanır (yeni bağlamla yeniden bağlanılır).
 */
export const switchTenantInputSchema = z.strictObject({ tenantId: tenantIdSchema.nullable() });
export type SwitchTenantInput = z.infer<typeof switchTenantInputSchema>;

export interface TenantItem {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  /** Aktif (pasif olmayan) kullanıcı sayısı. */
  activeUserCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenantListResponse {
  items: TenantItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SwitchTenantResponse {
  actingTenant: TenantRef | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Tenant ayarları — GET/PUT /settings/tenant (settings.view / settings.edit; AC-4)
// P10: `requireTech2fa` ve `smtp` (netguard, şifre forma geri yazılmaz, boş = korunur).
// Aralıklar DB CHECK'leriyle aynı (tenant_settings_*_chk).
// ---------------------------------------------------------------------------------------------------------------

export const TENANT_SETTINGS_LIMITS = {
  sessionTtlMin: { min: 15, max: 30 },
  maxOpenSessions: { min: 1, max: 10 },
  maxActiveHours: { min: 1, max: 8 },
  maxFileMb: { min: 1, max: 2048 },
  retentionDays: { min: 90, max: 730 },
} as const;

const range = (k: keyof typeof TENANT_SETTINGS_LIMITS) => {
  const { min, max } = TENANT_SETTINGS_LIMITS[k];
  const msg = `${min}-${max} arası olmalı`;
  return z.number({ error: msg }).int(msg).min(min, msg).max(max, msg);
};

// ---------------------------------------------------------------------------------------------------------------
// P10 — SMTP (AC-78, 79, 80, 122) ve 2FA zorunluluğu (AC-67)
// ---------------------------------------------------------------------------------------------------------------

export const SMTP_SECURITIES = ["NONE", "SSL", "STARTTLS"] as const;
export type SmtpSecurity = (typeof SMTP_SECURITIES)[number];
/** AC-79: güvenlik seçimine göre önerilen port (UI önerir; kullanıcı değiştirebilir). */
export const SMTP_DEFAULT_PORTS: Record<SmtpSecurity, number> = { NONE: 25, SSL: 465, STARTTLS: 587 };
/**
 * B-P10-1 (SSRF/port taraması): yalnız SMTP portları. Sunucu gönderimde de denetler (DB'de eski/elle değişmiş değer).
 * DB CHECK'i 1–65535 kalır; kısıt uygulama katmanında (sözleşme + mail/service.ts).
 */
export const SMTP_ALLOWED_PORTS = [25, 465, 587, 2525] as const;
export const SMTP_PORT_MESSAGE = "Port 25, 465, 587 veya 2525 olmalı";
/** B-P10-5: güvenlik "Yok" iken kimlik bilgisi düz metin gider → reddedilir (alan hatası `smtp.security`). */
export const SMTP_INSECURE_AUTH_MESSAGE = "Kullanıcı adı/şifre için SSL veya STARTTLS seçin (şifresiz bağlantıda kimlik bilgisi açık gider)";
/** AC-122: kayıt/test ret mesajı — genel (hangi aralığa düştüğü söylenmez). */
export const SMTP_HOST_NOT_ALLOWED_MESSAGE = "Bu sunucu adresi kullanılamaz.";

/** WHATWG URL (tarayıcı + Node global); contracts lib'inde DOM tipi yok. IDN → punycode için. */
const UrlCtor = (globalThis as unknown as { URL: new (u: string) => { hostname: string } }).URL;
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/**
 * Sunucu adı: trim + küçük harf; IDN → punycode (`new URL` ile, tarayıcı ve Node'da aynı). Kabul: ASCII ad, IPv4,
 * köşeli parantezli IPv6 (DB `tenant_settings_smtp_host_chk`). Özel/loopback hedef kontrolü sunucuda (netguard).
 */
export const smtpHostSchema = z
  .string()
  .trim()
  .min(1, "Sunucu adresi gerekli")
  .max(253, "Sunucu adresi en çok 253 karakter olabilir")
  .transform((v, ctx) => {
    const bracketed = /^\[[0-9A-Fa-f:.]+\]$/.test(v);
    if (!bracketed && /[\s/:?#@\\[\]%]/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Sunucu adresi geçersiz" });
      return z.NEVER;
    }
    try {
      return new UrlCtor(`http://${v}`).hostname;
    } catch {
      ctx.addIssue({ code: "custom", message: "Sunucu adresi geçersiz" });
      return z.NEVER;
    }
  })
  .refine((v) => v.length <= 253 && /^([a-z0-9.-]+|\[[0-9a-f:.]+\])$/.test(v), "Sunucu adresi geçersiz");

const smtpUserSchema = z.preprocess(
  blankToNull,
  z.string().trim().max(190, "Kullanıcı adı en çok 190 karakter olabilir").refine((v) => !CONTROL_CHARS.test(v), "Kullanıcı adı kontrol karakteri içeremez").nullable(),
);
const smtpFromNameSchema = z.preprocess(
  blankToNull,
  z.string().trim().max(100, "Gönderen adı en çok 100 karakter olabilir").refine((v) => !CONTROL_CHARS.test(v), "Gönderen adı kontrol karakteri içeremez").nullable(),
);

/**
 * PUT /settings/tenant `smtp` nesnesi. `password`: boş/verilmemiş → kayıtlı şifre korunur (AC-78); `user` boşsa şifre
 * de silinir (kimliksiz SMTP). Şifre kullanıcı adı olmadan verilemez. `smtp: null` → SMTP ayarı tamamen kaldırılır.
 */
export const smtpSettingsInputSchema = z
  .strictObject({
    host: smtpHostSchema,
    port: z.number({ error: SMTP_PORT_MESSAGE }).int(SMTP_PORT_MESSAGE).refine((p) => (SMTP_ALLOWED_PORTS as readonly number[]).includes(p), SMTP_PORT_MESSAGE),
    security: z.enum(SMTP_SECURITIES, { error: "Güvenlik seçimi geçersiz" }),
    user: smtpUserSchema.optional().transform((v) => v ?? null),
    password: z.string().max(200, "Şifre en çok 200 karakter olabilir").optional().transform((v) => (v ? v : undefined)),
    fromName: smtpFromNameSchema.optional().transform((v) => v ?? null),
    fromEmail: z.string().trim().toLowerCase().max(190, "E-posta en çok 190 karakter olabilir").pipe(z.email("E-posta adresi geçersiz")),
  })
  .superRefine((s, ctx) => {
    if (s.password !== undefined && s.user === null) ctx.addIssue({ code: "custom", path: ["user"], message: "Şifre için kullanıcı adı gerekli" });
    if (s.security === "NONE" && (s.user !== null || s.password !== undefined)) ctx.addIssue({ code: "custom", path: ["security"], message: SMTP_INSECURE_AUTH_MESSAGE });
  });
export type SmtpSettingsInput = z.input<typeof smtpSettingsInputSchema>;
export type SmtpSettingsData = z.output<typeof smtpSettingsInputSchema>;

/** GET görünümü: şifre asla dönmez (AC-78), yalnız `hasPassword`. */
export interface SmtpSettingsView {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string | null;
  fromName: string | null;
  fromEmail: string;
  hasPassword: boolean;
}

/** POST /settings/smtp/test (AC-80, 122): 5/dk/tenant; başarı 200, gönderim hatası 502 `UPSTREAM` (genel mesaj). */
export const smtpTestInputSchema = z.strictObject({
  to: z.string().trim().max(254, "E-posta en çok 254 karakter olabilir").pipe(z.email("E-posta adresi geçersiz")),
});
export type SmtpTestInput = z.input<typeof smtpTestInputSchema>;
export interface SmtpTestResponse {
  ok: true;
  message: string;
}
/**
 * B-P10-1: gönderim hatasında kullanıcıya dönen TEK genel mesaj (502 `UPSTREAM` / kanal testi `ok:false`). Hata sınıfı
 * (bağlantı/TLS/kimlik/ret) yalnız sunucu logunda ve audit'te; yanıt süresi de sabit tabana çekilir (port tarama kâhini yok).
 */
export const SMTP_SEND_FAILED_MESSAGE = "E-posta gönderilemedi. Sunucu, port, güvenlik ve kimlik bilgilerini kontrol edin.";

/** PUT gövdesi: alanlar opsiyonel (verilen değişir), en az biri. Aralık dışı → 400 `fields.<alan>` (AC-4). */
export const updateTenantSettingsInputSchema = z
  .strictObject({
    sessionTtlMin: range("sessionTtlMin").optional(),
    maxOpenSessions: range("maxOpenSessions").optional(),
    maxActiveHours: range("maxActiveHours").optional(),
    maxFileMb: range("maxFileMb").optional(),
    retentionDays: range("retentionDays").optional(),
    /** P10 (AC-67): USER rolü için 2FA zorunlu mu (Admin/Super Admin her zaman zorunlu). */
    requireTech2fa: z.boolean().optional(),
    /** P10: SMTP; `null` → kaldır. Host özel/loopback IP'ye çözümlenirse 400 `HOST_NOT_ALLOWED` (AC-122). */
    smtp: smtpSettingsInputSchema.nullable().optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "Değiştirilecek alan yok", path: ["_"] });
export type UpdateTenantSettingsInput = z.input<typeof updateTenantSettingsInputSchema>;
export type UpdateTenantSettingsData = z.output<typeof updateTenantSettingsInputSchema>;

export interface TenantSettingsView {
  /** Oturum linki/kodu geçerlilik süresi (dk). */
  sessionTtlMin: number;
  /** Teknisyen başına açık (bekleyen) oturum üst sınırı. */
  maxOpenSessions: number;
  /** Etkin oturumun en uzun süresi (saat). */
  maxActiveHours: number;
  /** Dosya transferi üst sınırı (MB). */
  maxFileMb: number;
  /** Oturum kayıtlarının saklama süresi (gün). */
  retentionDays: number;
  /** P10 (AC-67). */
  requireTech2fa: boolean;
  /** P10: SMTP ayarı yoksa null. */
  smtp: SmtpSettingsView | null;
}
