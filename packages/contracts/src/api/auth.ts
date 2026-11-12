// /api/v1/auth sözleşmesi (mimari-api.md "Auth"). Girdi şemaları sunucu ve web formlarında ortak.
import { z } from "zod";
import type { PermissionKey, Role } from "../permissions.ts";

export const PASSWORD_MIN = 12; // AC-64
export const PASSWORD_MAX = 200;

export const loginInputSchema = z.object({
  login: z.string().trim().min(3).max(190),
  password: z.string().min(1).max(PASSWORD_MAX),
  tenantSlug: z.string().trim().min(1).max(60).optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const passwordChangeInputSchema = z
  .object({
    current: z.string().min(1).max(PASSWORD_MAX),
    next: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  })
  .refine((v) => v.current !== v.next, { path: ["next"], message: "Yeni şifre mevcut şifreden farklı olmalı" });
export type PasswordChangeInput = z.infer<typeof passwordChangeInputSchema>;

export type Theme = "LIGHT" | "DARK" | "SYSTEM";

export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
  fullName: string;
  role: Role;
  tenantId: string | null;
  theme: Theme;
  mustChangePassword: boolean;
}

export interface TenantRef {
  id: string;
  name: string;
  slug: string;
}

/**
 * P10 (AC-67) oturumun 2FA aşaması:
 *  - `ok`: tam oturum;
 *  - `verify`: 2FA etkin, bu oturumda kod girilmedi → yalnız POST /auth/mfa/verify, GET /auth/me, POST /auth/logout
 *    (diğer uçlar 403 `MFA_REQUIRED`; WS bağlantıları reddedilir);
 *  - `setup`: 2FA zorunlu (SUPER_ADMIN/ADMIN; USER için tenant `requireTech2fa`) ama kurulmamış → yalnız
 *    /auth/mfa/setup, /auth/mfa/enable, /auth/password/change, GET /auth/me, POST /auth/logout (diğerleri 403
 *    `MFA_SETUP_REQUIRED`). `mustChangePassword` önce gelir: şifre değişmeden setup/enable 403 `PASSWORD_CHANGE_REQUIRED`.
 */
export const MFA_STAGES = ["ok", "verify", "setup"] as const;
export type MfaStage = (typeof MFA_STAGES)[number];

export interface MfaStatus {
  /** Kullanıcıda TOTP etkin. */
  enabled: boolean;
  /** Rol/tenant kuralına göre zorunlu. */
  required: boolean;
  stage: MfaStage;
  /** Kullanılmamış kurtarma kodu sayısı (etkin değilse 0). */
  recoveryCodesLeft: number;
}

export interface LoginResponse {
  user: AuthUser;
  /** Oturum 2FA kodu bekliyor (`mfa.stage === "verify"`). */
  mfaRequired: boolean;
  /** P10: 2FA zorunlu ama kurulmamış (`mfa.stage === "setup"`). */
  mfaSetupRequired: boolean;
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: AuthUser;
  permissions: PermissionKey[];
  tenant: TenantRef | null;
  actingTenant: TenantRef | null;
  /** P10 (AC-67). */
  mfa: MfaStatus;
}

// ---------------------------------------------------------------------------------------------------------------
// P10 — 2FA (TOTP, RFC 6238: SHA-1, 6 hane, 30 sn, ±1 adım) ve kurtarma kodları (AC-67)
// ---------------------------------------------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, "Kod 6 haneli olmalı");
/**
 * Kurtarma kodu `xxxxx-xxxxx` (10 base32 karakter). Önce normalize (tüm boşluklar silinir, büyük harf; `ABCDE - 23456`
 * → `ABCDE-23456`), sonra biçim: 5+5 base32, ortada isteğe bağlı tek tire. Sunucu `normalizeRecoveryCode` tireyi de
 * silip küçük harfe çevirerek karşılaştırır — bu çıktı onunla aynı değere iner.
 */
export const recoveryCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-7]{5}-?[A-Z2-7]{5}$/, "Kurtarma kodu geçersiz"));

/** POST /auth/mfa/verify — `code` veya `recoveryCode` (ikisi birden değil). 5 deneme / 5 dk / kullanıcı → 429. */
export const mfaVerifyInputSchema = z.union([z.strictObject({ code: totpCodeSchema }), z.strictObject({ recoveryCode: recoveryCodeSchema })]);
export type MfaVerifyInput = z.infer<typeof mfaVerifyInputSchema>;

/** POST /auth/mfa/setup — gövde `{}` veya boş. 2FA etkinse 409. */
export const mfaSetupInputSchema = z.strictObject({});
export interface MfaSetupResponse {
  /** `otpauth://totp/...` (QR'ın içeriği). */
  otpauthUrl: string;
  /** PNG data URL (`data:image/png;base64,...`). */
  qrDataUrl: string;
  /** Elle giriş için base32 sır (büyük harf, 4'lü gruplar boşluksuz). */
  secret: string;
}

/** POST /auth/mfa/enable — setup'tan sonra uygulamadaki kod. Yanlış kod → 400 `fields.code`. */
export const mfaEnableInputSchema = z.strictObject({ code: totpCodeSchema });
export interface MfaEnableResponse {
  /** 10 tek kullanımlık kod; yalnız bu yanıtta döner (DB'de yalnız SHA-256). */
  recoveryCodes: string[];
}

export interface MfaVerifyResponse {
  user: AuthUser;
  /** Kurtarma koduyla girildiyse kalan kod sayısı. */
  recoveryCodesLeft: number;
}

// ---------------------------------------------------------------------------------------------------------------
// P10 — Tüm cihazlardan çıkış (AC-68, AC-115) ve şifre sıfırlama (AC-66)
// ---------------------------------------------------------------------------------------------------------------

/** POST /auth/logout-all — gövde `{}` veya boş; bu oturum açık kalır, diğerleri iptal. */
export const logoutAllInputSchema = z.strictObject({});
export interface LogoutAllResponse {
  revokedSessions: number;
}

/** Sıfırlama bağlantısı: `${PUBLIC_BASE_URL}${RESET_PASSWORD_PATH}#token=<token>` (token parça içinde → sunucu/proxy loguna girmez). */
export const RESET_PASSWORD_PATH = "/reset-password";
/** Bağlantı geçerliliği (AC-66: 30 dk, tek kullanım). */
export const RESET_TOKEN_TTL_MIN = 30;

/** POST /auth/password/forgot — her durumda 202 (hesap varlığı sızmaz). IP 10/sa → 429. */
export const passwordForgotInputSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(190, "E-posta en çok 190 karakter olabilir").pipe(z.email("E-posta adresi geçersiz")),
});
export type PasswordForgotInput = z.infer<typeof passwordForgotInputSchema>;

/** POST /auth/password/reset — 204; geçersiz/kullanılmış/süresi dolmuş → 410 `RESET_TOKEN_INVALID`. */
export const passwordResetInputSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Bağlantı geçersiz"),
  next: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
export type PasswordResetInput = z.infer<typeof passwordResetInputSchema>;

/**
 * Çerez ve başlık adları (ADR-0008). `__Host-` öneki (S1-9): Secure + Path=/ + Domain yok zorunlu →
 * kardeş alt alan adı çerez enjekte edemez. CSRF çerezi JS ile okunur, durum değiştiren her istekte başlığa yazılır.
 */
export const SESSION_COOKIE = "__Host-rs_session";
export const CSRF_COOKIE = "__Host-rs_csrf";
export const CSRF_HEADER = "x-csrf-token";
