// Periyodik işler (mimari §6: P2 expiry, P13 retention). Tek instance (ADR-0005); zamanlayıcı unref'li,
// turlar üst üste binmez, uygulama kapanınca durur. Hata loglanır, bir sonraki turda yeniden denenir.
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import { expireDue, type RoomNotifier } from "../sessions/service.ts";
import { nextRetentionAt, sweepRequests } from "../requests/jobs.ts";
import type { RequestService } from "../requests/service.ts";
import type { RetentionJob } from "./retention.ts";
import { nextOrphanScanAt, type OrphanScanJob } from "./orphan-scan.ts";
import { PURGE_INTERVAL_MS, type TenantPurgeRunner } from "./tenant-purge.ts";

const EXPIRY_INTERVAL_MS = 30_000;

export interface Scheduler {
  /** Expiry turunu hemen çalıştırır (testler ve ilk açılış). */
  runExpiry(): Promise<number>;
  stop(): void;
}

/**
 * P8b: `requests` verilirse aynı 30 sn turunda talep süpürücüsü (süre dolumu, 60 sn bağlanma, pasif tenant) çalışır.
 * P13a: `retention` verilirse günlük 03:30 Europe/Istanbul saklama işi (jobs/retention.ts; AC-159, 195, 197..199).
 * P16 (AC-243): `orphanScan` verilirse haftalık pazar 04:30 Europe/Istanbul yetim dosya taraması (jobs/orphan-scan.ts).
 * P16 G3 (AC-242): `tenantPurge` verilirse 60 sn'de bir firma silme turu (tur başına tek iş; açılışta göstergeler hemen).
 * Bir sonraki tur önceki bittikten sonra kurulur (üst üste binmez).
 */
export function startScheduler(
  db: Db,
  log: FastifyBaseLogger,
  rooms?: RoomNotifier,
  intervalMs = EXPIRY_INTERVAL_MS,
  requests?: RequestService,
  retention?: RetentionJob,
  orphanScan?: OrphanScanJob,
  tenantPurge?: TenantPurgeRunner,
): Scheduler {
  let running = false;
  let sweeping = false;
  const runRequestSweep = async (): Promise<void> => {
    if (!requests || sweeping) return;
    sweeping = true;
    try {
      const r = await sweepRequests(requests);
      if (r.expired + r.connectFailed + r.tenantPassive + r.customerPassive + r.bindingsRevoked > 0)
        log.info({ job: "request-sweep", ...r }, "talep durumları güncellendi");
    } catch (err) {
      log.error({ err, job: "request-sweep" }, "zamanlanmış iş hatası");
    } finally {
      sweeping = false;
    }
  };
  let retentionTimer: NodeJS.Timeout | undefined;
  const armRetention = (): void => {
    if (!retention) return;
    retentionTimer = setTimeout(
      () => {
        void retention
          .run()
          .then((r) => {
            if (r) log.info({ job: "retention", tenants: r.tenants, failures: r.failures, ...r.totals }, "saklama işi tamamlandı");
          })
          .catch((err: unknown) => log.error({ err, job: "retention" }, "zamanlanmış iş hatası"))
          .finally(armRetention);
      },
      nextRetentionAt(Date.now()) - Date.now(),
    );
    retentionTimer.unref();
  };
  armRetention();
  let orphanTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  const armOrphanScan = (): void => {
    if (!orphanScan || stopped) return;
    orphanTimer = setTimeout(
      () => {
        void orphanScan
          .run()
          .then((r) => {
            if (r) log.info({ job: "orphan-scan", ...r }, "yetim dosya taraması tamamlandı");
          })
          .catch((err: unknown) => log.error({ err, job: "orphan-scan" }, "zamanlanmış iş hatası"))
          .finally(armOrphanScan);
      },
      nextOrphanScanAt(Date.now()) - Date.now(),
    );
    orphanTimer.unref();
  };
  if (orphanScan)
    void orphanScan
      .init()
      .catch((err: unknown) => log.error({ err, job: "orphan-scan" }, "yetim taraması durum dosyası okunamadı"))
      .finally(armOrphanScan);
  let purgeTimer: NodeJS.Timeout | undefined;
  const armPurge = (delay: number): void => {
    if (!tenantPurge || stopped) return;
    purgeTimer = setTimeout(() => {
      void tenantPurge
        .tick()
        .then((r) => {
          if (r !== "idle") log.info({ job: "tenant-purge", outcome: r }, "firma silme turu");
        })
        .catch((err: unknown) => log.error({ err, job: "tenant-purge" }, "zamanlanmış iş hatası"))
        .finally(() => armPurge(PURGE_INTERVAL_MS));
    }, delay);
    purgeTimer.unref();
  };
  if (tenantPurge) void tenantPurge.refreshMetrics().catch((err: unknown) => log.error({ err, job: "tenant-purge" }, "gösterge okunamadı"));
  armPurge(PURGE_INTERVAL_MS);
  const runExpiry = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const ctx = { ip: "", userAgent: "scheduler", requestId: newId() };
      const n = await expireDue(db, ctx, new Date(), rooms);
      if (n > 0) log.info({ job: "session-expiry", expired: n }, "oturum süresi doldu");
      return n;
    } catch (err) {
      log.error({ err, job: "session-expiry" }, "zamanlanmış iş hatası");
      return 0;
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void runExpiry();
    void runRequestSweep();
  }, intervalMs);
  timer.unref();
  return {
    runExpiry,
    stop: () => {
      clearInterval(timer);
      if (retentionTimer) clearTimeout(retentionTimer);
      stopped = true;
      if (orphanTimer) clearTimeout(orphanTimer);
      if (purgeTimer) clearTimeout(purgeTimer);
    },
  };
}
