// /api/v1/users sözleşmesi (P9; mimari-api "Yönetim", AC-71..74, AC-115). Tek kaynak: sunucu girdileri bu şemalarla
// doğrular, web aynı tipleri kullanır. Yetki anahtarları yalnız `permissions.ts`'ten (AC-72): şema anahtar kümesini
// çağrı anında `PERMISSION_KEYS`'ten okur, burada elle liste yok.
import { z } from "zod";
import { PERMISSION_KEYS, type PermissionKey, type Role } from "../permissions.ts";
import { UNSAFE_NAME_CHARS } from "./sessions.ts";

// ---------------------------------------------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------------------------------------------

export const USER_STATUSES = ["ACTIVE", "PASSIVE"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Panelden atanabilen roller. SUPER_ADMIN bu uçlardan verilmez, düzenlenmez ve listelenmez. */
export const MANAGED_ROLES = ["USER", "ADMIN"] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export const USER_FULL_NAME_MIN = 2;
export const USER_FULL_NAME_MAX = 100;
export const USER_EMAIL_MAX = 190;
export const USER_PAGE_SIZE_DEFAULT = 25;
export const USER_PAGE_SIZE_MAX = 100;

export const USER_ROLE_FILTERS = ["all", "ADMIN", "USER"] as const;
export type UserRoleFilter = (typeof USER_ROLE_FILTERS)[number];
/** Liste durum filtresi: vars. `active`. */
export const USER_STATUS_FILTERS = ["active", "passive", "all"] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];
export const USER_LIST_SORTS = ["fullName:asc", "createdAt:desc"] as const;
export type UserListSort = (typeof USER_LIST_SORTS)[number];

/** 409 `fields.email` (e-posta tüm sistemde tekil — giriş kimliği). */
export const USER_EMAIL_CONFLICT_MESSAGE = "Bu e-posta adresi başka bir hesapta kullanılıyor";

/**
 * P14a (AC-206, ADR-0023) iyimser kilit: `GET /users/:id` yanıtı `version` alanı + `ETag: "v<version>"`; `PATCH /users/:id`
 * `If-Match: "v<n>"` ister (yoksa/bozuksa 428 `PRECONDITION_REQUIRED`, sürüm güncel değilse 409 `STALE_WRITE` + bu mesaj).
 * PATCH yanıtı da yeni `ETag` taşır. Pasif/aktif/2FA sıfırlama ve 2FA kurulumu da sürümü artırır (If-Match istemez).
 */
export const USER_STALE_WRITE_MESSAGE = "Kayıt başkası tarafından değiştirildi, yeniden yükleyin";
export const USER_IF_MATCH_REQUIRED_MESSAGE = "Kayıt sürümü (If-Match) eksik; sayfayı yeniden yükleyin.";
/** `ETag` / `If-Match` değeri: `"v<n>"` (güçlü doğrulayıcı, tırnaklı). */
export const userEtag = (version: number): string => `"v${version}"`;
/** `If-Match` başlığından sürüm; yok, `*`, liste ya da bozuk biçim → null (sunucu 428 döner). */
export function parseUserIfMatch(header: string | string[] | undefined): number | null {
  if (typeof header !== "string") return null;
  const m = /^\s*"v(\d{1,10})"\s*$/.exec(header);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n <= 4_294_967_295 ? n : null;
}

/** P14a (AC-203): `/users*` yazma uçları kullanıcı başına 30/dk; `POST /users` ayrıca 10/dk → 429 `RATE_LIMITED` + `Retry-After`. */
export const USERS_WRITES_PER_MIN = 30;
export const USERS_CREATES_PER_MIN = 10;

/** P14b (AC-225): `GET /users/options` üst sınırı (tam liste; 150 teknisyenli fixture'da 150). */
export const USER_OPTIONS_MAX = 1000;

/** Geçici şifre uzunluğu (≥ PASSWORD_MIN 12); yalnız oluşturma yanıtında döner, ilk girişte değiştirilir. */
export const TEMPORARY_PASSWORD_LENGTH = 16;

// ---------------------------------------------------------------------------------------------------------------
// Alan şemaları
// ---------------------------------------------------------------------------------------------------------------

const codePoints = (v: string): number => [...v].length;

