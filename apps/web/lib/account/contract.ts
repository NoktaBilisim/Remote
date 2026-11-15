/*
 * P10 hesap güvenliği + SMTP sözleşmesinin web yüzü: tek kaynak `@remote/contracts` (api/auth, api/tenants,
 * api/sessions, api/requests; docs/mimari-api.md). Burada şema tanımı yok; yalnız yeniden dışa aktarım ve iki küçük
 * görüntü yardımcısı.
 */
export {
  RECOVERY_CODES_LOW_THRESHOLD,
  passwordForgotInputSchema,
  recoveryCodeSchema,
  stepUpInputSchema,
  totpCodeSchema,
} from "@remote/contracts/api/auth";
export type {
  LoginResponse,
  LogoutAllResponse,
  MeResponse,
  MfaEnableResponse,
  MfaSetupResponse,
  MfaStatus,
  MfaVerifyResponse,
  StepUpMethod,
  StepUpResponse,
  TrustedDeviceListResponse,
  TrustedDeviceRevokeResponse,
  TrustedDeviceView,
} from "@remote/contracts/api/auth";
export {
  SMTP_ALLOWED_PORTS,
  SMTP_DEFAULT_PORTS,
  SMTP_PORT_MESSAGE,
  SMTP_SEND_FAILED_MESSAGE,
  smtpSettingsInputSchema,
  smtpTestInputSchema,
} from "@remote/contracts/api/tenants";
export type {
  SmtpSecurity,
  SmtpSettingsInput,
  SmtpSettingsView,
  SmtpTestResponse,
  TenantSettingsView,
} from "@remote/contracts/api/tenants";
export { sessionEmailInputSchema } from "@remote/contracts/api/sessions";
export type { SessionEmailResponse } from "@remote/contracts/api/sessions";

/** Sıfırlama tokenı biçimi (contracts `passwordResetInputSchema.token` ile aynı; biçim dışıysa istek atılmaz). */
export const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Elle giriş anahtarını 4'lü gruplar (okuma kolaylığı): "JBSW Y3DP EHPK 3PXP". */
export const groupSecret = (s: string): string => s.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");

/** Kurtarma kodu az kaldı uyarısı eşiği (tek kaynak contracts `RECOVERY_CODES_LOW_THRESHOLD`, AC-215/273). */
export { RECOVERY_CODES_LOW_THRESHOLD as RECOVERY_LOW } from "@remote/contracts/api/auth";
