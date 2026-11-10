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

export interface LoginResponse {
  user: AuthUser;
  mfaRequired: boolean;
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: AuthUser;
  permissions: PermissionKey[];
  tenant: TenantRef | null;
  actingTenant: TenantRef | null;
}

/**
 * Çerez ve başlık adları (ADR-0008). `__Host-` öneki (S1-9): Secure + Path=/ + Domain yok zorunlu →
 * kardeş alt alan adı çerez enjekte edemez. CSRF çerezi JS ile okunur, durum değiştiren her istekte başlığa yazılır.
 */
export const SESSION_COOKIE = "__Host-rs_session";
export const CSRF_COOKIE = "__Host-rs_csrf";
export const CSRF_HEADER = "x-csrf-token";
