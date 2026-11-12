// Firma (tenant) yönetimi, Super Admin firma geçişi ve tenant ayarları (P9; AC-70, AC-4, AC-115, AC-145;
// mimari-e9 §3.4 `cancelAllForTenant`, mimari-e10 §3.4 `revokeForTenant`).
// Pasife alma: tek TX'te durum + tenant kullanıcılarının oturumları iptal + bekleyen kod oturumları CANCELLED
// (tenant_passive) + audit; commit SONRASI canlı odalar `tenant_passive` ile biter, panel soketleri 4401, bekleyen
// talepler TENANT_PASSIVE iptal, bilgisayar kayıtları geçersiz. Commit sonrası adımların yedekleri: talep ve kayıt
// süpürücüleri (30 sn) ve /ws/tech 60 sn yeniden doğrulaması (pasif tenant → endByTechnician).
import type { CreateTenantData, ListTenantsQuery, SmtpSecurity, SwitchTenantResponse, TenantItem, TenantListResponse, TenantSettingsView, TenantStatus, UpdateTenantData, UpdateTenantSettingsData } from "@remote/contracts/api/tenants";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { NetGuard } from "../lib/netguard.ts";
import { TENANT_SLUG_CONFLICT_MESSAGE } from "@remote/contracts/api/tenants";
import { TENANT_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { createInitialConsent } from "../public/consent.ts";
import * as repo from "./repo.ts";

const ENTITY = "tenants";
const SLUG_UQ = "tenants_slug_key";

export interface TenantLiveEffects {
  rooms: { endByTenant(tenantId: string): Promise<void> };
  hub: { closeByTenant(tenantId: string): number; closeByAuthToken(tokenHash: string): number };
  /** `requests.cancelAllForTenant` (AC-145). */
  cancelRequests(tenantId: string): Promise<number>;
  /** `bindings.revokeForTenant` (mimari-e10 §3.4). */
  revokeBindings(tenantId: string): Promise<number>;
  log: { error(obj: object, msg: string): void; info(obj: object, msg: string): void };
}

const actor = (auth: AuthContext) => ({ userId: auth.user.id, username: auth.user.email });

const slugConflict = (): AppError => new AppError("CONFLICT", { message: TENANT_SLUG_CONFLICT_MESSAGE, fields: { slug: TENANT_SLUG_CONFLICT_MESSAGE } });

function toItem(r: repo.TenantRow): TenantItem {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status as TenantStatus,
    activeUserCount: r._count.users,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function getOrThrow(db: Db, id: string): Promise<TenantItem> {
  const r = await repo.findTenant(db, id);
  if (!r) throw new AppError("NOT_FOUND");
  return toItem(r);
}

export async function listTenants(db: Db, q: ListTenantsQuery): Promise<TenantListResponse> {
  const { rows, total } = await repo.listTenants(db, q);
  return { items: rows.map(toItem), page: q.page, pageSize: q.pageSize, total };
}

export const getTenant = getOrThrow;

export async function createTenant(db: Db, ctx: AuditContext, auth: AuthContext, input: CreateTenantData): Promise<TenantItem> {
  const id = newId();
  try {
    await db.$transaction(async (tx) => {
      await repo.insertTenant(tx, { id, name: input.name, slug: input.slug });
      const consent = await createInitialConsent(tx, { id, name: input.name });
      await writeAudit(tx, ctx, { tenantId: id, ...actor(auth), action: TENANT_AUDIT.CREATED, entity: ENTITY, entityId: id, result: "success", newValue: { name: input.name, slug: input.slug, status: "ACTIVE", consentVersion: consent.version } });
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
      await writeAudit(tx, ctx, { tenantId: id, ...actor(auth), action: TENANT_AUDIT.UPDATED, entity: ENTITY, entityId: id, result: "success", oldValue: old, newValue: next });
    });
  } catch (err) {
    if (conflictIndex(err) === SLUG_UQ) throw slugConflict();
    throw err;
  }
  return getOrThrow(db, id);
}

/** POST /admin/tenants/:id/deactivate (AC-70, AC-115, AC-145). Zaten pasif → 409. */
export async function deactivateTenant(db: Db, fx: TenantLiveEffects, ctx: AuditContext, auth: AuthContext, id: string): Promise<TenantItem> {
  await db.$transaction(async (tx) => {
    const cur = await repo.lockTenant(tx, id);
    if (!cur) throw new AppError("NOT_FOUND");
    if (cur.status === "PASSIVE") throw new AppError("CONFLICT", { message: "Firma zaten pasif." });
    const now = new Date();
    await repo.updateTenant(tx, id, { status: "PASSIVE" });
    const revokedSessions = await repo.revokeTenantSessions(tx, id, now);
    const cancelledSessions = await repo.cancelTenantPending(tx, id, now);
    await writeAudit(tx, ctx, { tenantId: id, ...actor(auth), action: TENANT_AUDIT.DEACTIVATED, entity: ENTITY, entityId: id, result: "success", oldValue: { status: "ACTIVE" }, newValue: { status: "PASSIVE", revokedSessions, cancelledSessions } });
  });
  await afterDeactivate(fx, id);
  return getOrThrow(db, id);
}

/** Her adım ayrı: biri düşse de diğerleri çalışır; hata loglanır (yedek yollar §başlık). */
async function afterDeactivate(fx: TenantLiveEffects, id: string): Promise<void> {
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (err) {
      fx.log.error({ err, alarm: "tenant_passive_effect", step: name, tenantId: id }, "firma pasife alma sonrası adım başarısız (yedek yol devralır)");
    }
  };
  await step("rooms", () => fx.rooms.endByTenant(id));
  await step("panels", async () => fx.hub.closeByTenant(id));
  await step("requests", () => fx.cancelRequests(id));
  await step("bindings", () => fx.revokeBindings(id));
}

/** POST /admin/tenants/:id/reactivate: yalnız durum; iptal edilen oturum/talep/kayıtlar geri gelmez. Zaten aktif → 409. */
export async function reactivateTenant(db: Db, ctx: AuditContext, auth: AuthContext, id: string): Promise<TenantItem> {
  await db.$transaction(async (tx) => {
    const cur = await repo.lockTenant(tx, id);
    if (!cur) throw new AppError("NOT_FOUND");
    if (cur.status === "ACTIVE") throw new AppError("CONFLICT", { message: "Firma zaten aktif." });
    await repo.updateTenant(tx, id, { status: "ACTIVE" });
    await writeAudit(tx, ctx, { tenantId: id, ...actor(auth), action: TENANT_AUDIT.REACTIVATED, entity: ENTITY, entityId: id, result: "success", oldValue: { status: "PASSIVE" }, newValue: { status: "ACTIVE" } });
  });
  return getOrThrow(db, id);
}

/**
 * POST /admin/switch-tenant (AC-70): yalnız ACTIVE firmaya (yok/pasif → 404); `null` bağlamdan çıkar. Değişim
 * yoksa yazma/audit yok. Commit sonrası bu oturumun panel soketleri 4401 (eski bağlam — G-E9-14).
 */
export async function switchTenant(db: Db, fx: TenantLiveEffects, ctx: AuditContext, auth: AuthContext, tokenHash: string, tenantId: string | null): Promise<SwitchTenantResponse> {
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
    await writeAudit(tx, ctx, { tenantId: tenantId ?? before, ...actor(auth), action: TENANT_AUDIT.SWITCHED, entity: "auth_sessions", entityId: auth.sessionId, result: "success", oldValue: { actingTenantId: before }, newValue: { actingTenantId: tenantId } });
  });
  fx.hub.closeByAuthToken(tokenHash);
  return { actingTenant: target };
}

