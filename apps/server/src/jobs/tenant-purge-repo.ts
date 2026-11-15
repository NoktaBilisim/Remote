// P16 G3 (AC-242; ADR-0030 m.2/m.5, mimari-e11 §7.3) firma silme işi veri erişimi. Adım tablosu tek yerde: her veri
// adımının silinecek satır sayımı (önizleme) ve parti işlemi (yürütücü) AYNI koşulla yazılır → önizleme sayısı = silinen
// sayı. Parti `LIMIT 500`; tablo adları sabit (kullanıcı girdisi yok), firma kimliği her zaman bağlı parametre.
// Koşullu DELETE'leri DB tetikleyicisi zorlar (PURGING: iş RUNNING + firma PASSIVE ≥ 30 g); uygulama koşulu tek savunma değil.
import type { TenantPurgeState, TenantPurgeStep } from "@remote/contracts/api/tenants";
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { byTenant, byTenantUser, n, unlinkBindings, USERS_OF, type TablePart } from "./tenant-purge-parts.ts";

type Tx = Prisma.TransactionClient;
type DbOrTx = Db | Tx;

/**
 * Veri adımları (ADR-0030 m.2, 2..14) → tablo parçaları. FENCE, TENANT_ROW, FILES, DONE özel adımlardır (yürütücü).
 * Meta-test: `tenants`'a FK veren tablolar ⊆ bu tablolar ∪ {auth_sessions (FENCE), tenants'a FK taşımayan istisnalar}.
 */
export const DATA_STEPS: Readonly<Partial<Record<TenantPurgeStep, readonly TablePart[]>>> = {
  SESSION_FILES: [byTenant("session_files")],
  SESSION_CONSENTS: [byTenant("session_consents")],
  // P18: IX(tenant_id, created_at). P19 (§8c.1): notification_outbox aynı adımda (yeni adım yok; IX(tenant_id, channel, created_at)
  // öneki; tetikleyicisiz) — support_requests'ten (REQUESTS) önce silinmeli (bileşik FK RESTRICT).
  MESSAGES: [byTenant("session_messages"), byTenant("notification_outbox")],
  REQUEST_UNLINK: [unlinkBindings],
  BINDINGS: [byTenant("device_bindings")],
  SESSIONS: [byTenant("support_sessions")],
  REQUESTS: [byTenant("support_requests")],
  REQUEST_BLOCKS: [byTenant("request_blocks")],
  REQUEST_REFS: [byTenant("request_refs")],
  CUSTOMERS: [byTenant("customers")],
  // P18: business_holidays (created_by → users) USERS adımından önce.
  SETTINGS: [byTenant("tenant_request_settings"), byTenant("tenant_settings"), byTenant("business_holidays")],
  CONSENT_TEXTS: [byTenant("consent_texts")],
  USER_CHILDREN: [
    byTenantUser("user_permissions"),
    byTenantUser("recovery_codes"),
    byTenantUser("password_reset_tokens"),
    byTenantUser("auth_sessions"),
  ],
  USERS: [byTenant("users")],
};

/** Önizleme: adım başına kalan satır (firma satırı varsa `TENANT_ROW: 1`). */
export async function countRemaining(
  db: DbOrTx,
  tenantId: string,
  tenantRowExists: boolean,
): Promise<Partial<Record<TenantPurgeStep, number>>> {
  const out: Partial<Record<TenantPurgeStep, number>> = {};
  for (const [step, parts] of Object.entries(DATA_STEPS) as [TenantPurgeStep, readonly TablePart[]][]) {
    let sum = 0;
    for (const p of parts) sum += await p.count(db, tenantId);
    out[step] = sum;
  }
  out.TENANT_ROW = tenantRowExists ? 1 : 0;
  return out;
}

