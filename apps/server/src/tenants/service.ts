// Firma (tenant) yönetimi, Super Admin firma geçişi ve tenant ayarları (P9; AC-70, AC-4, AC-115, AC-145;
// mimari-e10 §3.4 `revokeForTenant`).
// Pasife alma: tek TX'te durum + tenant kullanıcılarının oturumları iptal + bekleyen kod oturumları CANCELLED
// (tenant_passive) + P14a (AC-205): bekleyen talepler CANCELLED(TENANT_PASSIVE) ve bilgisayar kayıtları
// TENANT_PASSIVE geçersiz + audit — hepsi AYNI commit (pasif → hemen aktif senaryosunda eski talep/kayıt geçerli kalmaz).
// Commit SONRASI yalnız bildirimler: canlı odalar `tenant_passive` ile biter, panel soketleri 4401, talep sahiplerine
// `request.closed`. Yedekler: talep/kayıt süpürücüleri (30 sn) ve /ws/tech 60 sn yeniden doğrulaması.
import type {
  CreateTenantData,
  ListTenantsQuery,
  SmtpSecurity,
  TenantOptionsQuery,
  TenantOptionsResponse,
  SwitchTenantResponse,
  TenantItem,
  TenantListResponse,
  TenantSettingsView,
  TenantStatus,
  UpdateTenantData,
  UpdateTenantSettingsData,
} from "@remote/contracts/api/tenants";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { NetGuard } from "../lib/netguard.ts";
import {
  TENANT_REACTIVATE_PURGE_PARTIAL_MESSAGE,
  TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE,
  TENANT_SLUG_CONFLICT_MESSAGE,
} from "@remote/contracts/api/tenants";
import { BINDING_AUDIT, TENANT_AUDIT } from "@remote/contracts/audit";
import { revokeForTenant as revokeTenantBindings } from "../bindings/repo.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { createInitialConsent } from "../public/consent.ts";
import { tenantLogoUrl } from "../uploads/urls.ts";
import * as purgeRepo from "../jobs/tenant-purge-repo.ts";
import { unassignWithAudit } from "../requests/assign.ts";
import * as repo from "./repo.ts";

const ENTITY = "tenants";
const SLUG_UQ = "tenants_slug_key";

export interface TenantLiveEffects {
  rooms: { endByTenant(tenantId: string): Promise<void> };
  hub: { closeByTenant(tenantId: string): number; closeByAuthToken(tokenHash: string): number };
  /** Commit sonrası: iptal edilen talebin müşteri/panel bildirimi (`requests.closedAfterCommit`, AC-145). */
  requestClosed(tenantId: string, requestId: string): Promise<void>;
  /** Commit sonrası: `rs_bindings_revoked_total{reason:TENANT_PASSIVE}` (mimari-e10 §3.4). */
  bindingsRevoked(count: number): void;
  log: { error(obj: object, msg: string): void; info(obj: object, msg: string): void };
}

const actor = (auth: AuthContext) => ({ userId: auth.user.id, username: auth.user.email });

const slugConflict = (): AppError =>
  new AppError("CONFLICT", { message: TENANT_SLUG_CONFLICT_MESSAGE, fields: { slug: TENANT_SLUG_CONFLICT_MESSAGE } });

/** P16 (AC-242): `passiveSince` + açık silme işi rozeti (iş yoksa null). */
function toItem(r: repo.TenantRow, job: purgeRepo.JobRow | null = null): TenantItem {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status as TenantStatus,
    activeUserCount: r._count.users,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    passiveSince: r.passiveAt ? r.passiveAt.toISOString() : null,
    purge: job ? { state: job.state, scheduledFor: job.scheduledFor.toISOString(), step: job.step } : null,
  };
}

async function getOrThrow(db: Db, id: string): Promise<TenantItem> {
  const r = await repo.findTenant(db, id);
  if (!r) throw new AppError("NOT_FOUND");
  return toItem(r, await purgeRepo.findOpenJob(db, id));
}