// --- tenant ayarları (AC-4; P10: AC-67 requireTech2fa, AC-78/79/122 SMTP) ---

function settingsView(r: repo.SettingsRow): TenantSettingsView {
  const { sessionTtlMin, maxOpenSessions, maxActiveHours, maxFileMb, retentionDays, requireTech2fa } = r;
  const smtp =
    r.smtpHost && r.smtpPort && r.smtpSecurity && r.smtpFromEmail
      ? { host: r.smtpHost, port: r.smtpPort, security: r.smtpSecurity as SmtpSecurity, user: r.smtpUser, fromName: r.smtpFromName, fromEmail: r.smtpFromEmail, hasPassword: r.smtpPassEnc !== null }
      : null;
  return { sessionTtlMin, maxOpenSessions, maxActiveHours, maxFileMb, retentionDays, requireTech2fa, smtp };
}

export async function getTenantSettings(db: Db, tenantId: string): Promise<TenantSettingsView> {
  return settingsView(await repo.ensureSettings(db, tenantId));
}

const SCALARS = ["sessionTtlMin", "maxOpenSessions", "maxActiveHours", "maxFileMb", "retentionDays", "requireTech2fa"] as const;
type SmtpAudit = { host: string | null; port: number | null; security: string | null; user: string | null; fromName: string | null; fromEmail: string | null };
const smtpAudit = (r: { smtpHost: string | null; smtpPort: number | null; smtpSecurity: string | null; smtpUser: string | null; smtpFromName: string | null; smtpFromEmail: string | null }): SmtpAudit => ({
  host: r.smtpHost, port: r.smtpPort, security: r.smtpSecurity, user: r.smtpUser, fromName: r.smtpFromName, fromEmail: r.smtpFromEmail,
});