/** Silinmeyen (730 g saklanan) audit satırları. */
export async function countAudit(db: DbOrTx, tenantId: string): Promise<number> {
  return n(await db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${tenantId}`);
}

// --- iş satırı ---

export interface JobRow {
  id: string;
  tenantId: string;
  state: TenantPurgeState;
  step: TenantPurgeStep;
  scheduledFor: Date;
  counts: Record<string, number>;
  attempts: number;
  lastError: string | null;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  tenantRowDeletedAt: Date | null;
  finishedAt: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

const jobSelect = {
  id: true,
  tenantId: true,
  state: true,
  step: true,
  scheduledFor: true,
  counts: true,
  attempts: true,
  lastError: true,
  startedAt: true,
  heartbeatAt: true,
  tenantRowDeletedAt: true,
  finishedAt: true,
  cancelledAt: true,
  updatedAt: true,
  createdAt: true,
} as const;

const asJob = (r: Prisma.TenantPurgeJobGetPayload<{ select: typeof jobSelect }>): JobRow => ({
  ...r,
  state: r.state as TenantPurgeState,
  step: r.step as TenantPurgeStep,
  counts: (r.counts ?? {}) as Record<string, number>,
});

const OPEN_STATES = ["SCHEDULED", "RUNNING", "FAILED"] as const;

export async function findJob(db: DbOrTx, id: string): Promise<JobRow | null> {
  const r = await db.tenantPurgeJob.findUnique({ where: { id }, select: jobSelect });
  return r ? asJob(r) : null;
}

export async function findOpenJob(db: DbOrTx, tenantId: string): Promise<JobRow | null> {
  const r = await db.tenantPurgeJob.findFirst({ where: { tenantId, state: { in: [...OPEN_STATES] } }, select: jobSelect });
  return r ? asJob(r) : null;
}

/** Son iş (durumdan bağımsız; firma satırı silinmiş olsa da). */
export async function latestJob(db: DbOrTx, tenantId: string): Promise<JobRow | null> {
  const r = await db.tenantPurgeJob.findFirst({ where: { tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: jobSelect });
  return r ? asJob(r) : null;
}

/** Açık iş satırını kilitler (firma başına en çok bir; DB fonksiyonel UQ). */
export async function lockOpenJob(tx: Tx, tenantId: string): Promise<JobRow | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM tenant_purge_jobs WHERE tenant_id = ${tenantId} AND state IN ('SCHEDULED', 'RUNNING', 'FAILED') FOR UPDATE`;
  return rows[0] ? findJob(tx, rows[0].id) : null;
}

export async function lockJob(tx: Tx, id: string): Promise<JobRow | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenant_purge_jobs WHERE id = ${id} FOR UPDATE`;
  return rows[0] ? findJob(tx, id) : null;
}

/** Firma bazında açık işler (liste rozeti; sayfa başına tek IN sorgusu). */
export async function openJobsOf(db: DbOrTx, tenantIds: string[]): Promise<JobRow[]> {
  if (tenantIds.length === 0) return [];
  const rows = await db.tenantPurgeJob.findMany({
    where: { tenantId: { in: tenantIds }, state: { in: [...OPEN_STATES] } },
    select: jobSelect,
  });
  return rows.map(asJob);
}

export async function listJobs(db: DbOrTx, open: boolean, take: number) {
  return db.$queryRaw<{ id: string; tenantId: string; tenantName: string | null; state: string; scheduledFor: Date }[]>`
    SELECT j.id, j.tenant_id AS tenantId, x.name AS tenantName, j.state, j.scheduled_for AS scheduledFor
    FROM tenant_purge_jobs j LEFT JOIN tenants x ON x.id = j.tenant_id
    WHERE (${open ? 1 : 0} = 0 OR j.state IN ('SCHEDULED', 'RUNNING', 'FAILED'))
    ORDER BY j.created_at DESC, j.id DESC LIMIT ${take}`;
}

/** Yeni SCHEDULED iş. `scheduled_for`'u tetikleyici zorlar (DB saati + 24 sa) → çağıran DB'den yeniden okur. */
export async function insertJob(tx: Tx, d: { id: string; tenantId: string; previewHash: string; startedBy: string }): Promise<JobRow> {
  await tx.tenantPurgeJob.create({ data: { ...d, scheduledFor: new Date(), counts: {} }, select: { id: true } });
  const j = await findJob(tx, d.id);
  if (!j) throw new Error("iş satırı okunamadı");
  return j;
}

/** FAILED → RUNNING (sürdürme; tetikleyici yeni `preview_hash` ister). Deneme sayacı ve son hata sıfırlanır. */
export async function resumeJob(tx: Tx, id: string, previewHash: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET state = 'RUNNING', preview_hash = ${previewHash}, attempts = 0, last_error = NULL,
      heartbeat_at = NULL, updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'FAILED'`;
}

export async function cancelJob(tx: Tx, id: string, by: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET state = 'CANCELLED', cancelled_by = ${by}, cancelled_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'SCHEDULED'`;
}

/** Zamanı gelmiş SCHEDULED iş → RUNNING (tetikleyici `UTC_SYSDATE >= scheduled_for` ister ve `started_at`'ı zorlar). */
export async function startJob(tx: Tx, id: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET state = 'RUNNING', started_at = UTC_TIMESTAMP(3), heartbeat_at = UTC_TIMESTAMP(3),
      updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'SCHEDULED' AND scheduled_for <= UTC_TIMESTAMP(3)`;
}

/** Parti sonrası: adım sayacı += n, heartbeat. */
export async function addCount(tx: Tx, id: string, step: TenantPurgeStep, by: number): Promise<void> {
  const path = `$.${step}`;
  await tx.$executeRaw`
    UPDATE tenant_purge_jobs SET counts = JSON_SET(counts, ${path}, COALESCE(JSON_EXTRACT(counts, ${path}), 0) + ${by}),
      heartbeat_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'RUNNING' AND step = ${step}`;
}

/** Adım birer ilerler (tetikleyici yalnız +1'e izin verir). */
export async function advance(tx: Tx, id: string, from: TenantPurgeStep, to: TenantPurgeStep): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET step = ${to}, heartbeat_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'RUNNING' AND step = ${from}`;
}

/** Firma satırı silindikten sonra AYNI TX'te: `tenant_row_deleted_at` (DB saati) + `step = FILES`. */
export async function markTenantRowDeleted(tx: Tx, id: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET tenant_row_deleted_at = UTC_TIMESTAMP(3), step = 'FILES',
      counts = JSON_SET(counts, '$.TENANT_ROW', 1), heartbeat_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'RUNNING' AND step = 'TENANT_ROW'`;
}