export async function listTenants(db: Db, q: ListTenantsQuery): Promise<TenantListResponse> {
  const { rows, total } = await repo.listTenants(db, q);
  const jobs = new Map(
    (
      await purgeRepo.openJobsOf(
        db,
        rows.map((r) => r.id),
      )
    ).map((j) => [j.tenantId, j]),
  );
  return { items: rows.map((r) => toItem(r, jobs.get(r.id) ?? null)), page: q.page, pageSize: q.pageSize, total };
}

export const getTenant = getOrThrow;

export async function createTenant(db: Db, ctx: AuditContext, auth: AuthContext, input: CreateTenantData): Promise<TenantItem> {
  const id = newId();
  try {
    await db.$transaction(async (tx) => {
      await repo.insertTenant(tx, { id, name: input.name, slug: input.slug });
      const consent = await createInitialConsent(tx, { id, name: input.name });
      await writeAudit(tx, ctx, {
        tenantId: id,
        ...actor(auth),
        action: TENANT_AUDIT.CREATED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        newValue: { name: input.name, slug: input.slug, status: "ACTIVE", consentVersion: consent.version },
      });
    });
  } catch (err) {
    if (conflictIndex(err) === SLUG_UQ) throw slugConflict();
    throw err;
  }
  return getOrThrow(db, id);
}

export async function updateTenant(db: Db, ctx: AuditContext, auth: AuthContext, id: string, input: UpdateTenantData): Promise<TenantItem> {
  try {
    await db.$transaction(async (tx) => {
      const cur = await repo.lockTenant(tx, id);
      if (!cur) throw new AppError("NOT_FOUND");
      const next: Record<string, string> = {};
      const old: Record<string, string> = {};
      if (input.name !== undefined && input.name !== cur.name) [next.name, old.name] = [input.name, cur.name];
      if (input.slug !== undefined && input.slug !== cur.slug) [next.slug, old.slug] = [input.slug, cur.slug];
      if (Object.keys(next).length === 0) return;
      await repo.updateTenant(tx, id, next);
      await writeAudit(tx, ctx, {
        tenantId: id,
        ...actor(auth),
        action: TENANT_AUDIT.UPDATED,
        entity: ENTITY,
        entityId: id,
        result: "success",
        oldValue: old,
        newValue: next,
      });
    });
  } catch (err) {
    if (conflictIndex(err) === SLUG_UQ) throw slugConflict();
    throw err;
  }
  return getOrThrow(db, id);
}

/** Kayıt geçersizleştirme parti boyutu (bindings süpürücüsüyle aynı). */
const BINDING_BATCH = 1000;

/** POST /admin/tenants/:id/deactivate (AC-70, AC-115, AC-145, P14a AC-205). Zaten pasif → 409. */
export async function deactivateTenant(
  db: Db,
  fx: TenantLiveEffects,
  ctx: AuditContext,
  auth: AuthContext,
  id: string,
): Promise<TenantItem> {
  const done = await db.$transaction(async (tx) => {
    const cur = await repo.lockTenant(tx, id);
    if (!cur) throw new AppError("NOT_FOUND");
    if (cur.status === "PASSIVE") throw new AppError("CONFLICT", { message: "Firma zaten pasif." });
    const now = new Date();
    await repo.updateTenant(tx, id, { status: "PASSIVE" });
    const revokedSessions = await repo.revokeTenantSessions(tx, id, now);
    const cancelledSessions = await repo.cancelTenantPending(tx, id, now);
    // S-P18-T5: firma pasifinde bekleyen taleplerin ataması aynı TX'te kalkar (talepler ardından TENANT_PASSIVE iptal; panel
    // soketleri kapanacağı için `request.updated` yayını yok).
    await unassignWithAudit(tx, ctx, actor(auth), { tenantId: id });
    const requestIds = await repo.cancelTenantRequests(tx, id, now);
    let revokedBindings = 0;
    for (;;) {
      const n = await revokeTenantBindings(tx, id, now, BINDING_BATCH);
      revokedBindings += n;
      if (n < BINDING_BATCH) break;
    }
    for (const requestId of requestIds)
      await writeAudit(tx, ctx, {
        tenantId: id,
        ...actor(auth),
        action: "request.cancelled",
        entity: "support_requests",
        entityId: requestId,
        result: "success",
        oldValue: { status: "PENDING" },
        newValue: { status: "CANCELLED", reason: "TENANT_PASSIVE" },
      });
    if (revokedBindings > 0)
      await writeAudit(tx, ctx, {
        tenantId: id,
        ...actor(auth),
        action: BINDING_AUDIT.REVOKED,
        entity: "device_bindings",
        result: "success",
        newValue: { reason: "TENANT_PASSIVE", count: revokedBindings },
      });
    await writeAudit(tx, ctx, {
      tenantId: id,
      ...actor(auth),
      action: TENANT_AUDIT.DEACTIVATED,
      entity: ENTITY,
      entityId: id,
      result: "success",
      oldValue: { status: "ACTIVE" },
      newValue: { status: "PASSIVE", revokedSessions, cancelledSessions, cancelledRequests: requestIds.length, revokedBindings },
    });
    return { requestIds, revokedBindings };
  });
  await afterDeactivate(fx, id, done);
  return getOrThrow(db, id);
}

