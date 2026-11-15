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
import { OUTBOX_POLL_MS, type NotifyOutbox } from "../notify/outbox.ts";

const EXPIRY_INTERVAL_MS = 30_000;

export interface Scheduler {
  /** Expiry turunu hemen çalıştırır (testler ve ilk açılış). */
  runExpiry(): Promise<number>;
  stop(): void;
}

/**
 * Zamanlayıcı tablosundaki tek iş: `tick` turu çalıştırır (sonucu ve hatayı kendisi loglar), bitince `delay()` sonra yeniden
 * kurulur; `stop()` sonrası (süren tur bitse de) yeniden kurulmaz.
 */
interface TimedJob {
  /** Açılış adımı; `arm` ilk turu kurar. */
  start(arm: () => void): void;
  tick(): Promise<unknown>;
  delay(): number;
}

/** P13a: günlük 03:30 Europe/Istanbul saklama işi (jobs/retention.ts; AC-159, 195, 197..199). */
function retentionJob(log: FastifyBaseLogger, retention: RetentionJob): TimedJob {
  return {
    start: (arm) => arm(),
    tick: () =>
      retention
        .run()
        .then((r) => {
          if (r) log.info({ job: "retention", tenants: r.tenants, failures: r.failures, ...r.totals }, "saklama işi tamamlandı");
        })
        .catch((err: unknown) => log.error({ err, job: "retention" }, "zamanlanmış iş hatası")),
    delay: () => nextRetentionAt(Date.now()) - Date.now(),
  };
}

/** P16 (AC-243): haftalık pazar 04:30 Europe/Istanbul yetim dosya taraması (açılışta önce durum dosyası). */
function orphanScanJob(log: FastifyBaseLogger, orphanScan: OrphanScanJob): TimedJob {
  return {
    start: (arm) =>
      void orphanScan
        .init()
        .catch((err: unknown) => log.error({ err, job: "orphan-scan" }, "yetim taraması durum dosyası okunamadı"))
        .finally(arm),
    tick: () =>
      orphanScan
        .run()
        .then((r) => {
          if (r) log.info({ job: "orphan-scan", ...r }, "yetim dosya taraması tamamlandı");
        })
        .catch((err: unknown) => log.error({ err, job: "orphan-scan" }, "zamanlanmış iş hatası")),
    delay: () => nextOrphanScanAt(Date.now()) - Date.now(),
  };
}

/** P16 G3 (AC-242): 60 sn'de bir firma silme turu (tur başına tek iş; açılışta göstergeler hemen). */
function tenantPurgeJob(log: FastifyBaseLogger, tenantPurge: TenantPurgeRunner): TimedJob {
  return {
    start: (arm) => {
      void tenantPurge.refreshMetrics().catch((err: unknown) => log.error({ err, job: "tenant-purge" }, "gösterge okunamadı"));
      arm();
    },
    tick: () =>
      tenantPurge
        .tick()
        .then((r) => {
          if (r !== "idle") log.info({ job: "tenant-purge", outcome: r }, "firma silme turu");
        })
        .catch((err: unknown) => log.error({ err, job: "tenant-purge" }, "zamanlanmış iş hatası")),
    delay: () => PURGE_INTERVAL_MS,
  };
}

/** P19 J3 (AC-261): 2 sn'de bir müşteri bildirimi işçisi (açılışta önce çökme kurtarma). */
function outboxJob(log: FastifyBaseLogger, outbox: NotifyOutbox): TimedJob {
  return {
    start: (arm) =>
      void outbox
        .recover(Date.now())
        .catch((err: unknown) => log.error({ err, job: "notify-outbox" }, "outbox kurtarma hatası"))
        .finally(arm),
    tick: () => outbox.tick().catch((err: unknown) => log.error({ err, job: "notify-outbox" }, "zamanlanmış iş hatası")),
    delay: () => OUTBOX_POLL_MS,
  };
}

/** İşi kurar; dönen `clear` bekleyen zamanlayıcıyı iptal eder. */
function startTimedJob(job: TimedJob, isStopped: () => boolean): () => void {
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    if (isStopped()) return;
    timer = setTimeout(() => {
      void job.tick().finally(arm);
    }, job.delay());
    timer.unref();
  };
  job.start(arm);
  return () => {
    if (timer) clearTimeout(timer);
  };
}

/** P8b: 30 sn turunda talep süpürücüsü (süre dolumu, 60 sn bağlanma, pasif tenant); turlar üst üste binmez. */
function requestSweeper(log: FastifyBaseLogger, requests?: RequestService): () => Promise<void> {
  let sweeping = false;
  return async () => {
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
}

/** Oturum süre dolumu turu; turlar üst üste binmez (çakışan çağrı 0 döner). */
function sessionExpiry(db: Db, log: FastifyBaseLogger, rooms?: RoomNotifier): () => Promise<number> {
  let running = false;
  return async () => {
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
}

/**
 * Oturum süre dolumu her `intervalMs`'de; P8b: `requests` verilirse aynı turda talep süpürücüsü. İş tablosu (verilen
 * işler, bu sırayla): `retention` (P13a), `orphanScan` (P16 AC-243), `tenantPurge` (P16 G3 AC-242), `outbox` (P19 J3
 * AC-261; temizlik ve hacim göstergesi işçi turunun içinde, kendi aralıklarıyla).
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
  outbox?: NotifyOutbox,
): Scheduler {
  const runRequestSweep = requestSweeper(log, requests);
  let stopped = false;
  const table: TimedJob[] = [
    ...(retention ? [retentionJob(log, retention)] : []),
    ...(orphanScan ? [orphanScanJob(log, orphanScan)] : []),
    ...(tenantPurge ? [tenantPurgeJob(log, tenantPurge)] : []),
    ...(outbox ? [outboxJob(log, outbox)] : []),
  ];
  const clears = table.map((job) => startTimedJob(job, () => stopped));
  const runExpiry = sessionExpiry(db, log, rooms);
  const timer = setInterval(() => {
    void runExpiry();
    void runRequestSweep();
  }, intervalMs);
  timer.unref();
  return {
    runExpiry,
    stop: () => {
      clearInterval(timer);
      stopped = true;
      for (const clear of clears) clear();
    },
  };
}
