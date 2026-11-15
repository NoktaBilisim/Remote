// Günlük saklama işi (03:30 Europe/Istanbul; mimari-p13 §2, AC-159, AC-195, AC-197..199). Mevcut talep/müşteri/kayıt
// adımlarını tenant döngüsünde toplar ve oturum anonimleştirmesini ekler; ardından firmadan bağımsız silmeler (audit
// 730 g, giriş oturumu ve sıfırlama bağlantısı +7 g). Kurallar: tenant'ta hata → loglanır, sıradaki tenant'a geçilir
// (fail-soft); turlar üst üste binmez; iş idempotenttir (ikinci tur 0 satır); kaçırılan gün telafi edilmez.
// Genişleme noktası (K-P13-1, P13a'da YAZILMADI): `purgeAnonymized()` — anonim kayıtların hard delete'i; o pakette
// grants.sql'e DELETE eklenir.
import { RETENTION_AUDIT } from "@remote/contracts/audit";
import { writeAudit } from "../audit/service.ts";
import { expireIdleBindingsOf } from "../bindings/service.ts";
import { anonymizeCustomersOf } from "../customers/service.ts";
import { newId } from "../lib/ids.ts";
import { anonymizeRequestsOf } from "../requests/jobs.ts";
import * as rrepo from "../requests/repo.ts";
import { SYSTEM, type RequestService } from "../requests/service.ts";
import { purgeExpiredBlocks } from "../requests/blocks.ts";
import { REQUEST_BLOCK_EXPIRED_RETENTION_DAYS } from "@remote/contracts/api/request-blocks";
import * as repo from "./retention-repo.ts";

const DAY_MS = 86_400_000;
/** AC-199: oturum partisi. */
export const SESSION_BATCH = 1000;
/** mimari-p13 §2: global silme partisi. */
export const GLOBAL_BATCH = 5000;
/** Sabit (tenant değiştiremez); DB tetikleyicisi de aynı sınırı uygular. */
export const AUDIT_RETENTION_DAYS = 730;
/** Giriş oturumu / sıfırlama bağlantısı: süresi (ya da iptali) + 7 gün. */
export const AUTH_GRACE_DAYS = 7;

export interface TenantCounts {
  sessions: number;
  consents: number;
  files: number;
  requests: number;
  customers: number;
  bindings: number;
  /** P15 (AC-235): süresi 30 günden önce dolmuş talep engelleri (IP kişisel veri). */
  blocks: number;
}
export interface GlobalCounts {
  audit: number;
  authSessions: number;
  resetTokens: number;
}
export interface RetentionResult {
  tenants: number;
  failures: number;
  totals: TenantCounts & GlobalCounts;
}

const ENTITY = "retention";
/** `rs_retention_rows_total{kind}` etiketleri (düşük kardinalite, sabit küme). */
const KINDS: Record<keyof (TenantCounts & GlobalCounts), string> = {
  sessions: "sessions",
  consents: "consents",
  files: "files",
  requests: "requests",
  customers: "customers",
  bindings: "bindings",
  blocks: "request_blocks",
  audit: "audit",
  authSessions: "auth_sessions",
  resetTokens: "reset_tokens",
};

const zeroTenant = (): TenantCounts => ({ sessions: 0, consents: 0, files: 0, requests: 0, customers: 0, bindings: 0, blocks: 0 });
const sum = (o: object): number => Object.values(o).reduce((a: number, b: unknown) => a + (typeof b === "number" ? b : 0), 0);

/** Tek süreç (ADR-0005) içinde tek örnek; `run` eşzamanlı çağrılırsa ikincisi çalışmadan `null` döner. */
export class RetentionJob {
  private running = false;
  /** `rs_retention_last_success_timestamp_seconds` (0 = süreç başından beri başarılı tur yok). */
  lastSuccessSeconds = 0;

  private readonly svc: RequestService;

  constructor(svc: RequestService) {
    this.svc = svc;
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

  private async runOnce(now: Date): Promise<RetentionResult> {
    const { db, metrics } = this.svc.d;
    const runId = newId();
    const ctx = { ip: "", userAgent: "retention", requestId: runId };
    const totals = { ...zeroTenant(), audit: 0, authSessions: 0, resetTokens: 0 };
    let failures = 0;
    const tenants = await rrepo.retentionTenants(db);
    for (const t of tenants) {
      const c = zeroTenant();
      let failed = false;
      try {
        await this.tenantSteps(t, now, c);
      } catch (err) {
        failed = true;
        failures++;
        this.svc.d.log.error(
          { err, job: "retention", tenantId: t.tenantId },
          "saklama işi: firma adımı başarısız, sonraki firmaya geçildi",
        );
      }
      for (const k of Object.keys(c) as (keyof TenantCounts)[]) totals[k] += c[k];
      if (sum(c) > 0 || failed) {
        await writeAudit(db, ctx, {
          tenantId: t.tenantId,
          ...SYSTEM,
          action: RETENTION_AUDIT.RUN,
          entity: ENTITY,
          result: failed ? "fail" : "success",
          newValue: { ...c },
        }).catch((err: unknown) => {
          failures += failed ? 0 : 1;
          this.svc.d.log.error({ err, job: "retention", tenantId: t.tenantId }, "saklama işi: audit yazılamadı");
        });
      }
    }
    const g: GlobalCounts = { audit: 0, authSessions: 0, resetTokens: 0 };
    let globalFailed = false;
    try {
      await this.globalSteps(now, g);
    } catch (err) {
      globalFailed = true;
      failures++;
      this.svc.d.log.error({ err, job: "retention" }, "saklama işi: global silme adımı başarısız");
    }
    Object.assign(totals, g);
    if (sum(g) > 0 || globalFailed) {
      await writeAudit(db, ctx, {
        tenantId: null,
        ...SYSTEM,
        action: RETENTION_AUDIT.RUN,
        entity: ENTITY,
        result: globalFailed ? "fail" : "success",
        newValue: { ...g },
      }).catch((err: unknown) => {
        failures += globalFailed ? 0 : 1;
        this.svc.d.log.error({ err, job: "retention" }, "saklama işi: audit yazılamadı");
      });
    }
    for (const [k, kind] of Object.entries(KINDS) as [keyof typeof totals, string][])
      if (totals[k] > 0) metrics.inc("rs_retention_rows_total", { kind }, totals[k]);
    if (failures > 0) metrics.inc("rs_retention_failures_total", {}, failures);
    else this.lastSuccessSeconds = Math.floor(this.svc.d.clock.now() / 1000);
    this.svc.refreshCustomersGauge();
    return { tenants: tenants.length, failures, totals };
  }

  /** Bir tenant'ın adımları; sayaçlar `c` üzerinde biriktirilir (hata anında o ana kadarkiler audit'e girer). */
  private async tenantSteps(t: { tenantId: string; retentionDays: number }, now: Date, c: TenantCounts): Promise<void> {
    const { svc } = this;
    c.requests += await anonymizeRequestsOf(svc, t, now);
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
  }

  private async globalSteps(now: Date, g: GlobalCounts): Promise<void> {
    const { db } = this.svc.d;
    const auditCutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS);
    const graceCutoff = new Date(now.getTime() - AUTH_GRACE_DAYS * DAY_MS);
    g.audit = await drain((n) => repo.deleteOldAudit(db, auditCutoff, n));
    g.authSessions = await drain((n) => repo.deleteOldAuthSessions(db, graceCutoff, n));
    g.resetTokens = await drain((n) => repo.deleteOldResetTokens(db, graceCutoff, n));
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