/** Yalnız bildirimler; her adım ayrı (biri düşse de diğerleri çalışır), hata loglanır — DB durumu zaten commit'te. */
async function afterDeactivate(fx: TenantLiveEffects, id: string, done: { requestIds: string[]; revokedBindings: number }): Promise<void> {
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      fx.log.error(
        { err, alarm: "tenant_passive_effect", step: name, tenantId: id },
        "firma pasife alma sonrası bildirim başarısız (yedek yol devralır)",
      );
    }
  };
  await step("rooms", () => fx.rooms.endByTenant(id));
  await step("panels", async () => fx.hub.closeByTenant(id));
  for (const requestId of done.requestIds) await step("requests", () => fx.requestClosed(id, requestId));
  await step("bindings", async () => fx.bindingsRevoked(done.revokedBindings));
}

/** GET /admin/tenants/options (P14b, AC-226). */
export async function tenantOptions(db: Db, q: TenantOptionsQuery): Promise<TenantOptionsResponse> {
  const rows = await repo.tenantOptions(db, q.q, q.limit);
  return { items: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, status: r.status as TenantStatus })) };
}

/** POST /admin/tenants/:id/reactivate: yalnız durum; iptal edilen oturum/talep/kayıtlar geri gelmez. Zaten aktif → 409. */
export async function reactivateTenant(db: Db, ctx: AuditContext, auth: AuthContext, id: string): Promise<TenantItem> {
  await db.$transaction(async (tx) => {
    const cur = await repo.lockTenant(tx, id);
    if (!cur) throw new AppError("NOT_FOUND");
    if (cur.status === "ACTIVE") throw new AppError("CONFLICT", { message: "Firma zaten aktif." });
    // P16 (AC-242, S16-10): açık silme işi varken yeniden etkinleştirme yok (DB tetikleyicisi de reddeder).
    const job = await purgeRepo.lockOpenJob(tx, id);
    if (job)
      throw new AppError("CONFLICT", {
        message: job.state === "SCHEDULED" ? TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE : TENANT_REACTIVATE_PURGE_PARTIAL_MESSAGE,
        fields: { jobId: job.id, state: job.state },
      });
    await repo.updateTenant(tx, id, { status: "ACTIVE" });
    await writeAudit(tx, ctx, {
      tenantId: id,
      ...actor(auth),
      action: TENANT_AUDIT.REACTIVATED,
      entity: ENTITY,
      entityId: id,
      result: "success",
      oldValue: { status: "PASSIVE" },
      newValue: { status: "ACTIVE" },
    });
  });
  return getOrThrow(db, id);
}

/**
 * POST /admin/switch-tenant (AC-70): yalnız ACTIVE firmaya (yok/pasif → 404); `null` bağlamdan çıkar. Değişim
 * yoksa yazma/audit yok. Commit sonrası bu oturumun panel soketleri 4401 (eski bağlam — G-E9-14).
 */