/** DONE tek UPDATE'te: `state = step = 'DONE'` (finished_at tetikleyiciyle DB saati). */
export async function finishJob(tx: Tx, id: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET state = 'DONE', step = 'DONE', finished_at = UTC_TIMESTAMP(3), heartbeat_at = UTC_TIMESTAMP(3),
      updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'RUNNING' AND step = 'FILES'`;
}

/** Hata: deneme sayacı + sınıf; `fail` ise RUNNING → FAILED. */
export async function recordError(tx: Tx, id: string, errorClass: string, fail: boolean): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET attempts = attempts + 1, last_error = ${errorClass}, heartbeat_at = UTC_TIMESTAMP(3),
      state = IF(${fail ? 1 : 0} = 1, 'FAILED', state), updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'RUNNING'`;
}

/** Uygunluk reddi: deneme sayılmadan doğrudan FAILED (`invalid_job`). */
export async function failInvalid(tx: Tx, id: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE tenant_purge_jobs SET state = 'FAILED', last_error = 'invalid_job', heartbeat_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
    WHERE id = ${id} AND state = 'RUNNING'`;
}

/**
 * Sıradaki iş (tek): zamanı gelmiş SCHEDULED ya da alınabilir RUNNING — hiç hata yoksa heartbeat > 30 dk (çökme/yeniden
 * başlatma), hata varsa üstel bekleme (1., 2., 3. hatadan sonra 1, 5, 30 dk) dolmuş. DB saatiyle.
 */
export async function nextJobId(db: DbOrTx): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM tenant_purge_jobs
    WHERE (state = 'SCHEDULED' AND scheduled_for <= UTC_TIMESTAMP(3))
       OR (state = 'RUNNING' AND (heartbeat_at IS NULL OR heartbeat_at <= UTC_TIMESTAMP(3) - INTERVAL
            (CASE attempts WHEN 0 THEN 1800 WHEN 1 THEN 60 WHEN 2 THEN 300 ELSE 1800 END) SECOND))
    ORDER BY scheduled_for, id LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** Uygunluk (DB saati): firma satırı, durum, `passive_at` ≥ 30 g. */
export async function tenantEligibility(db: DbOrTx, tenantId: string) {
  const rows = await db.$queryRaw<{ exists_: bigint; passive: bigint | null; aged: bigint | null }[]>`
    SELECT COUNT(*) AS exists_,
      MAX(CAST(status AS BINARY) = 'PASSIVE') AS passive,
      MAX(passive_at IS NOT NULL AND passive_at <= UTC_TIMESTAMP(3) - INTERVAL 30 DAY) AS aged
    FROM tenants WHERE id = ${tenantId}`;
  const r = rows[0];
  return { exists: Number(r?.exists_ ?? 0) > 0, passive: Number(r?.passive ?? 0) === 1, aged: Number(r?.aged ?? 0) === 1 };
}

/** FENCE: firma kullanıcılarının açık giriş oturumları iptal; Super Admin oturumlarının firma bağlamı NULL. */
export async function fence(tx: Tx, tenantId: string): Promise<{ revoked: number; detached: number }> {
  const revoked = await tx.$executeRaw`
    UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(3) WHERE revoked_at IS NULL AND user_id IN (${USERS_OF(tenantId)})`;
  const detached = await detachActing(tx, tenantId);
  return { revoked, detached };
}

export function detachActing(tx: Tx, tenantId: string): Promise<number> {
  return tx.$executeRaw`UPDATE auth_sessions SET acting_tenant_id = NULL WHERE acting_tenant_id = ${tenantId}`;
}

export function deleteTenantRow(tx: Tx, tenantId: string): Promise<number> {
  return tx.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}`;
}

/** Gösterge: durum başına iş sayısı + RUNNING işlerin en yeni heartbeat'i (epoch sn; yoksa 0). */
export async function gaugeSnapshot(db: DbOrTx): Promise<{ states: Record<string, number>; heartbeat: number }> {
  const rows = await db.$queryRaw<{ state: string; c: bigint }[]>`SELECT state, COUNT(*) AS c FROM tenant_purge_jobs GROUP BY state`;
  const hb = await db.$queryRaw<{ t: Date | null }[]>`SELECT MAX(heartbeat_at) AS t FROM tenant_purge_jobs WHERE state = 'RUNNING'`;
  const states: Record<string, number> = {};
  for (const r of rows) states[r.state] = Number(r.c);
  const t = hb[0]?.t;
  return { states, heartbeat: t ? Math.floor(new Date(t).getTime() / 1000) : 0 };
}

export async function dbNow(db: DbOrTx): Promise<Date> {
  const r = await db.$queryRaw<{ t: Date }[]>`SELECT UTC_TIMESTAMP(3) AS t`;
  return new Date(r[0]?.t ?? Date.now());
}
