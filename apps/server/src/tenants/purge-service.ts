// P16 G3 firma kalıcı silme uçları (AC-242; ADR-0030 m.5–m.6, mimari-e11 §7.5). SUPER_ADMIN; zamanlama/iptal step-up.
// `previewId` = `<exp ms>.<HMAC-SHA256 hex>` (HKDF etiketi `purge-preview`): firma, aktör, `authSessionId`, `passive_at`,
// FAILED işin `id:updated_at` (ya da `none`) ve son geçerlilik (15 dk, DB saati) üzerine. Tek kullanım `preview_hash` UQ
// (SHA-256(previewId)); iş durumu değişince eski önizleme de geçersiz (S16-6). `previewId` audit'e/loga yazılmaz.
import {
  TENANT_PURGE_CANCEL_CONFLICT_MESSAGE,
  TENANT_PURGE_CONFIRM_MISMATCH_MESSAGE,
  TENANT_PURGE_JOBS_MAX,
  TENANT_PURGE_NOT_ELIGIBLE_MESSAGE,
  TENANT_PURGE_OPEN_JOB_MESSAGE,
  TENANT_PURGE_PASSIVE_DAYS,
  TENANT_PURGE_PREVIEW_REQUIRED_MESSAGE,
  TENANT_PURGE_PREVIEW_TTL_MIN,
  TENANT_PURGE_STEPS,
  type PurgeJobsResponse,
  type TenantPurgeCancelResponse,
  type TenantPurgeCounts,
  type TenantPurgePreviewResponse,
  type TenantPurgeScheduledResponse,
  type TenantPurgeStatus,
} from "@remote/contracts/api/tenants";
import { confirmNameMatches } from "@remote/contracts/api/users";
import { deletedTenantLabel, TENANT_PURGE_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import * as repo from "../jobs/tenant-purge-repo.ts";
import { tenantFiles } from "../jobs/tenant-purge.ts";
import type { SecretBox } from "../lib/crypto.ts";
import { conflictIndex, type Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, safeEqual, sha256Hex } from "../lib/ids.ts";
import type { UploadStore } from "../uploads/store.ts";

const ENTITY = "tenants";
const DAY_MS = 86_400_000;
const TTL_MS = TENANT_PURGE_PREVIEW_TTL_MIN * 60_000;
const PREVIEW_UQ = "tenant_purge_jobs_preview_hash_key";
const OPEN_UQ = "tenant_purge_jobs_one_open_uq";

export interface PurgeDeps {
  secrets: SecretBox;
  store: UploadStore;
}

const actor = (auth: AuthContext) => ({ userId: auth.user.id, username: auth.user.email });
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const previewRequired = (): AppError => new AppError("PREVIEW_REQUIRED", { message: TENANT_PURGE_PREVIEW_REQUIRED_MESSAGE });
const openConflict = (j: repo.JobRow): AppError =>
  new AppError("CONFLICT", { message: TENANT_PURGE_OPEN_JOB_MESSAGE, fields: { jobId: j.id, state: j.state } });

interface Target {
  id: string;
  /** Firma satırı silinmişse (FAILED işin TENANT_ROW sonrası sürdürülmesi) etiket "Silinmiş firma #XXXXXX". */
  name: string;
  exists: boolean;
  status: string | null;
  passiveAt: Date | null;
}

async function readTarget(db: Db | Prisma.TransactionClient, id: string, lock: boolean): Promise<Target | null> {
  const rows = lock
    ? await db.$queryRaw<{ name: string; status: string; passiveAt: Date | null }[]>`
        SELECT name, status, passive_at AS passiveAt FROM tenants WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`
    : await db.$queryRaw<{ name: string; status: string; passiveAt: Date | null }[]>`
        SELECT name, status, passive_at AS passiveAt FROM tenants WHERE id = ${id} AND deleted_at IS NULL`;
  const r = rows[0];
  return r ? { id, name: r.name, exists: true, status: r.status, passiveAt: r.passiveAt ? new Date(r.passiveAt) : null } : null;
}

/** Satırı silinmiş firma: yalnız FAILED işi varsa hedef (sürdürme); yoksa null (404). */
function goneTarget(id: string, open: repo.JobRow | null): Target | null {
  return open?.state === "FAILED" && open.tenantRowDeletedAt
    ? { id, name: deletedTenantLabel(id), exists: false, status: null, passiveAt: null }
    : null;
}

/** Uygunluk (DB saati): PASSIVE ve `passive_at + 30 g ≤ now`; aksi hâlde 409 `PURGE_NOT_ELIGIBLE` (`fields.eligibleAt|reason`). */
function assertEligible(t: Target, now: Date): void {
  if (!t.exists) return;
  if (t.status !== "PASSIVE" || !t.passiveAt)
    throw new AppError("PURGE_NOT_ELIGIBLE", { message: TENANT_PURGE_NOT_ELIGIBLE_MESSAGE, fields: { reason: "not_passive" } });
  const eligibleAt = new Date(t.passiveAt.getTime() + TENANT_PURGE_PASSIVE_DAYS * DAY_MS);
  if (eligibleAt > now)
    throw new AppError("PURGE_NOT_ELIGIBLE", {
      message: TENANT_PURGE_NOT_ELIGIBLE_MESSAGE,
      fields: { eligibleAt: eligibleAt.toISOString() },
    });
}

function previewMaterial(t: Target, auth: AuthContext, open: repo.JobRow | null, exp: number): string {
  const job = open ? `${open.id}:${open.updatedAt.getTime()}` : "none";
  return [t.id, auth.user.id, auth.sessionId, t.passiveAt ? t.passiveAt.getTime() : "none", job, exp].join("|");
}

function verifyPreview(secrets: SecretBox, previewId: string, material: (exp: number) => string, now: Date): void {
  const m = /^(\d{13})\.([0-9a-f]{64})$/.exec(previewId);
  if (!m) throw previewRequired();
  const exp = Number(m[1]);
  if (exp <= now.getTime() || exp > now.getTime() + TTL_MS + 60_000) throw previewRequired();
  const mac = m[2] ?? "";
  if (!secrets.macCandidates("purge-preview", material(exp)).some((c) => safeEqual(c, mac))) throw previewRequired();
}

/** POST /admin/tenants/:id/purge `{dryRun: true}` — sayılar + `previewId` (salt okuma; audit yalnız sayılar). */
export async function previewPurge(
  db: Db,
  d: PurgeDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
): Promise<TenantPurgePreviewResponse> {
  const open = await repo.findOpenJob(db, tenantId);
  const t = (await readTarget(db, tenantId, false)) ?? goneTarget(tenantId, open);
  if (!t) throw new AppError("NOT_FOUND");
  if (open && open.state !== "FAILED") throw openConflict(open);
  const now = await repo.dbNow(db);
  assertEligible(t, now);
  const counts = await repo.countRemaining(db, tenantId, t.exists);
  const files = await tenantFiles(d.store, tenantId);
  const auditRetained = await repo.countAudit(db, tenantId);
  const exp = now.getTime() + TTL_MS;
  const previewId = `${exp}.${d.secrets.mac("purge-preview", previewMaterial(t, auth, open, exp))}`;
  const since = t.passiveAt ?? open?.tenantRowDeletedAt ?? now;
  await writeAudit(db, ctx, {
    tenantId,
    ...actor(auth),
    action: TENANT_PURGE_AUDIT.PREVIEWED,
    entity: ENTITY,
    entityId: tenantId,
    result: "success",
    newValue: { counts, files, auditRetained, ...(open ? { jobId: open.id } : {}) },
  });
  return {
    previewId,
    expiresAt: new Date(exp).toISOString(),
    tenant: { id: tenantId, name: t.name },
    passiveSince: since.toISOString(),
    eligibleAt: new Date(since.getTime() + (t.exists ? TENANT_PURGE_PASSIVE_DAYS * DAY_MS : 0)).toISOString(),
    counts,
    files,
    auditRetained,
  };
}

/**
 * POST `{dryRun: false, previewId, confirmName}` (step-up rotada). Tek TX: firma + açık iş `FOR UPDATE` → önizleme (428) →
 * ad (400) → uygunluk (409) → açık iş (409) → yeni SCHEDULED iş (`scheduled_for` DB'den) ya da FAILED işi RUNNING.
 */
export async function schedulePurge(
  db: Db,
  d: PurgeDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: { previewId: string; confirmName: string },
): Promise<TenantPurgeScheduledResponse> {
  try {
    return await db.$transaction(async (tx) => {
      const live = await readTarget(tx, tenantId, true);
      const open = await repo.lockOpenJob(tx, tenantId);
      const t = live ?? goneTarget(tenantId, open);
      if (!t) throw new AppError("NOT_FOUND");
      const now = await repo.dbNow(tx);
      verifyPreview(d.secrets, input.previewId, (exp) => previewMaterial(t, auth, open, exp), now);
      if (!confirmNameMatches(input.confirmName, t.name))
        throw new AppError("VALIDATION", { fields: { confirmName: TENANT_PURGE_CONFIRM_MISMATCH_MESSAGE } });
      assertEligible(t, now);
      const previewHash = sha256Hex(input.previewId);
      if (open && open.state !== "FAILED") throw openConflict(open);
      if (open) {
        if ((await repo.resumeJob(tx, open.id, previewHash)) !== 1) throw previewRequired();
        await audit(tx, ctx, auth, tenantId, TENANT_PURGE_AUDIT.STARTED, { jobId: open.id, resumed: true, step: open.step });
        return { jobId: open.id, state: "RUNNING" as const, scheduledFor: open.scheduledFor.toISOString() };
      }
      const job = await repo.insertJob(tx, { id: newId(), tenantId, previewHash, startedBy: auth.user.id });
      await audit(tx, ctx, auth, tenantId, TENANT_PURGE_AUDIT.SCHEDULED, { jobId: job.id, scheduledFor: job.scheduledFor.toISOString() });
      return { jobId: job.id, state: "SCHEDULED" as const, scheduledFor: job.scheduledFor.toISOString() };
    });
  } catch (err) {
    const idx = conflictIndex(err);
    if (idx === PREVIEW_UQ) throw previewRequired();
    if (idx === OPEN_UQ) throw new AppError("CONFLICT", { message: TENANT_PURGE_OPEN_JOB_MESSAGE });
    throw err;
  }
}

function audit(
  tx: Parameters<typeof writeAudit>[0],
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  action: string,
  v: Record<string, string | boolean>,
) {
  return writeAudit(tx, ctx, { tenantId, ...actor(auth), action, entity: ENTITY, entityId: tenantId, result: "success", newValue: v });
}

/** DELETE /admin/tenants/:id/purge — yalnız SCHEDULED iş iptal edilir (iş yok → 404, başka durum → 409). */
export async function cancelPurge(db: Db, ctx: AuditContext, auth: AuthContext, tenantId: string): Promise<TenantPurgeCancelResponse> {
  return db.$transaction(async (tx) => {
    const open = await repo.lockOpenJob(tx, tenantId);
    if (!open) throw new AppError("NOT_FOUND");
    if (open.state !== "SCHEDULED" || (await repo.cancelJob(tx, open.id, auth.user.id)) !== 1)
      throw new AppError("CONFLICT", { message: TENANT_PURGE_CANCEL_CONFLICT_MESSAGE, fields: { jobId: open.id, state: open.state } });
    await audit(tx, ctx, auth, tenantId, TENANT_PURGE_AUDIT.CANCELLED, { jobId: open.id });
    return { jobId: open.id, state: "CANCELLED" as const };
  });
}

/** GET /admin/tenants/:id/purge — son iş (firma satırı silinmiş olsa da); yoksa 404. */
export async function purgeStatus(db: Db, tenantId: string): Promise<TenantPurgeStatus> {
  const j = await repo.latestJob(db, tenantId);
  if (!j) throw new AppError("NOT_FOUND");
  return {
    jobId: j.id,
    state: j.state,
    step: j.step,
    stepIndex: TENANT_PURGE_STEPS.indexOf(j.step),
    stepCount: TENANT_PURGE_STEPS.length,
    scheduledFor: j.scheduledFor.toISOString(),
    counts: j.counts as TenantPurgeCounts,
    attempts: j.attempts,
    lastError: j.lastError,
    startedAt: iso(j.startedAt),
    heartbeatAt: iso(j.heartbeatAt),
    finishedAt: iso(j.finishedAt),
    cancelledAt: iso(j.cancelledAt),
  };
}

/** GET /admin/purge-jobs?open=1 — en yeni ≤ 100 iş (Super Admin bandı). */
export async function purgeJobs(db: Db, open: boolean): Promise<PurgeJobsResponse> {
  const rows = await repo.listJobs(db, open, TENANT_PURGE_JOBS_MAX);
  return {
    items: rows.map((r) => ({
      jobId: r.id,
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      state: r.state as PurgeJobsResponse["items"][number]["state"],
      scheduledFor: new Date(r.scheduledFor).toISOString(),
    })),
  };
}