/** Ad soyad: trim, 2..100 kod noktası, Cc/Cf/Zl/Zp yok. */
export const userFullNameSchema = z
  .string()
  .max(400, `Ad soyad en çok ${USER_FULL_NAME_MAX} karakter olabilir`)
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Ad soyad görünmez veya kontrol karakteri içeremez")
  .trim()
  .refine((v) => codePoints(v) >= USER_FULL_NAME_MIN, `Ad soyad en az ${USER_FULL_NAME_MIN} karakter olmalı`)
  .refine((v) => codePoints(v) <= USER_FULL_NAME_MAX, `Ad soyad en çok ${USER_FULL_NAME_MAX} karakter olabilir`);

/** E-posta: trim + küçük harf, ≤ 190, geçerli biçim (giriş `@` içeren girdiyi küçük harfle arar). */
export const userEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(USER_EMAIL_MAX, `E-posta en çok ${USER_EMAIL_MAX} karakter olabilir`)
  .pipe(z.email("E-posta adresi geçersiz"));

/**
 * Yetki haritası `{ "<modül>.<eylem>": bool }` (AC-71). Kısmi olabilir: verilmeyen anahtar değişmez (oluşturmada rol
 * varsayılanı). Tanımda olmayan anahtar → 400 `fields["permissions.<anahtar>"]`. Anahtar kümesi çağrı anında okunur.
 */
export const permissionMapSchema = z.record(z.string().max(60), z.boolean()).superRefine((map, ctx) => {
  const known: ReadonlySet<string> = new Set(PERMISSION_KEYS);
  for (const key of Object.keys(map)) {
    if (!known.has(key)) ctx.addIssue({ code: "custom", path: [key], message: "Tanımsız yetki anahtarı" });
  }
});
export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const userIdSchema = z.string().regex(ULID, "Geçersiz kimlik");

// ---------------------------------------------------------------------------------------------------------------
// Girdi şemaları
// ---------------------------------------------------------------------------------------------------------------

/**
 * POST /users (users.create; AC-71, 73). Kullanıcı etkin tenant'ta oluşur (Super Admin önce firma seçer).
 * `permissions` verilmezse rol varsayılanı (ADMIN tümü açık, USER tümü kapalı). Admin sahip olmadığı yetkiyi
 * veremez → 403 (ADMIN rolü varsayılanı da "verme" sayılır: Admin'in olmayan anahtarı açıkça `false` gönderilmeli).
 */
export const createUserInputSchema = z.strictObject({
  email: userEmailSchema,
  fullName: userFullNameSchema,
  role: z.enum(MANAGED_ROLES),
  permissions: permissionMapSchema.optional(),
});
export type CreateUserInput = z.input<typeof createUserInputSchema>;
export type CreateUserData = z.output<typeof createUserInputSchema>;

/**
 * PATCH /users/:id (users.edit; AC-71, 73, 74, 115). Tüm alanlar opsiyonel, en az biri. Kendi rolünü/yetkilerini
 * değiştirme → 403. Yetki/rol değişimi canlı oturuma yansır (rol değişimi oturumları sonlandırır).
 */
export const updateUserInputSchema = z
  .strictObject({
    email: userEmailSchema.optional(),
    fullName: userFullNameSchema.optional(),
    role: z.enum(MANAGED_ROLES).optional(),
    permissions: permissionMapSchema.optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "Değiştirilecek alan yok", path: ["_"] });
export type UpdateUserInput = z.input<typeof updateUserInputSchema>;
export type UpdateUserData = z.output<typeof updateUserInputSchema>;

/** POST /users/:id/deactivate | reactivate — gövde `{}` veya boş (UI onay diyaloğu). */
export const userActionInputSchema = z.strictObject({});

const qSchema = z
  .string()
  .max(400, "Arama en çok 100 karakter olabilir")
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Görünmez veya kontrol karakteri içeremez")
  .trim()
  .refine((v) => codePoints(v) >= 2, "En az 2 karakter girin")
  .refine((v) => codePoints(v) <= 100, "Arama en çok 100 karakter olabilir");