export async function switchTenant(
  db: Db,
  fx: TenantLiveEffects,
  ctx: AuditContext,
  auth: AuthContext,
  tokenHash: string,
  tenantId: string | null,
): Promise<SwitchTenantResponse> {
  const before = auth.actingTenant?.id ?? null;
  let target: SwitchTenantResponse["actingTenant"] = null;
  if (tenantId !== null) {
    const t = await repo.findTenant(db, tenantId);
    if (!t || t.status !== "ACTIVE") throw new AppError("NOT_FOUND");
    target = { id: t.id, name: t.name, slug: t.slug };
  }
  if (before === tenantId) return { actingTenant: target };
  await db.$transaction(async (tx) => {
    await repo.setActingTenant(tx, auth.sessionId, tenantId);
    await writeAudit(tx, ctx, {
      tenantId: tenantId ?? before,
      ...actor(auth),
      action: TENANT_AUDIT.SWITCHED,
      entity: "auth_sessions",
      entityId: auth.sessionId,
      result: "success",
      oldValue: { actingTenantId: before },
      newValue: { actingTenantId: tenantId },
    });
  });
  fx.hub.closeByAuthToken(tokenHash);
  return { actingTenant: target };
}

// --- tenant ayarları (AC-4; P10: AC-67 requireTech2fa, AC-78/79/122 SMTP) ---

function settingsView(r: repo.SettingsRow): TenantSettingsView {
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

export async function getTenantSettings(db: Db, tenantId: string): Promise<TenantSettingsView> {
  return settingsView(await repo.ensureSettings(db, tenantId));
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

/**
 * PUT /settings/tenant: aralıklar zod'da (400); yalnız değişen alanlar yazılır ve audit'e eski → yeni girer.
 * SMTP (AC-78, 122): host netguard'dan geçmeli (TX dışında, DNS); şifre boşsa korunur, kullanıcı silinirse şifre de
 * silinir; şifre audit'e yalnız `smtpPassword: "***"` olarak (değiştiyse) girer.
 */
export async function updateTenantSettings(
  db: Db,
  sec: { secrets: SecretBox; netguard: NetGuard },
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: UpdateTenantSettingsData,
): Promise<TenantSettingsView> {
  if (input.smtp) await sec.netguard.resolve(input.smtp.host);
  return db.$transaction(async (tx) => {
    const cur = await repo.lockSettings(tx, tenantId);
    const next: Record<string, unknown> = {};
    const old: Record<string, unknown> = {};
    for (const k of SCALARS) {
      const v = input[k];
      if (v !== undefined && v !== cur[k]) [next[k], old[k]] = [v, cur[k]];
    }
    const data: Record<string, unknown> = { ...next };
    if (input.smtp !== undefined) {
      const before = smtpAudit(cur);
      const s = input.smtp;
      const passEnc =
        s === null || s.user === null
          ? null
          : s.password !== undefined
            ? sec.secrets.encrypt(s.password, aadFor.smtpPassword(tenantId))
            : cur.smtpPassEnc;
      const after: SmtpAudit =
        s === null
          ? { host: null, port: null, security: null, user: null, fromName: null, fromEmail: null }
          : { host: s.host, port: s.port, security: s.security, user: s.user, fromName: s.fromName, fromEmail: s.fromEmail };
      const passChanged = (s?.password !== undefined && s.user !== null) || (passEnc === null && cur.smtpPassEnc !== null);
      if (JSON.stringify(before) !== JSON.stringify(after) || passChanged) {
        Object.assign(data, {
          smtpHost: after.host,
          smtpPort: after.port,
          smtpSecurity: after.security,
          smtpUser: after.user,
          smtpFromName: after.fromName,
          smtpFromEmail: after.fromEmail,
          smtpPassEnc: passEnc,
        });
        old.smtp = before;
        next.smtp = passChanged ? { ...after, smtpPassword: "***" } : after;
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
  });
}
