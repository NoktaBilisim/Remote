// Tenant ayarları görünümü ve PUT TX gövdesi (service.ts'ten taşındı, PT-K12; AC-4, P10 AC-67/78/79/122).
// SMTP şifresi audit'e yalnız `smtpPassword: "***"` olarak (değiştiyse) girer.
import type { SmtpSecurity, TenantSettingsView, UpdateTenantSettingsData } from "@remote/contracts/api/tenants";
import { TENANT_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import { tenantLogoUrl } from "../uploads/urls.ts";
import { actor } from "./deactivate.ts";
import * as repo from "./repo.ts";

export function settingsView(r: repo.SettingsRow): TenantSettingsView {
  const logoUrl = tenantLogoUrl(r.tenant.logoPath);
  const { sessionTtlMin, maxOpenSessions, maxActiveHours, maxFileMb, retentionDays, requireTech2fa } = r;
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
  return { logoUrl, sessionTtlMin, maxOpenSessions, maxActiveHours, maxFileMb, retentionDays, requireTech2fa, smtp };
}

const SCALARS = ["sessionTtlMin", "maxOpenSessions", "maxActiveHours", "maxFileMb", "retentionDays", "requireTech2fa"] as const;
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

/** SMTP değişikliği: değiştiyse yazılacak alanlar ve audit eski/yeni (şifre maskeli); değişmediyse null. */
function smtpChange(
  cur: repo.SettingsRow,
  s: NonNullable<UpdateTenantSettingsData["smtp"]> | null,
  secrets: SecretBox,
  tenantId: string,
): { fields: Record<string, unknown>; before: SmtpAudit; after: SmtpAudit | (SmtpAudit & { smtpPassword: string }) } | null {
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
  return { fields, before, after: passChanged ? { ...after, smtpPassword: "***" } : after };
}

/** PUT /settings/tenant TX gövdesi: yalnız değişen alanlar yazılır; değişiklik yoksa yazma/audit yok. */
export async function settingsTx(
  tx: Prisma.TransactionClient,
  secrets: SecretBox,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: UpdateTenantSettingsData,
): Promise<TenantSettingsView> {
  const cur = await repo.lockSettings(tx, tenantId);
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
  if (Object.keys(data).length === 0) return settingsView(cur);
  const saved = await repo.updateSettings(tx, tenantId, data);
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
  return settingsView(saved);
}