/** GET /users (users.view). `q` ad soyad veya e-postada içerir (boşsa yok sayılır); sayfalı, üst 100. */
export const listUsersQuerySchema = z.strictObject({
  q: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), qSchema.optional()),
  role: z.enum(USER_ROLE_FILTERS).default("all"),
  status: z.enum(USER_STATUS_FILTERS).default("active"),
  sort: z.enum(USER_LIST_SORTS).default("fullName:asc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(USER_PAGE_SIZE_MAX).default(USER_PAGE_SIZE_DEFAULT),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// ---------------------------------------------------------------------------------------------------------------
// Yanıt tipleri
// ---------------------------------------------------------------------------------------------------------------

export interface UserListItem {
  id: string;
  email: string;
  username: string | null;
  fullName: string;
  role: Exclude<Role, "SUPER_ADMIN">;
  status: UserStatus;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  /** P12 (AC-83): oturumlu avatar URL'si; null → baş harf rozeti. */
  avatarUrl: string | null;
  /**
   * Son oturum açılışı (`auth_sessions` kaydından). `null`: oturum kaydı yok — hiç giriş yapmadı **veya** son
   * oturumun kaydı saklama işiyle silindi (süresi dolan oturum +7 gün). "Hiç giriş yapmadı" diye gösterilmez.
   */
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserListResponse {
  items: UserListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UserDetail extends UserListItem {
  /** P14a (AC-206): iyimser kilit sürümü; `PATCH` `If-Match: userEtag(version)` ile gönderilir. */
  version: number;
  /** Etkin yetkiler: tanımdaki HER anahtar için bool (rol varsayılanı + kullanıcı bazlı ezmeler). */
  permissions: Record<PermissionKey, boolean>;
  /** İsteği yapan kendisi mi (kendi rolü/yetkisi değiştirilemez, kendini pasife alamaz). */
  isSelf: boolean;
  /**
   * İsteği yapan bu kullanıcıyı düzenleyebilir/pasife alabilir mi: Super Admin her zaman; Admin yalnız hedefin TÜM
   * etkin yetkilerine kendisi de sahipse (kendinden geniş yetkili hesabı yönetemez). `false` → PATCH/deactivate 403.
   */
  canManage: boolean;
}

/** POST /users yanıtı (201): geçici şifre YALNIZ burada döner, tekrar alınamaz; `mustChangePassword=true`. */
export interface CreateUserResponse {
  user: UserDetail;
  temporaryPassword: string;
}

/**
 * GET /users/options sorgusu (QA Tur 1, AC-225). Bilinmeyen parametre 400 (strict). `tenantId` yalnız firma seçmemiş
 * SUPER_ADMIN'de kullanılır; firma seçili olan veya SUPER_ADMIN olmayan rollerde sunucuda yok sayılır (kapsam ezer —
 * `GET /sessions` `tenantId` kuralıyla aynı).
 */
export const userOptionsQuerySchema = z.strictObject({
  tenantId: userIdSchema.optional(),
  /** P16 (AC-241): `1` → mezar taşları da ("Silinmiş kullanıcı #XXXXXX", `status: "DELETED"`) döner; geçmiş filtreleri için. */
  includeDeleted: z
    .enum(["0", "1"])
    .optional()
    .transform((v) => v === "1"),
});
export type UserOptionsQuery = z.infer<typeof userOptionsQuerySchema>;

/**
 * GET /users/options (P14b, AC-225): filtre seçicisi için teknisyen listesi — sayfasız, en çok `USER_OPTIONS_MAX`,
 * `fullName` sırası, pasifler dahil (geçmiş kayıtlarda görünürler). Kapsam: etkin tenant; firma seçmemiş Super Admin
 * `?tenantId=` ile bir firmayı seçer (yoksa 403, firma yoksa 404). USER rolü yalnız kendisini görür (oturum geçmişi
 * `historyScope` kuralı). Yetki: `session_history.view` | `support_requests.view` | `users.view` (biri yeterli).
 * SUPER_ADMIN hesapları listelenmez.
 */
/** P16: seçenek durumu — `includeDeleted=1` ile mezar taşları `DELETED` döner (ad = "Silinmiş kullanıcı #XXXXXX"). */
export type UserOptionStatus = UserStatus | "DELETED";
export interface UserOption {
  id: string;
  fullName: string;
  status: UserOptionStatus;
}
export interface UserOptionsResponse {
  items: UserOption[];
}

// ---------------------------------------------------------------------------------------------------------------
// P15 — Super Admin panel şifre sıfırlama (AC-232; P13b CLI servisinin panel yolu)
// ---------------------------------------------------------------------------------------------------------------

/** GET /admin/superadmins (SUPER_ADMIN) — sıfırlanacak hesabı seçmek için; en çok `SUPERADMIN_LIST_MAX`. */
export const SUPERADMIN_LIST_MAX = 100;
export interface SuperadminItem {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  totpEnabled: boolean;
  /** İsteği yapan kendisi mi (kendi şifresi bu yolla sıfırlanamaz → düğme gizli; uç 403). */
  self: boolean;
}
export interface SuperadminListResponse {
  items: SuperadminItem[];
}

/**
 * POST /admin/superadmins/:id/reset-password `{}` — step-up (AC-215) ister. Geçici parola YALNIZ bu yanıtta döner;
 * hedef ilk girişte değiştirmek zorundadır (24 sa içinde), tüm oturumları kapanır. Kendi id'si → 403; hedef etkin bir
 * Super Admin değilse 404. 2FA'ya dokunmaz (gerekirse CLI `--reset-mfa`).
 */
export const superadminResetInputSchema = z.strictObject({});
export interface SuperadminResetResponse {
  temporaryPassword: string;
  revokedSessions: number;
}

// ---------------------------------------------------------------------------------------------------------------
// P16 — Kalıcı kullanıcı silme (AC-237, AC-241; ADR-0030 m.4, mimari-e11 §7.4–7.5)
// ---------------------------------------------------------------------------------------------------------------

/** Ad onayı karşılaştırma biçimi: trim + NFC, harf duyarlı (sunucu ve web aynı fonksiyonu kullanır). */
export const normalizeConfirmName = (v: string): string => v.trim().normalize("NFC");
export const confirmNameMatches = (typed: string, actual: string): boolean => normalizeConfirmName(typed) === normalizeConfirmName(actual);

/** Ad onayı alanı: 1..`max` kod noktası (trim + NFC sonrası). Eşleşme sunucuda kayıtla karşılaştırılır. */
export const confirmNameSchema = (max: number) =>
  z
    .string()
    .max(max * 4, `En çok ${max} karakter olabilir`)
    .transform(normalizeConfirmName)
    .refine((v) => codePoints(v) >= 1, "Onay için adı yazın")
    .refine((v) => codePoints(v) <= max, `En çok ${max} karakter olabilir`);

/**
 * DELETE /users/:id — `users.delete` + `canManage` + tenant kapsamı, **step-up** (AC-215), `If-Match: "v<n>"`, hız `/users`
 * 30/dk. Gövde `{confirmName}` hedefin `fullName`'ine eşit olmalı (trim + NFC, harf duyarlı) → değilse 400
 * `fields.confirmName`. Yanıt 204. Hatalar: 401 `MFA_STEP_UP_REQUIRED` · 403 `FORBIDDEN` (anahtar yok, kendi hesabı,
 * SUPER_ADMIN hedef, daha geniş yetkili hedef) · 403 `MFA_SETUP_REQUIRED` · 404 (yok, başka firma, zaten silinmiş) ·
 * 409 `CONFLICT` (aktif kullanıcı → `USER_DELETE_ACTIVE_MESSAGE`; açık oturum → `USER_DELETE_OPEN_SESSION_MESSAGE`) ·
 * 409 `STALE_WRITE` · 428 `PRECONDITION_REQUIRED` · 429.
 */
export const deleteUserInputSchema = z.strictObject({ confirmName: confirmNameSchema(USER_FULL_NAME_MAX) });
export type DeleteUserInput = z.input<typeof deleteUserInputSchema>;

export const USER_DELETE_CONFIRM_MISMATCH_MESSAGE = "Yazdığınız ad kullanıcının adıyla eşleşmiyor";
export const USER_DELETE_ACTIVE_MESSAGE = "Önce kullanıcıyı pasife alın";
export const USER_DELETE_OPEN_SESSION_MESSAGE = "Kullanıcının açık destek oturumu var; oturum kapanınca tekrar deneyin";