/**
 * PUT /settings/tenant: aralıklar zod'da (400); yalnız değişen alanlar yazılır ve audit'e eski → yeni girer.
 * SMTP (AC-78, 122): host netguard'dan geçmeli (TX dışında, DNS); şifre boşsa korunur, kullanıcı silinirse şifre de
 * silinir; şifre audit'e yalnız `smtpPassword: "***"` olarak (değiştiyse) girer.
 */
export async function updateTenantSettings(db: Db, sec: { secrets: SecretBox; netguard: NetGuard }, ctx: AuditContext, auth: AuthContext, tenantId: string, input: UpdateTenantSettingsData): Promise<TenantSettingsView> {
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
      const passEnc = s === null || s.user === null ? null : s.password !== undefined ? sec.secrets.encrypt(s.password, aadFor.smtpPassword(tenantId)) : cur.smtpPassEnc;
      const after: SmtpAudit = s === null ? { host: null, port: null, security: null, user: null, fromName: null, fromEmail: null } : { host: s.host, port: s.port, security: s.security, user: s.user, fromName: s.fromName, fromEmail: s.fromEmail };
      const passChanged = (s?.password !== undefined && s.user !== null) || (passEnc === null && cur.smtpPassEnc !== null);
      if (JSON.stringify(before) !== JSON.stringify(after) || passChanged) {
        Object.assign(data, { smtpHost: after.host, smtpPort: after.port, smtpSecurity: after.security, smtpUser: after.user, smtpFromName: after.fromName, smtpFromEmail: after.fromEmail, smtpPassEnc: passEnc });
        old.smtp = before;
        next.smtp = passChanged ? { ...after, smtpPassword: "***" } : after;
      }
    }
    if (Object.keys(data).length === 0) return settingsView(cur);
    const saved = await repo.updateSettings(tx, tenantId, data);
    await writeAudit(tx, ctx, { tenantId, ...actor(auth), action: TENANT_AUDIT.SETTINGS_UPDATED, entity: "tenant_settings", entityId: tenantId, result: "success", oldValue: old as never, newValue: next as never });
    return settingsView(saved);
  });
}
