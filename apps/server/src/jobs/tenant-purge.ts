// P16 G3 firma silme yürütücüsü (AC-242; ADR-0030 m.2/m.5, mimari-e11 §7.3). 60 sn tur, tur başına tek iş, iş satırı
// her partide `FOR UPDATE`. Her turun başında uygunluk DB saatiyle yeniden doğrulanır (S16-2): adım ≤ TENANT_ROW iken
// firma PASSIVE + `passive_at` ≥ 30 g; sonrasında firma satırı yok + `tenant_row_deleted_at` dolu — aksi hâlde FAILED
// `invalid_job` (alarm), hiçbir adım çalışmaz. Parti: DELETE … LIMIT 500 + sayaç/heartbeat tek TX; 0 satırda adım +1.
// Hata sınıfları db_fk | db_signal | fs | other: 1., 2., 3. hatadan sonra 1/5/30 dk bekleyip yeniden; 4. hatada FAILED.
// Kesintiye dayanıklı: her şey commit'li adım/sayaçtan sürer (yeniden çalıştırma 0 satır siler).
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { TENANT_PREFIX_RE } from "@remote/contracts/api/branding";
import { TENANT_PURGE_STATES, TENANT_PURGE_STEPS, type TenantPurgeStep } from "@remote/contracts/api/tenants";
import { TENANT_PURGE_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { ErasureEntry } from "../ops/erasure-ledger.ts";
import type { UploadStore } from "../uploads/store.ts";
import * as repo from "./tenant-purge-repo.ts";
import { classifyPurgeError, FsStepError } from "./tenant-purge-errors.ts";

export const PURGE_INTERVAL_MS = 60_000;
/** 4. hatada FAILED (ilk üç hatadan sonra 1, 5, 30 dk bekleme — `repo.nextJobId`). */
const PURGE_MAX_ERRORS = 4;

const ENTITY = "tenants";
const SYSTEM_ACTOR = { userId: null, username: "system" } as const;
const ctx = (): AuditContext => ({ ip: "", userAgent: "tenant-purge", requestId: newId() });
const stepIndex = (s: TenantPurgeStep): number => TENANT_PURGE_STEPS.indexOf(s);
const nextStep = (s: TenantPurgeStep): TenantPurgeStep => TENANT_PURGE_STEPS[stepIndex(s) + 1] ?? "DONE";
const TENANT_ROW_INDEX = stepIndex("TENANT_ROW");

/**
 * `uploads/{tenantId}/` içindeki düzenli dosyalar (sembolik bağlantı izlenmez, sayılmaz). Kimlik yalnız
 * `TENANT_PREFIX_RE` ile (S16-2; `isPrefix` `system`'ı da kabul ederdi).
 */
export async function tenantFiles(store: UploadStore, tenantId: string): Promise<{ count: number; bytes: number }> {
  if (!TENANT_PREFIX_RE.test(tenantId)) return { count: 0, bytes: 0 };
  const dir = store.absDir(tenantId);
  const st = await lstat(dir).catch(() => null);
  if (!st?.isDirectory()) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (!f.isFile()) continue;
    const s = await lstat(join(dir, f.name)).catch(() => null);
    if (s?.isFile()) [count, bytes] = [count + 1, bytes + s.size];
  }
  return { count, bytes };
}

export interface TenantPurgeDeps {
  db: Db;
  store: UploadStore;
  ledger: { append(e: ErasureEntry): Promise<void> };
  metrics: Metrics;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void; error(o: object, m: string): void };
  /** FENCE sonrası canlı bağlantılar (panel soketleri, odalar); hata loglanır. */
  live?: { closeTenant(tenantId: string): Promise<void> };
  /** Yalnız testler: her commit'li partiden/adımdan sonra (fırlatırsa çökme benzetimi — hata yakalanmaz). */
  afterBatch?: (step: TenantPurgeStep) => Promise<void>;
}

type RunOutcome = "done" | "failed" | "retry" | "idle";

export function registerPurgeMetrics(m: Metrics, runner: () => TenantPurgeRunner | undefined): void {
  m.counter("rs_tenant_purge_rows_total", "Firma silme işinin sildiği/güncellediği satırlar (P16; table)");
  m.counter("rs_erasure_ledger_write_failed_total", "İmha defterine yazılamayan satırlar (P16; alarm)");
  m.gauge("rs_tenant_purge_jobs", "Firma silme işleri (P16; durum başına; 60 sn'de tazelenir)", () => {
    const s = runner()?.snapshot.states ?? {};
    return Object.fromEntries(TENANT_PURGE_STATES.map((k) => [k, s[k] ?? 0]));
  });
  m.gauge(
    "rs_tenant_purge_last_heartbeat_seconds",
    "RUNNING işin son heartbeat'i (epoch sn; yoksa 0)",
    () => runner()?.snapshot.heartbeat ?? 0,
  );
}

export class TenantPurgeRunner {
  private running = false;
  snapshot: { states: Record<string, number>; heartbeat: number } = { states: {}, heartbeat: 0 };

