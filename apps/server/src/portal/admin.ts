// P21 panel tarafı portal hesap yönetimi (mimari-p21 §4.3, K-P21-4/5/9/11/13). Müşteri `(tenantId, customerId)` yoksa 404;
// hesap `(tenantId, customerId, accountId)` üçlüsüyle aranır (başka müşterinin/firmanın hesabı 404). Durum geçişleri koşullu
// UPDATE (idempotent); çoklu yazma tek TX + audit (aktör Admin, `entity = portal_users`). Geçici şifre yalnız yanıtta bir kez —
// audit'e ve loga ASLA (logger `*.temporaryPassword` redakte).
import {
  PORTAL_ACCOUNTS_PER_CUSTOMER_MAX,
  PORTAL_TEMP_PASSWORD_TTL_HOURS,
  type PortalAccountCreateResponse,
  type PortalAccountItem,
  type PortalAccountListResponse,
  type PortalAccountStatus,
  type PortalPasswordResetResponse,
} from "@remote/contracts/api/portal";
import { TEMPORARY_PASSWORD_LENGTH } from "@remote/contracts/api/users";
import { PORTAL_AUDIT, PORTAL_USERS_ENTITY } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { hashPassword } from "../auth/password.ts";
import type { AuthContext } from "../auth/session.ts";
import * as crepo from "../customers/repo.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newTemporaryPassword } from "../lib/ids.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import * as repo from "./repo.ts";

const HOUR_MS = 3_600_000;
const EMAIL_UQ = "portal_users_tenant_id_email_key";
const EMAIL_UNAVAILABLE = "Bu e-posta adresiyle portal hesabı açılamaz.";

export interface PortalAdminDeps {
  db: Db;
  publicBaseUrl: string;
  createLimit: FixedWindowCounter;
  now?: () => number;
}

const nowOf = (d: PortalAdminDeps): Date => new Date(d.now?.() ?? Date.now());

const adminWho = (auth: AuthContext, tenantId: string) => ({
  tenantId,
  userId: auth.user.id,
  username: auth.user.email,
  entity: PORTAL_USERS_ENTITY,
});

export function accountItem(a: repo.PortalAccountRow, now: Date): PortalAccountItem {
  return {
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    status: a.status as PortalAccountStatus,
    totpEnabled: a.totpEnabled,
    mustChangePassword: a.mustChangePassword,
    tempPasswordExpired: a.mustChangePassword && a.tempPasswordExpiresAt !== null && a.tempPasswordExpiresAt <= now,
    lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    passiveAt: a.passiveAt?.toISOString() ?? null,
  };
}

/** Müşteri bu firmada mı (yoksa 404); durum ve anonimlik çağıranda değerlendirilir. */
async function customerOf(db: Db | Prisma.TransactionClient, tenantId: string, customerId: string) {
  const c = await db.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true, status: true, anonymizedAt: true } });
  if (!c) throw new AppError("NOT_FOUND");
  return c;
}

const customerUnusable = (): AppError =>
  new AppError("CONFLICT", { message: "Müşteri pasif veya anonimleştirilmiş; portal hesabı bu durumda değiştirilemez." });

async function accountOrThrow(db: Db | Prisma.TransactionClient, tenantId: string, customerId: string, id: string) {
  const a = await repo.findAccount(db, tenantId, customerId, id);
  if (!a) throw new AppError("NOT_FOUND");
  return a;
}

/** GET …/portal-accounts: ≤ 20, oluşturma sırası; `loginUrl` firmaya bağlı giriş adresi (r2 S-P21-3). */
export async function listPortalAccounts(d: PortalAdminDeps, tenantId: string, customerId: string): Promise<PortalAccountListResponse> {
  await customerOf(d.db, tenantId, customerId);
  const [rows, tenant] = await Promise.all([
    repo.listAccounts(d.db, tenantId, customerId, PORTAL_ACCOUNTS_PER_CUSTOMER_MAX),
    d.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } }),
  ]);
  const now = nowOf(d);
  const base = d.publicBaseUrl.replace(/\/+$/, "");
  return { items: rows.map((r) => accountItem(r, now)), loginUrl: `${base}/portal/login?tenant=${encodeURIComponent(tenant.slug)}` };
}

/**
 * POST …/portal-accounts: firma başına 30/sa → TX [müşteri FOR SHARE (ACTIVE, anonim değil) → 20 sınırı → INSERT → audit].
 * E-posta firma içinde tekil (UQ) → 409 `fields.email` (hangi müşteride olduğu söylenmez).
 */
