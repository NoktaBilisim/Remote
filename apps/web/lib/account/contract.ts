/*
 * P10 hesap güvenliği + SMTP sözleşmesinin web yüzü: tek kaynak `@remote/contracts` (api/auth, api/tenants,
 * api/sessions, api/requests; docs/mimari-api.md). Burada şema tanımı yok; yalnız yeniden dışa aktarım ve iki küçük
 * görüntü yardımcısı.
 */
export {
  MFA_STAGES,
  PASSWORD_MAX,
  PASSWORD_MIN,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODES_LOW_THRESHOLD,
  RESET_PASSWORD_PATH,
  RESET_TOKEN_TTL_MIN,
  passwordForgotInputSchema,
  passwordResetInputSchema,
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
  MfaStage,
  MfaStatus,
  MfaVerifyResponse,
  StepUpMethod,
  StepUpResponse,
} from "@remote/contracts/api/auth";
export {
  SMTP_ALLOWED_PORTS,
  SMTP_DEFAULT_PORTS,
  SMTP_HOST_NOT_ALLOWED_MESSAGE,
  SMTP_INSECURE_AUTH_MESSAGE,
  SMTP_PORT_MESSAGE,
  SMTP_SECURITIES,
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
  UpdateTenantSettingsInput,
} from "@remote/contracts/api/tenants";
export { SESSION_EMAIL_PER_HOUR, sessionEmailInputSchema } from "@remote/contracts/api/sessions";
export type { SessionEmailResponse } from "@remote/contracts/api/sessions";
export { emailTestInputSchema } from "@remote/contracts/api/requests";
export type { EmailTestResponse } from "@remote/contracts/api/requests";

/** Sıfırlama tokenı biçimi (contracts `passwordResetInputSchema.token` ile aynı; biçim dışıysa istek atılmaz). */
export const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Elle giriş anahtarını 4'lü gruplar (okuma kolaylığı): "JBSW Y3DP EHPK 3PXP". */
export const groupSecret = (s: string): string => s.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");

/** Kurtarma kodu az kaldı uyarısı eşiği (tek kaynak contracts `RECOVERY_CODES_LOW_THRESHOLD`, AC-215/273). */
export { RECOVERY_CODES_LOW_THRESHOLD as RECOVERY_LOW } from "@remote/contracts/api/auth";