  private readonly d: TenantPurgeDeps;

  constructor(d: TenantPurgeDeps) {
    this.d = d;
  }

  /** Göstergeleri tazeler (tur sonunda ve API zamanlama/iptalinden sonra). */
  async refreshMetrics(): Promise<void> {
    this.snapshot = await repo.gaugeSnapshot(this.d.db);
  }

  /** Bir tur: sıradaki tek işi çalıştırır. Eşzamanlı çağrı → "idle". */
  async tick(): Promise<RunOutcome> {
    if (this.running) return "idle";
    this.running = true;
    try {
      const id = await repo.nextJobId(this.d.db);
      return id ? await this.runJob(id) : "idle";
    } finally {
      this.running = false;
      await this.refreshMetrics().catch((err: unknown) => this.d.log.error({ err, job: "tenant-purge" }, "gösterge okunamadı"));
    }
  }

  /** Tek iş: (SCHEDULED ise başlat) → uygunluk → adımlar DONE'a kadar ya da hata. */
  async runJob(jobId: string): Promise<RunOutcome> {
    let job = await repo.findJob(this.d.db, jobId);
    if (!job) return "idle";
    if (job.state === "SCHEDULED") {
      if (!(await this.start(job.id, job.tenantId))) return "idle";
      job = await repo.findJob(this.d.db, jobId);
    }
    if (!job || job.state !== "RUNNING") return "idle";
    if (!(await this.eligible(job))) return "failed";
    // S16-13: defterin `started` satırı yalnız uygunluk doğrulandıktan sonra (geçersiz iş deftere girmez).
    // S16-18: FENCE'teki her turda yazılır (start commit'i ile defter arasında çökme → sonraki tur yazar; tekrar zararsız).
    if (job.step === "FENCE")
      await this.appendLedger({ type: "tenant", id: job.tenantId, jobId: job.id, phase: "started", at: new Date().toISOString() });
    let step = job.step;
    while (step !== "DONE") {
      let next: TenantPurgeStep;
      try {
        next = await this.processStep(job.id, job.tenantId, step);
      } catch (err) {
        return this.onError(job.id, job.tenantId, step, err);
      }
      if (this.d.afterBatch) await this.d.afterBatch(step);
      step = next;
    }
    return "done";
  }

  private start(id: string, tenantId: string): Promise<boolean> {
    return this.d.db.$transaction(async (tx) => {
      if ((await repo.startJob(tx, id)) !== 1) return false;
      await writeAudit(tx, ctx(), {
        tenantId,
        ...SYSTEM_ACTOR,
        action: TENANT_PURGE_AUDIT.STARTED,
        entity: ENTITY,
        entityId: tenantId,
        result: "success",
        newValue: { jobId: id },
      });
      return true;
    });
  }

  /** S16-2: tur başı uygunluk; reddedilirse FAILED `invalid_job` + audit + alarm (dosya ve satıra dokunulmaz). */
  private async eligible(job: repo.JobRow): Promise<boolean> {
    const t = await repo.tenantEligibility(this.d.db, job.tenantId);
    const ok =
      TENANT_PREFIX_RE.test(job.tenantId) &&
      (stepIndex(job.step) <= TENANT_ROW_INDEX ? t.exists && t.passive && t.aged : !t.exists && job.tenantRowDeletedAt !== null);
    if (ok) return true;
    await this.d.db.$transaction(async (tx) => {
      if ((await repo.failInvalid(tx, job.id)) !== 1) return;
      await this.failAudit(tx, job.id, job.tenantId, job.step, "invalid_job");
    });
    this.d.log.error(
      { alarm: "tenant_purge_failed", jobId: job.id, step: job.step, class: "invalid_job" },
      "firma silme işi geçersiz (uygunluk reddi)",
    );
    return false;
  }

  /** Bir parti ya da özel adım; dönen değer bir sonraki adım (aynı adım = devam). */
  private async processStep(id: string, tenantId: string, step: TenantPurgeStep): Promise<TenantPurgeStep> {
    if (step === "FENCE") return this.fenceStep(id, tenantId);
    if (step === "TENANT_ROW") return this.tenantRowStep(id, tenantId);
    if (step === "FILES") return this.filesStep(id, tenantId);
    const parts = repo.DATA_STEPS[step];
    if (!parts) throw new Error(`bilinmeyen adım ${step}`);
    return this.d.db.$transaction(async (tx) => {
      const job = await repo.lockJob(tx, id);
      if (job?.state !== "RUNNING" || job.step !== step) throw new Error("iş durumu değişti");
      let total = 0;
      for (const p of parts) {
        const n = await p.batch(tx, tenantId);
        total += n;
        if (n > 0) this.d.metrics.inc("rs_tenant_purge_rows_total", { table: p.table }, n);
      }
      if (total > 0) {
        await repo.addCount(tx, id, step, total);
        return step;
      }
      if ((await repo.advance(tx, id, step, nextStep(step))) !== 1) throw new Error("adım ilerletilemedi");
      return nextStep(step);
    });
  }

