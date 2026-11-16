// Tenant ayarları görünümü ve PUT TX gövdesi (service.ts'ten taşındı, PT-K12; AC-4, P10 AC-67/78/79/122).
// SMTP şifresi audit'e yalnız `smtpPassword: "***"` olarak (değiştiyse) girer. Güvenlik "Yok" + kullanıcı adı (düz bağlantıda
// AUTH, kullanıcı talebi 2026-11-15) eski/yeni SMTP görünümüne `insecureAuth: true` bayrağıyla girer.
// P27a (AC-331, K-P27a-1): `mfaRememberDevice` true→false aynı TX'te firmanın tüm hatırlanan cihazlarını siler; audit
// `newValue.revokedTrustedDevices` (mimari-p27a §3.4). Yeniden açmak eskileri geri getirmez.
import type { SmtpSecurity, TenantSettingsView, UpdateTenantSettingsData } from "@remote/contracts/api/tenants";
import { AV_NOT_READY_MESSAGE, FILE_MODE_CONSENT_REQUIRED_MESSAGE } from "@remote/contracts/api/fsrv";
import { TENANT_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { deleteForTenant } from "../auth/trusted-device-repo.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { tenantStorage } from "../fsrv/usage.ts";
import { avReady } from "../settings/clamav.ts";
import { tenantLogoUrl } from "../uploads/urls.ts";
import { actor } from "./deactivate.ts";
import * as repo from "./repo.ts";

type DbOrTx = Db | Prisma.TransactionClient;

export function settingsView(r: repo.SettingsRow): TenantSettingsView {
  const logoUrl = tenantLogoUrl(r.tenant.logoPath);
  const { sessionTtlMin, maxOpenSessions, maxActiveHours, maxFileMb, retentionDays, requireTech2fa, mfaRememberDevice } = r;
  const { fileServerMode, fileRetentionDays } = r;
  const smtp =
    r.smtpHost && r.smtpPort && r.smtpSecurity && r.smtpFromEmail
      ? {
          host: r.smtpHost,
          port: r.smtpPort,
          security: r.smtpSecurity as SmtpSecurity,
          user: r.smtpUser,
          fromName: r.smtpFromName,
          fromEmail: r.smtpFromEmail,
          hasPassword: r.smtpPassEnc !== null,
        }
      : null;
  return {
    logoUrl,
    sessionTtlMin,
    maxOpenSessions,
    maxActiveHours,
    maxFileMb,
    retentionDays,
    requireTech2fa,
    mfaRememberDevice,
    smtp,
    fileServerMode,
    fileRetentionDays,
  };
}

/** P28b (AC-354, AC-362): görünüm ekleri — son ClamAV testi ve kota kullanımı. */
export async function withFsrv(db: DbOrTx, tenantId: string, v: TenantSettingsView): Promise<TenantSettingsView> {
  return { ...v, avReady: await avReady(db), storage: await tenantStorage(db, tenantId) };
}

/** AC-354: `false→true` geçişinde son ClamAV testi başarılı (409) ve aydınlatma onayı (400) şart. */
async function fileModeGate(tx: Prisma.TransactionClient, cur: repo.SettingsRow, input: UpdateTenantSettingsData): Promise<boolean> {
  if (input.fileServerMode !== true || cur.fileServerMode) return false;
  if (!(await avReady(tx))) throw new AppError("AV_NOT_READY", { fields: { fileServerMode: AV_NOT_READY_MESSAGE } });
  if (input.consentUpdated !== true) throw new AppError("VALIDATION", { fields: { consentUpdated: FILE_MODE_CONSENT_REQUIRED_MESSAGE } });
  return true;
}

const SCALARS = [
  "sessionTtlMin",
  "maxOpenSessions",
  "maxActiveHours",
  "maxFileMb",
  "retentionDays",
  "requireTech2fa",
  "mfaRememberDevice",
  "fileServerMode",
  "fileRetentionDays",
] as const;
type SmtpAudit = {
  host: string | null;
  port: number | null;
  security: string | null;
  user: string | null;
  fromName: string | null;
  fromEmail: string | null;
};
const smtpAudit = (r: {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: string | null;
  smtpUser: string | null;
  smtpFromName: string | null;
  smtpFromEmail: string | null;
}): SmtpAudit => ({
  host: r.smtpHost,
  port: r.smtpPort,
  security: r.smtpSecurity,
  user: r.smtpUser,
  fromName: r.smtpFromName,
  fromEmail: r.smtpFromEmail,
});

type SmtpAuditOut = SmtpAudit & { insecureAuth?: true; smtpPassword?: string };
/** Düz bağlantıda AUTH bayrağı (yalnız boolean; kimlik değeri değil). */
const withInsecureFlag = (a: SmtpAudit): SmtpAuditOut => (a.security === "NONE" && a.user !== null ? { ...a, insecureAuth: true } : a);

/** SMTP değişikliği: değiştiyse yazılacak alanlar ve audit eski/yeni (şifre maskeli); değişmediyse null. */
function smtpChange(
  cur: repo.SettingsRow,
  s: NonNullable<UpdateTenantSettingsData["smtp"]> | null,
  secrets: SecretBox,
  tenantId: string,
): { fields: Record<string, unknown>; before: SmtpAuditOut; after: SmtpAuditOut } | null {
  const before = smtpAudit(cur);
  const passEnc =
    s === null || s.user === null
      ? null
      : s.password !== undefined
        ? secrets.encrypt(s.password, aadFor.smtpPassword(tenantId))
        : cur.smtpPassEnc;
  const after: SmtpAudit =
    s === null
      ? { host: null, port: null, security: null, user: null, fromName: null, fromEmail: null }
      : { host: s.host, port: s.port, security: s.security, user: s.user, fromName: s.fromName, fromEmail: s.fromEmail };
  const passChanged = (s?.password !== undefined && s.user !== null) || (passEnc === null && cur.smtpPassEnc !== null);
  if (!(JSON.stringify(before) !== JSON.stringify(after) || passChanged)) return null;
  const fields = {
    smtpHost: after.host,
    smtpPort: after.port,
    smtpSecurity: after.security,
    smtpUser: after.user,
    smtpFromName: after.fromName,
    smtpFromEmail: after.fromEmail,
    smtpPassEnc: passEnc,
  };
  const shown = withInsecureFlag(after);
  return { fields, before: withInsecureFlag(before), after: passChanged ? { ...shown, smtpPassword: "***" } : shown };
}

/** PUT /settings/tenant TX gövdesi: yalnız değişen alanlar yazılır; değişiklik yoksa yazma/audit yok. */
export async function settingsTx(
  tx: Prisma.TransactionClient,
  secrets: SecretBox,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: UpdateTenantSettingsData,
  auditExtra?: Record<string, number | string>,
): Promise<TenantSettingsView> {
  const cur = await repo.lockSettings(tx, tenantId);
  const consentAck = await fileModeGate(tx, cur, input);
  const next: Record<string, unknown> = {};
  const old: Record<string, unknown> = {};
  for (const k of SCALARS) {
    const v = input[k];
    if (v !== undefined && v !== cur[k]) [next[k], old[k]] = [v, cur[k]];
  }
  const data: Record<string, unknown> = { ...next };
  if (input.smtp !== undefined) {
    const change = smtpChange(cur, input.smtp, secrets, tenantId);
    if (change) {
      Object.assign(data, change.fields);
      old.smtp = change.before;
      next.smtp = change.after;
    }
  }
  if (Object.keys(data).length === 0) return withFsrv(tx, tenantId, settingsView(cur));
  const saved = await repo.updateSettings(tx, tenantId, data);
  if (consentAck) next.consentAck = true;
  if (next.mfaRememberDevice === false) next.revokedTrustedDevices = await deleteForTenant(tx, tenantId);
  if (auditExtra && next.smtp) Object.assign(next, auditExtra); // P27 (AC-336): SMTP değişikliğinde etkin cihaz sayısı + bildirim sonucu
  await writeAudit(tx, ctx, {
    tenantId,
    ...actor(auth),
    action: TENANT_AUDIT.SETTINGS_UPDATED,
    entity: "tenant_settings",
    entityId: tenantId,
    result: "success",
    oldValue: old as never,
    newValue: next as never,
  });
  return withFsrv(tx, tenantId, settingsView(saved));
}