export async function createPortalAccount(
  d: PortalAdminDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  customerId: string,
  input: { email: string; fullName: string },
): Promise<PortalAccountCreateResponse> {
  const wait = d.createLimit.blockedFor(tenantId);
  if (wait > 0 || d.createLimit.hit(tenantId))
    throw new AppError("RATE_LIMITED", { retryAfterSec: wait || d.createLimit.blockedFor(tenantId) || 60 });
  const customer = await customerOf(d.db, tenantId, customerId);
  if (customer.anonymizedAt !== null) throw customerUnusable();
  const temporaryPassword = newTemporaryPassword(TEMPORARY_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(temporaryPassword); // argon2 TX dışında
  const id = newId();
  const now = nowOf(d);
  try {
    await d.db.$transaction(async (tx) => {
      if ((await crepo.shareStatus(tx, tenantId, customerId)) !== "ACTIVE") throw customerUnusable();
      if ((await repo.countAccounts(tx, tenantId, customerId)) >= PORTAL_ACCOUNTS_PER_CUSTOMER_MAX)
        throw new AppError("CONFLICT", {
          message: `Bir müşteri için en çok ${PORTAL_ACCOUNTS_PER_CUSTOMER_MAX} portal hesabı açılabilir.`,
        });
      await tx.portalUser.create({
        data: {
          id,
          tenantId,
          customerId,
          email: input.email,
          fullName: input.fullName,
          passwordHash,
          mustChangePassword: true,
          tempPasswordExpiresAt: new Date(now.getTime() + PORTAL_TEMP_PASSWORD_TTL_HOURS * HOUR_MS),
          createdBy: auth.user.id,
          createdAt: now,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        ...adminWho(auth, tenantId),
        action: PORTAL_AUDIT.ACCOUNT_CREATED,
        entityId: id,
        result: "success",
        newValue: { customerId, email: input.email, fullName: input.fullName },
      });
    });
  } catch (err) {
    if (conflictIndex(err) === EMAIL_UQ)
      throw new AppError("CONFLICT", { message: EMAIL_UNAVAILABLE, fields: { email: EMAIL_UNAVAILABLE } });
    throw err;
  }
  return { account: accountItem(await accountOrThrow(d.db, tenantId, customerId, id), now), temporaryPassword };
}

/** POST …/deactivate: ACTIVE → PASSIVE + `passive_at` (aynı UPDATE — CHECK) + tüm portal oturumları iptal (aynı TX). Zaten pasif → aynı satır. */
export async function deactivatePortalAccount(
  d: PortalAdminDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  customerId: string,
  id: string,
): Promise<PortalAccountItem> {
  await customerOf(d.db, tenantId, customerId);
  const now = nowOf(d);
  await d.db.$transaction(async (tx) => {
    const r = await tx.portalUser.updateMany({
      where: { id, tenantId, customerId, status: "ACTIVE" },
      data: { status: "PASSIVE", passiveAt: now },
    });
    if (r.count === 0) return; // yok (aşağıda 404) ya da zaten pasif (idempotent; audit yok)
    const revokedSessions = await repo.revokePortalUserSessions(tx, tenantId, id, now);
    await writeAudit(tx, ctx, {
      ...adminWho(auth, tenantId),
      action: PORTAL_AUDIT.ACCOUNT_DEACTIVATED,
      entityId: id,
      result: "success",
      oldValue: { status: "ACTIVE" },
      newValue: { status: "PASSIVE", revokedSessions },
    });
  });
  return accountItem(await accountOrThrow(d.db, tenantId, customerId, id), now);
}

/** POST …/reactivate: müşteri pasif/anonim → 409; PASSIVE → ACTIVE + `passive_at` NULL. Zaten etkin → aynı satır. */
export async function reactivatePortalAccount(
  d: PortalAdminDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  customerId: string,
  id: string,
): Promise<PortalAccountItem> {
  const c = await customerOf(d.db, tenantId, customerId);
  await accountOrThrow(d.db, tenantId, customerId, id);
  if (c.status !== "ACTIVE" || c.anonymizedAt !== null) throw customerUnusable();
  const now = nowOf(d);
  await d.db.$transaction(async (tx) => {
    const r = await tx.portalUser.updateMany({
      where: { id, tenantId, customerId, status: "PASSIVE" },
      data: { status: "ACTIVE", passiveAt: null },
    });
    if (r.count === 0) return;
    await writeAudit(tx, ctx, {
      ...adminWho(auth, tenantId),
      action: PORTAL_AUDIT.ACCOUNT_REACTIVATED,
      entityId: id,
      result: "success",
      oldValue: { status: "PASSIVE" },
      newValue: { status: "ACTIVE" },
    });
  });
  return accountItem(await accountOrThrow(d.db, tenantId, customerId, id), now);
}

/**
 * POST …/reset-password (K-P21-5): hesap pasif → 409. Yeni geçici şifre (72 sa) + `must_change_password=1` (aynı UPDATE —
 * CHECK) + TOTP sıfır + kilit/sayaç sıfır + tüm portal oturumları iptal, tek TX. Audit `secondFactorCleared` (r2 S-P21-8).
 */
export async function resetPortalAccountPassword(
  d: PortalAdminDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  customerId: string,
  id: string,
): Promise<PortalPasswordResetResponse> {
  await customerOf(d.db, tenantId, customerId);
  const before = await accountOrThrow(d.db, tenantId, customerId, id);
  if (before.status !== "ACTIVE") throw new AppError("CONFLICT", { message: "Pasif hesabın şifresi sıfırlanamaz; önce etkinleştirin." });
  const temporaryPassword = newTemporaryPassword(TEMPORARY_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(temporaryPassword);
  const now = nowOf(d);
  await d.db.$transaction(async (tx) => {
    const fresh = await repo.lockPortalUser(tx, id);
    if (!fresh || fresh.status !== "ACTIVE")
      throw new AppError("CONFLICT", { message: "Pasif hesabın şifresi sıfırlanamaz; önce etkinleştirin." });
    await tx.portalUser.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        tempPasswordExpiresAt: new Date(now.getTime() + PORTAL_TEMP_PASSWORD_TTL_HOURS * HOUR_MS),
        totpEnabled: false,
        totpSecretEnc: null,
        totpLastStep: null,
        failedLoginCount: 0,
        failedWindowAt: null,
        lockedUntil: null,
      },
      select: { id: true },
    });
    const revokedSessions = await repo.revokePortalUserSessions(tx, tenantId, id, now);
    await writeAudit(tx, ctx, {
      ...adminWho(auth, tenantId),
      action: PORTAL_AUDIT.ACCOUNT_PASSWORD_RESET,
      entityId: id,
      result: "success",
      newValue: { revokedSessions, secondFactorCleared: fresh.totpEnabled },
    });
  });
  return { temporaryPassword };
}
