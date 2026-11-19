// P21 müşteri portalı sözleşmesi (AC-262; mimari-p21 §4.1–4.3, ADR-0039). Portal kullanıcısı tenant kullanıcısı DEĞİLDİR:
// ayrı çerez, ayrı oturum tablosu, yetki toggle'ı yok; kapsam her istekte `portal_users.customer_id`'den (§5.3).
// Yeni hata kodu yok (`errors.ts` mevcut kodlar). Bu dosya yaprak modüldür: `src/` içinde onu içe aktaran yok (döngü yok).
import { z } from "zod";
import { PASSWORD_MAX, totpCodeSchema, type Theme } from "./auth.ts";
import { themeSchema } from "./branding.ts";
import { customerFirmNameSchema } from "./customers.ts";
import {
  refineNotifyEmail,
  webRequestShape,
  type RequestPriority,
  type RequestSource,
  type RequestStatus,
  type WebFormInfo,
} from "./requests.ts";
import type { SessionMode, SessionStatus } from "./sessions.ts";
import { tenantSlugSchema } from "./tenants.ts";

// ---------------------------------------------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------------------------------------------

/** Portal oturum çerezi: httpOnly, Secure, SameSite=Strict, Path=/ (panel çerezinden ayrı — ADR-0039). */
export const PORTAL_SESSION_COOKIE = "__Host-rs_portal";
/** Portal CSRF çerezi: httpOnly=false, Secure, SameSite=Strict, Path=/. Başlık panelle aynı (`CSRF_HEADER`), çerez farklı. */
export const PORTAL_CSRF_COOKIE = "__Host-rs_portal_csrf";
/**
 * r2 S-P21-3: girişte yazılan, gizli OLMAYAN firma kısa adı çerezi — oturum düşünce `proxy.ts` `/portal/login?tenant=<slug>`'a
 * yönlendirir (yalnız `tenantSlugSchema`'ya uyan değer kullanılır).
 */
export const PORTAL_TENANT_COOKIE = "rs_portal_tenant";
/** Müşteri başına en çok portal hesabı (aktif + pasif). */
export const PORTAL_ACCOUNTS_PER_CUSTOMER_MAX = 20;
export const PORTAL_PAGE_SIZE_MAX = 100;
/** r2 S-P21-11: sayfa numarası üst sınırı. */
export const PORTAL_PAGE_MAX = 10_000;
export const PORTAL_PAGE_SIZE_DEFAULT = 25;
/** r2 S-P21-4: müşterinin TÜM portal hesapları toplamı, saatte en çok talep (bellek kovası). */
export const PORTAL_REQUESTS_PER_CUSTOMER_HOUR = 10;
/** r2 S-P21-4: portal yolunda müşterinin en çok bekleyen talebi (kaynak fark etmez). */
export const PORTAL_PENDING_PER_CUSTOMER_MAX = 3;
/** r2 S-P21-5: geçici şifre geçerlilik süresi (oluşturma / Admin sıfırlaması). */
export const PORTAL_TEMP_PASSWORD_TTL_HOURS = 72;

export const PORTAL_ACCOUNT_STATUSES = ["ACTIVE", "PASSIVE"] as const;
export type PortalAccountStatus = (typeof PORTAL_ACCOUNT_STATUSES)[number];

// ---------------------------------------------------------------------------------------------------------------
// Girdi şemaları
// ---------------------------------------------------------------------------------------------------------------

/** Portal e-postası: trim + küçük harf, ≤ 254 (DB `email = LOWER(email)` CHECK'i ile aynı). */
export const portalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "E-posta en çok 254 karakter olabilir")
  .pipe(z.email("E-posta adresi geçersiz"));

/** POST /portal/auth/login — `tenantSlug` `?tenant=<slug>`'tan gizli alan (r2 S-P21-3); `totpCode` yalnız `MFA_REQUIRED` sonrası. */
export const portalLoginInputSchema = z.strictObject({
  email: portalEmailSchema,
  tenantSlug: tenantSlugSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
  totpCode: totpCodeSchema.optional(),
});
export type PortalLoginInput = z.input<typeof portalLoginInputSchema>;

/** PATCH /portal/me. Şifre değişimi: `api/auth.ts` `passwordChangeInputSchema` aynen (min 12). */
export const portalThemeInputSchema = z.strictObject({ theme: themeSchema });
export type PortalThemeInput = z.infer<typeof portalThemeInputSchema>;

