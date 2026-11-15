// Günlük saklama işi (03:30 Europe/Istanbul; mimari-p13 §2, AC-159, AC-195, AC-197..199). Mevcut talep/müşteri/kayıt
// adımlarını tenant döngüsünde toplar ve oturum anonimleştirmesini ekler; ardından firmadan bağımsız silmeler (audit
// 730 g, giriş oturumu ve sıfırlama bağlantısı +7 g). Kurallar: tenant'ta hata → loglanır, sıradaki tenant'a geçilir
// (fail-soft); turlar üst üste binmez; iş idempotenttir (ikinci tur 0 satır); kaçırılan gün telafi edilmez.
// P16 G2 (AC-240, ADR-0030 m.2, mimari-e11 §7.2): anonimleştirmeden sonra `purgeAnonymized` — 30 g (+1 sa pay, DB saati)
// önce anonimleşmiş oturum/onay/talep/kayıt satırlarının kalıcı silinmesi; `RETENTION_PURGE_MODE=dry` (varsayılan) yalnız
// sayar. Açık firma silme işi olan firma atlanır. Global adımlara DONE/CANCELLED iş satırlarının 730 g saklaması eklendi.
// Genişleme noktası (G3 firma silme): global adımlar `globalSteps` listesindedir; firma atlama kuralı `skipTenant`.
import { RETENTION_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { JsonObject } from "../audit/mask.ts";
import { isP16Signal } from "../lib/db.ts";
import { expireIdleBindingsOf } from "../bindings/service.ts";
import { anonymizeCustomersOf } from "../customers/service.ts";
import { newId } from "../lib/ids.ts";
import { anonymizeRequestsOf } from "../requests/jobs.ts";
import * as rrepo from "../requests/repo.ts";
import { SYSTEM, type RequestService } from "../requests/service.ts";
import { purgeExpiredBlocks } from "../requests/blocks.ts";
import { deleteExpired as deleteExpiredTrustedDevices } from "../auth/trusted-device-repo.ts";
import { REQUEST_BLOCK_EXPIRED_RETENTION_DAYS } from "@remote/contracts/api/request-blocks";
import * as repo from "./retention-repo.ts";
import { isPurgeKey, KINDS, sum, zeroGlobal, zeroTenant, candidateName, type GlobalCounts, type TenantCounts } from "./retention-counts.ts";

const DAY_MS = 86_400_000;
/** AC-199: oturum partisi. */
export const SESSION_BATCH = 1000;
/** mimari-p13 §2: global silme partisi. */
const GLOBAL_BATCH = 5000;
/** Sabit (tenant değiştiremez); DB tetikleyicisi de aynı sınırı uygular. */
const AUDIT_RETENTION_DAYS = 730;
/** Giriş oturumu / sıfırlama bağlantısı: süresi (ya da iptali) + 7 gün. */
const AUTH_GRACE_DAYS = 7;

/** `RETENTION_PURGE_MODE` (mimari-e11 §7.7): `on` siler, `dry` aynı aday koşullarını sayar. */
type PurgeMode = "dry" | "on";
/** `rs_retention_failures_total{class}` (ADR-0030 m.2): tetikleyici reddi `db_signal`, audit yazımı `audit`, diğer `other`. */
type RetentionFailureClass = "db_signal" | "audit" | "other";
interface RetentionResult {
  tenants: number;
  failures: number;
  totals: TenantCounts & GlobalCounts;
}

const ENTITY = "retention";

/** Sınıflandırma (log/metrik; mesaj metni dışarı çıkmaz). */
const failureClass = (err: unknown): RetentionFailureClass => (isP16Signal(err) ? "db_signal" : "other");

/** Tek süreç (ADR-0005) içinde tek örnek; `run` eşzamanlı çağrılırsa ikincisi çalışmadan `null` döner. */
export class RetentionJob {
  private running = false;
  /** `rs_retention_last_success_timestamp_seconds` (0 = süreç başından beri başarılı tur yok). */
  lastSuccessSeconds = 0;

  private readonly svc: RequestService;
  readonly purgeMode: PurgeMode;

  /** `opts.purgeMode` yalnız testler için; varsayılan env `RETENTION_PURGE_MODE` (varsayılanı `dry`). */
  constructor(svc: RequestService, opts: { purgeMode?: PurgeMode } = {}) {
    this.svc = svc;
    this.purgeMode = opts.purgeMode ?? svc.d.env.RETENTION_PURGE_MODE;
    const m = svc.d.metrics;
    m.gauge(
      "rs_retention_last_success_timestamp_seconds",
      "Saklama işinin son hatasız turunun bitişi (unix sn; P13a AC-199)",
      () => this.lastSuccessSeconds,
    );
  }

  get isRunning(): boolean {
    return this.running;
  }

  async run(now = new Date(this.svc.d.clock.now())): Promise<RetentionResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } finally {
      this.running = false;
    }
  }

  /** Audit gövdesi: dry modda silme sayaçları `purgeCandidates` altında (yalnız sayılar; kişisel veri yok). */
  private auditView(c: object): JsonObject {
    const out: JsonObject = {};
    const candidates: JsonObject = {};
    for (const [k, v] of Object.entries(c) as [string, number][]) {
      if (this.purgeMode === "dry" && isPurgeKey(k)) candidates[candidateName(k)] = v;
      else out[k] = v;
    }
    if (this.purgeMode === "dry") out.purgeCandidates = candidates;
    return out;
  }

  private fail(cls: RetentionFailureClass, err: unknown, msg: string, tenantId?: string): void {
    this.failures[cls]++;
    // db_signal: tetikleyici reddi (S16-8) — operatör alarmı; mesaj metni yazılmaz (yalnız sınıf + hata nesnesi).
    this.svc.d.log.error(
      { err, job: "retention", class: cls, ...(cls === "db_signal" ? { alarm: "retention_db_signal" } : {}), tenantId },
      msg,
    );
  }

  private failures: Record<RetentionFailureClass, number> = { db_signal: 0, audit: 0, other: 0 };

  private async runOnce(now: Date): Promise<RetentionResult> {
    const runId = newId();
    const ctx = { ip: "", userAgent: "retention", requestId: runId };
    const totals = { ...zeroTenant(), ...zeroGlobal() };
    this.failures = { db_signal: 0, audit: 0, other: 0 };
    const tenants = await rrepo.retentionTenants(this.svc.d.db);
    for (const t of tenants) await this.runTenant(t, now, ctx, totals);
    await this.runGlobal(now, ctx, totals);
    const failures = this.recordMetrics(totals);
    this.svc.refreshCustomersGauge();
    return { tenants: tenants.length, failures, totals };
  }

  /** Tek firma: atlama kuralı → adımlar (fail-soft) → sayaçlar toplama → (iş yaptıysa ya da hata varsa) audit. */
  private async runTenant(
    t: { tenantId: string; retentionDays: number },
    now: Date,
    ctx: AuditContext,
    totals: TenantCounts,
  ): Promise<void> {
    const c = zeroTenant();
    let failed = false;
    try {
      if (await this.skipTenant(t.tenantId)) return;
      await this.tenantSteps(t, now, c);
    } catch (err) {
      failed = true;
      this.fail(failureClass(err), err, "saklama işi: firma adımı başarısız, sonraki firmaya geçildi", t.tenantId);
    }
    for (const k of Object.keys(c) as (keyof TenantCounts)[]) totals[k] += c[k];
    if (sum(c) > 0 || failed) {
      await writeAudit(this.svc.d.db, ctx, {
        tenantId: t.tenantId,
        ...SYSTEM,
        action: RETENTION_AUDIT.RUN,
        entity: ENTITY,
        result: failed ? "fail" : "success",
        newValue: this.auditView(c),
      }).catch((err: unknown) => {
        if (!failed) this.fail("audit", err, "saklama işi: audit yazılamadı", t.tenantId);
      });
    }
  }

  /** Firmadan bağımsız silmeler + (iş yaptıysa ya da hata varsa) audit. */
  private async runGlobal(now: Date, ctx: AuditContext, totals: TenantCounts & GlobalCounts): Promise<void> {
    const g = zeroGlobal();
    let globalFailed = false;
    try {
      await this.globalSteps(now, g);
    } catch (err) {
      globalFailed = true;
      this.fail(failureClass(err), err, "saklama işi: global silme adımı başarısız");
    }
    Object.assign(totals, g);
    if (sum(g) > 0 || globalFailed) {
      await writeAudit(this.svc.d.db, ctx, {
        tenantId: null,
        ...SYSTEM,
        action: RETENTION_AUDIT.RUN,
        entity: ENTITY,
        result: globalFailed ? "fail" : "success",
        newValue: this.auditView(g),
      }).catch((err: unknown) => {
        if (!globalFailed) this.fail("audit", err, "saklama işi: audit yazılamadı");
      });
    }
  }

  /** Satır ve hata sayaçları; hatasız turda son başarı göstergesi. Dönen: hata sayısı. */
  private recordMetrics(totals: TenantCounts & GlobalCounts): number {
    const { metrics } = this.svc.d;
    // Dry modda silme sayaçları ayrı etiketle (`purge_candidate_*`) — gerçek silmeyle karışmaz.
    for (const [k, kind] of Object.entries(KINDS) as [keyof typeof totals, string][]) {
      const label = this.purgeMode === "dry" && isPurgeKey(k) ? kind.replace("purged_", "purge_candidate_") : kind;
      if (totals[k] > 0) metrics.inc("rs_retention_rows_total", { kind: label }, totals[k]);
    }
    const failures = sum(this.failures);
    for (const [cls, n] of Object.entries(this.failures)) if (n > 0) metrics.inc("rs_retention_failures_total", { class: cls }, n);
    if (failures === 0) this.lastSuccessSeconds = Math.floor(this.svc.d.clock.now() / 1000);
    return failures;
  }

  /** Çakışma (mimari-e11 §7.2, ADR-0030 m.5): açık firma silme işi olan firma bu gece atlanır. */
  private async skipTenant(tenantId: string): Promise<boolean> {
    return repo.hasOpenPurgeJob(this.svc.d.db, tenantId);
  }

  /** Bir tenant'ın adımları; sayaçlar `c` üzerinde biriktirilir (hata anında o ana kadarkiler audit'e girer). */
  private async tenantSteps(t: { tenantId: string; retentionDays: number }, now: Date, c: TenantCounts): Promise<void> {
    const { svc } = this;
    const msgs = { messages: 0 };
    try {
      c.requests += await anonymizeRequestsOf(svc, t, now, msgs);
    } finally {
      c.purgedMessages += msgs.messages;
    }
    c.customers += await anonymizeCustomersOf(svc, t, now);
    c.bindings += await expireIdleBindingsOf(svc, t, now);
    c.blocks += await purgeExpiredBlocks(svc.d.db, t.tenantId, new Date(now.getTime() - REQUEST_BLOCK_EXPIRED_RETENTION_DAYS * DAY_MS));
    const cutoff = new Date(now.getTime() - t.retentionDays * DAY_MS);
    for (;;) {
      const r = await repo.anonymizeSessionBatch(svc.d.db, t.tenantId, cutoff, SESSION_BATCH);
      c.sessions += r.sessions;
      c.consents += r.consents;
      c.files += r.files;
      if (r.selected < SESSION_BATCH) break;
    }
    await this.purgeAnonymized(t.tenantId, c);
  }

  /**
   * AC-240 (ADR-0030 m.2): kayıt (B*) → oturum (S*; dosya, onay, oturum, bağlı talep) → oturumsuz talep (R*). Kesme DB
   * saatiyle (`retention-repo` `PURGE_CUT`); `now` kullanılmaz (S16-8). Tetikleyici reddi (SIGNAL 1644 `p16:`) partiyi
   * geri alır ve yukarıya `db_signal` olarak çıkar; sıradaki firmaya geçilir.
   */
  private async purgeAnonymized(tenantId: string, c: TenantCounts): Promise<void> {
    const { db } = this.svc.d;
    if (this.purgeMode === "dry") {
      const n = await repo.countPurgeCandidates(db, tenantId);
      c.purgedBindings += n.bindings;
      c.purgedSessions += n.sessions;
      c.purgedConsents += n.consents;
      c.purgedFiles += n.files;
      c.purgedRequests += n.requests;
      return;
    }
    for (;;) {
      const r = await repo.purgeBindingsBatch(db, tenantId, repo.PURGE_BATCH);
      c.purgedBindings += r.bindings;
      if (r.selected < repo.PURGE_BATCH) break;
    }
    for (;;) {
      const r = await repo.purgeSessionsBatch(db, tenantId, repo.PURGE_BATCH);
      c.purgedSessions += r.sessions;
      c.purgedConsents += r.consents;
      c.purgedFiles += r.files;
      c.purgedRequests += r.requests;
      if (r.selected < repo.PURGE_BATCH) break;
    }
    for (;;) {
      const n = await repo.purgeOrphanRequestsBatch(db, tenantId, repo.PURGE_BATCH);
      c.purgedRequests += n;
      if (n < repo.PURGE_BATCH) break;
    }
  }

  private async globalSteps(now: Date, g: GlobalCounts): Promise<void> {
    const { db } = this.svc.d;
    const auditCutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS);
    const graceCutoff = new Date(now.getTime() - AUTH_GRACE_DAYS * DAY_MS);
    g.audit = await drain((n) => repo.deleteOldAudit(db, auditCutoff, n));
    g.authSessions = await drain((n) => repo.deleteOldAuthSessions(db, graceCutoff, n));
    g.resetTokens = await drain((n) => repo.deleteOldResetTokens(db, graceCutoff, n));
    // P27a (AC-334, mimari-p27a §3.3): süresi dolan hatırlanan cihazlar (kayan süre yok; `expires_at < now`).
    g.trustedDevices = await drain((n) => deleteExpiredTrustedDevices(db, now, n));
    // S16-10: DONE/CANCELLED firma silme iş satırları 730 g sonra (DB saati; tetikleyici aynı sınırı uygular).
    g.purgedJobs = this.purgeMode === "dry" ? await repo.countOldPurgeJobs(db) : await drain((n) => repo.deleteOldPurgeJobs(db, n));
  }
}

/** Parti parti siler; parti dolu değilse durur. */
async function drain(step: (limit: number) => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await step(GLOBAL_BATCH);
    total += n;
    if (n < GLOBAL_BATCH) return total;
  }
}
