// Periyodik işler (mimari §6: P2 expiry, P13 retention). Tek instance (ADR-0005); zamanlayıcı unref'li,
// turlar üst üste binmez, uygulama kapanınca durur. Hata loglanır, bir sonraki turda yeniden denenir.
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import { expireDue, type RoomNotifier } from "../sessions/service.ts";
import { nextRetentionAt, sweepRequests } from "../requests/jobs.ts";
import type { RequestService } from "../requests/service.ts";
import type { RetentionJob } from "./retention.ts";

const EXPIRY_INTERVAL_MS = 30_000;

export interface Scheduler {
  /** Expiry turunu hemen çalıştırır (testler ve ilk açılış). */
  runExpiry(): Promise<number>;
  stop(): void;
}

/**
 * P8b: `requests` verilirse aynı 30 sn turunda talep süpürücüsü (süre dolumu, 60 sn bağlanma, pasif tenant) çalışır.
 * P13a: `retention` verilirse günlük 03:30 Europe/Istanbul saklama işi (jobs/retention.ts; AC-159, 195, 197..199).
 * Bir sonraki tur önceki bittikten sonra kurulur (üst üste binmez).
 */
export function startScheduler(db: Db, log: FastifyBaseLogger, rooms?: RoomNotifier, intervalMs = EXPIRY_INTERVAL_MS, requests?: RequestService, retention?: RetentionJob): Scheduler {
  let running = false;
  let sweeping = false;
  const runRequestSweep = async (): Promise<void> => {
    if (!requests || sweeping) return;
    sweeping = true;
    try {
      const r = await sweepRequests(requests);
      if (r.expired + r.connectFailed + r.tenantPassive + r.customerPassive + r.bindingsRevoked > 0) log.info({ job: "request-sweep", ...r }, "talep durumları güncellendi");
    } catch (err) {
      log.error({ err, job: "request-sweep" }, "zamanlanmış iş hatası");
    } finally {
      sweeping = false;
    }
  };
  let retentionTimer: NodeJS.Timeout | undefined;
  const armRetention = (): void => {
    if (!retention) return;
    retentionTimer = setTimeout(() => {
      void retention
        .run()
        .then((r) => {
          if (r) log.info({ job: "retention", tenants: r.tenants, failures: r.failures, ...r.totals }, "saklama işi tamamlandı");
        })
        .catch((err: unknown) => log.error({ err, job: "retention" }, "zamanlanmış iş hatası"))
        .finally(armRetention);
    }, nextRetentionAt(Date.now()) - Date.now());
    retentionTimer.unref();
  };
  armRetention();
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
    },
  };
}
