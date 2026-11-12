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
// SMTP alanları P10'da bu uca eklenir (netguard, maskeli şifre); 2FA zorunluluğu P10.
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

/** PUT gövdesi: alanlar opsiyonel (verilen değişir), en az biri. Aralık dışı → 400 `fields.<alan>` (AC-4). */
export const updateTenantSettingsInputSchema = z
  .strictObject({
    sessionTtlMin: range("sessionTtlMin").optional(),
    maxOpenSessions: range("maxOpenSessions").optional(),
    maxActiveHours: range("maxActiveHours").optional(),
    maxFileMb: range("maxFileMb").optional(),
    retentionDays: range("retentionDays").optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "Değiştirilecek alan yok", path: ["_"] });
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsInputSchema>;

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
}