  private async fenceStep(id: string, tenantId: string): Promise<TenantPurgeStep> {
    await this.d.db.$transaction(async (tx) => {
      const job = await repo.lockJob(tx, id);
      if (job?.state !== "RUNNING" || job.step !== "FENCE") throw new Error("iş durumu değişti");
      await repo.fence(tx, tenantId);
      if ((await repo.advance(tx, id, "FENCE", "SESSION_FILES")) !== 1) throw new Error("adım ilerletilemedi");
    });
    try {
      await this.d.live?.closeTenant(tenantId);
    } catch (err) {
      this.d.log.error({ err, alarm: "tenant_purge_fence_live", jobId: id }, "canlı bağlantılar kapatılamadı (oturumlar zaten iptal)");
    }
    return "SESSION_FILES";
  }

  /** TENANT_ROW: tek TX'te firma satırı DELETE → `tenant_row_deleted_at` + `step = FILES`. */
  private async tenantRowStep(id: string, tenantId: string): Promise<TenantPurgeStep> {
    await this.d.db.$transaction(async (tx) => {
      const job = await repo.lockJob(tx, id);
      if (job?.state !== "RUNNING" || job.step !== "TENANT_ROW") throw new Error("iş durumu değişti");
      await repo.detachActing(tx, tenantId);
      if ((await repo.deleteTenantRow(tx, tenantId)) !== 1) throw new Error("firma satırı silinemedi");
      if ((await repo.markTenantRowDeleted(tx, id)) !== 1) throw new Error("adım ilerletilemedi");
      this.d.metrics.inc("rs_tenant_purge_rows_total", { table: "tenants" }, 1);
    });
    return "FILES";
  }

  /** FILES: `uploads/{id}` (TENANT_PREFIX_RE + absDir); `rm` sembolik bağlantıyı izlemez. Sonra DONE + audit + defter. */
  private async filesStep(id: string, tenantId: string): Promise<TenantPurgeStep> {
    if (!TENANT_PREFIX_RE.test(tenantId)) throw new FsStepError("geçersiz firma kimliği");
    try {
      await rm(this.d.store.absDir(tenantId), { recursive: true, force: true });
    } catch (err) {
      throw new FsStepError((err as NodeJS.ErrnoException).code ?? "fs");
    }
    const counts = await this.d.db.$transaction(async (tx) => {
      const job = await repo.lockJob(tx, id);
      if (job?.state !== "RUNNING" || job.step !== "FILES") throw new Error("iş durumu değişti");
      if ((await repo.finishJob(tx, id)) !== 1) throw new Error("iş bitirilemedi");
      await writeAudit(tx, ctx(), {
        tenantId,
        ...SYSTEM_ACTOR,
        action: TENANT_PURGE_AUDIT.PURGED,
        entity: ENTITY,
        entityId: tenantId,
        result: "success",
        newValue: { jobId: id, counts: job.counts },
      });
      return job.counts;
    });
    this.d.log.info({ job: "tenant-purge", jobId: id, counts }, "firma kalıcı silindi");
    await this.appendLedger({ type: "tenant", id: tenantId, jobId: id, phase: "done", at: new Date().toISOString() });
    return "DONE";
  }

  private async onError(id: string, tenantId: string, step: TenantPurgeStep, err: unknown): Promise<RunOutcome> {
    const cls = classifyPurgeError(err);
    const job = await repo.findJob(this.d.db, id);
    const fail = (job?.attempts ?? 0) + 1 >= PURGE_MAX_ERRORS;
    await this.d.db.$transaction(async (tx) => {
      if ((await repo.recordError(tx, id, cls, fail)) !== 1 || !fail) return;
      await this.failAudit(tx, id, tenantId, step, cls);
    });
    const meta = { err, jobId: id, step, class: cls, attempt: (job?.attempts ?? 0) + 1 };
    if (fail) this.d.log.error({ ...meta, alarm: "tenant_purge_failed" }, "firma silme işi başarısız (FAILED)");
    else this.d.log.warn(meta, "firma silme adımı hata verdi; yeniden denenecek");
    return fail ? "failed" : "retry";
  }

  private failAudit(tx: Prisma.TransactionClient, id: string, tenantId: string, step: TenantPurgeStep, cls: string) {
    return writeAudit(tx, ctx(), {
      tenantId,
      ...SYSTEM_ACTOR,
      action: TENANT_PURGE_AUDIT.FAILED,
      entity: ENTITY,
      entityId: tenantId,
      result: "fail",
      newValue: { jobId: id, step, errorClass: cls },
    });
  }

  private async appendLedger(e: ErasureEntry): Promise<void> {
    try {
      await this.d.ledger.append(e);
    } catch (err) {
      this.d.log.error(
        { err, alarm: "erasure_ledger_write_failed", jobId: e.type === "tenant" ? e.jobId : undefined },
        "imha defterine yazılamadı",
      );
    }
  }
}