export const portalTotpEnableInputSchema = z.strictObject({ code: totpCodeSchema });
export type PortalTotpEnableInput = z.infer<typeof portalTotpEnableInputSchema>;
export const portalTotpDisableInputSchema = z.strictObject({ password: z.string().min(1).max(PASSWORD_MAX), code: totpCodeSchema });
export type PortalTotpDisableInput = z.infer<typeof portalTotpDisableInputSchema>;

/** GET /portal/requests|sessions — strict: `customerId`/`tenantId` vb. bilinmeyen parametre → 400 VALIDATION. */
export const portalListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(PORTAL_PAGE_MAX).default(1),
  pageSize: z.coerce.number().int().min(1).max(PORTAL_PAGE_SIZE_MAX).default(PORTAL_PAGE_SIZE_DEFAULT),
});
export type PortalListQuery = z.output<typeof portalListQuerySchema>;

/** POST /customers/:id/portal-accounts — ad müşteri adı kuralıyla (trim, 2..100, Cc/Cf/Zl/Zp yok). */
export const portalAccountCreateInputSchema = z.strictObject({
  email: portalEmailSchema,
  fullName: customerFirmNameSchema,
});
export type PortalAccountCreateInput = z.input<typeof portalAccountCreateInputSchema>;

/** Hesap eylemleri (deactivate / reactivate / reset-password) gövdesi `{}`. */
export const portalAccountActionInputSchema = z.strictObject({});

/**
 * K-P21-2 — portal talebi: P19 web formu alanlarından türetilir (tek tanım; r2 S-P21-6). `ref`/`formToken`/`website` YOK —
 * müşteri ve ref oturumdan gelir, gövde yalnız sunucuda kurulur (r2 S-P21-1). Gövdede `ref`/`bindingKey`/`customerId` → 400.
 */
const PORTAL_OMITTED_FIELDS: ReadonlySet<string> = new Set(["ref", "formToken", "website"]);
export const portalRequestShape = Object.fromEntries(
  Object.entries(webRequestShape).filter(([k]) => !PORTAL_OMITTED_FIELDS.has(k)),
) as Omit<typeof webRequestShape, "ref" | "formToken" | "website">;
export const portalRequestInputSchema = z.strictObject(portalRequestShape).superRefine(refineNotifyEmail);
export type PortalRequestInput = z.input<typeof portalRequestInputSchema>;
export type PortalRequestData = z.output<typeof portalRequestInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Yanıt tipleri
// ---------------------------------------------------------------------------------------------------------------

export interface PortalMe {
  user: { id: string; email: string; fullName: string; theme: Theme; mustChangePassword: boolean; totpEnabled: boolean };
  customer: { name: string };
  /** Sağlayıcı firma (tenant) adı + logosu (yoksa sistem logosu). */
  provider: { name: string; logoUrl: string };
  /** K-P21-3: firma dosyası (müşteri detayındaki indirme bağlantısının aynısı). Yeni talep yolu sabit: `/portal/new-request`. */
  links: { downloadUrl: string; fileName: string };
}

export interface PortalRequestItem {
  id: string;
  requestCode: string;
  status: RequestStatus;
  source: RequestSource;
  priority: RequestPriority;
  requesterName: string | null;
  createdAt: string;
  closedAt: string | null;
  sessionId: string | null;
}

export interface PortalSessionItem {
  id: string;
  status: SessionStatus;
  mode: SessionMode | null;
  technicianName: string;
  customerName: string | null;
  ticketNo: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
}

export interface PortalPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PortalAccountItem {
  id: string;
  email: string;
  fullName: string;
  status: PortalAccountStatus;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  /** r2 S-P21-5: geçici şifrenin 72 saati doldu (panel "Geçici şifre süresi doldu" rozeti); sunucu hesaplar. */
  tempPasswordExpired: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  passiveAt: string | null;
}

/** Geçici şifre yalnız bu yanıtta, bir kez döner (loga/audit'e yazılmaz). */
export interface PortalAccountCreateResponse {
  account: PortalAccountItem;
  temporaryPassword: string;
}
export interface PortalPasswordResetResponse {
  temporaryPassword: string;
}
/** `loginUrl = PUBLIC_BASE_URL + /portal/login?tenant=<slug>` (panelde "Portal adresi"). */
export interface PortalAccountListResponse {
  items: PortalAccountItem[];
  loginUrl: string;
}

/** POST /portal/account/totp/setup (QR sunucuda üretilir; r2 S-P21-9). */
export interface PortalTotpSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

/** GET /portal/request-form — web formu bilgisinin token'sız hâli (K-P21-2). Talep yanıtı mevcut `CreateRequestResponse`. */
export type PortalRequestFormInfo = Omit<WebFormInfo, "formToken" | "minDelayMs">;
