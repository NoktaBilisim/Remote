// P28b uygulama bağlantısı (mimari-p28b §2, §7.3, §11.2; D-r2-1). Depo (`FILES_DIR`), clamd istemcisi, adil kuyruk, tarayıcı,
// dosya servisi ve metrikler tek yerde kurulur; `app.fsrv` ile süslenir. Sinyalizasyon `app.fsrv.service.sink` ve lifecycle
// kancalarını bağlar. `av` alt ağından (`CLAMAV_ALLOWED_CIDR`) gelen HER bağlantı (HTTP + WS upgrade) TCP kabulünde kapatılır;
// `onRequest`'in ilk kancası aynı kuralı gövde okunmadan uygular (inject / savunma derinliği).
import type { FastifyInstance } from "fastify";
import { AV_SELFTEST_INTERVAL_MS } from "@remote/contracts/ws-fsrv";
import type { Env } from "../env.ts";
import type { SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import type { Metrics } from "../ops/metrics.ts";
import { effectiveClamav, markMisconfigured, type ClamavDeps } from "../settings/clamav.ts";
import { realClock, type Clock } from "../signaling/types.ts";
import { ClamdClient, inCidrRange, type LookupAll } from "./clamd.ts";
import { Scanner, registerScanMetrics } from "./scan.ts";
import { ScanQueue } from "./scan-queue.ts";
import { FsrvService, registerFsrvMetrics } from "./service.ts";
import { FileStore } from "./store.ts";

/** Yalnız testler (server.ts vermez): sahte clamd'ye yönlendirme, DNS, disk oranı ve kısa süreler. */
export interface FsrvTestOptions {
  lookupAll?: LookupAll;
  dialHost?: (resolvedIp: string) => string;
  freeRatio?: number;
  retryTotalMs?: number;
  retryIntervalMs?: number;
  connectTimeoutMs?: number;
  scanTimeoutMs?: number;
}

export interface FsrvRuntime {
  service: FsrvService;
  scanner: Scanner;
  store: FileStore;
  client: ClamdClient;
  clamav: ClamavDeps;
  /** `rs_storage_used_bytes` / `rs_storage_disk_free_ratio` için son okuma (yoklama ve saklama turunda tazelenir). */
  gauges: { usedBytes: number; freeRatio: number };
}

declare module "fastify" {
  interface FastifyInstance {
    /** P28b sunucu dosya hattı. */
    fsrv: FsrvRuntime;
  }
}

/** D-r2-1: `av` ağından gelen bağlantı/istek reddi. buildApp'te ilk `onRequest` kancası olarak çağrılır. */
export function addAvSourceGuard(app: FastifyInstance, cidr: string | undefined): void {
  if (!cidr) return;
  app.server.on("connection", (socket: { remoteAddress?: string; destroy(): void }) => {
    if (inCidrRange(socket.remoteAddress, cidr)) socket.destroy();
  });
  app.addHook("onRequest", async (req, reply) => {
    if (!inCidrRange(req.socket.remoteAddress, cidr)) return;
    req.log.warn({ event: "av_source_rejected" }, "av ağından gelen istek reddedildi");
    await reply.code(404).send();
    return reply;
  });
}

interface FsrvWiring {
  db: Db;
  env: Env;
  secrets: SecretBox;
  metrics: Metrics;
  clock: Clock;
  test?: FsrvTestOptions | undefined;
}

export function decorateFsrv(app: FastifyInstance, w: FsrvWiring): FsrvRuntime {
  const t = w.test ?? {};
  const store = new FileStore(w.env.FILES_DIR);
  if (t.freeRatio !== undefined) store.freeRatioOverride = t.freeRatio;
  const client = new ClamdClient({
    cidr: w.env.CLAMAV_ALLOWED_CIDR,
    ...(t.lookupAll ? { lookupAll: t.lookupAll } : {}),
    ...(t.dialHost ? { dialHost: t.dialHost } : {}),
    ...(t.retryTotalMs !== undefined ? { retryTotalMs: t.retryTotalMs } : {}),
    ...(t.retryIntervalMs !== undefined ? { retryIntervalMs: t.retryIntervalMs } : {}),
    ...(t.connectTimeoutMs !== undefined ? { connectTimeoutMs: t.connectTimeoutMs } : {}),
  });
  const queue = new ScanQueue({
    now: () => w.clock.now(),
    setTimeout: (fn, ms) => w.clock.setTimeout(fn, ms),
    clearTimeout: (h) => w.clock.clearTimeout(h),
  });
  const envTarget = { db: w.db, envHost: w.env.CLAMAV_HOST, envPort: w.env.CLAMAV_PORT };
  const scanner = new Scanner({
    client,
    queue,
    target: () => effectiveClamav(envTarget),
    metrics: w.metrics,
    log: app.log,
    now: () => w.clock.now(),
    ...(t.scanTimeoutMs !== undefined ? { scanTimeoutMs: t.scanTimeoutMs } : {}),
    onMisconfigured: () => markMisconfigured(envTarget, new Date(w.clock.now())),
  });
  const service = new FsrvService({ db: w.db, store, secrets: w.secrets, scanner, metrics: w.metrics, log: app.log, clock: w.clock });
  const rt: FsrvRuntime = {
    service,
    scanner,
    store,
    client,
    clamav: { ...envTarget, client, scanner, log: app.log },
    gauges: { usedBytes: 0, freeRatio: 1 },
  };
  registerScanMetrics(w.metrics, () => scanner);
  registerFsrvMetrics(w.metrics);
  w.metrics.gauge("rs_storage_used_bytes", "Saklanan dosya kullanımı (bayt, tüm firmalar; P28b)", () => rt.gauges.usedBytes);
  w.metrics.gauge("rs_storage_disk_free_ratio", "FILES_DIR diski boş oranı (P28b)", () => rt.gauges.freeRatio);
  app.decorate("fsrv", rt);
  app.addHook("onReady", async () => {
    if (!(await store.writable())) app.log.error({ alarm: "files_not_writable" }, "FILES_DIR yazılamıyor; sunucu dosya modu çalışmaz");
  });
  return rt;
}

/** Ölçüm tazeleme (yoklama + saklama turu). */
export async function refreshStorageGauges(db: Db, rt: FsrvRuntime): Promise<void> {
  const r = await db.$queryRaw<{ n: bigint | null }[]>`SELECT SUM(size_bytes) AS n FROM session_stored_files
    WHERE state IN ('UPLOADING', 'SCANNING', 'CLEAN')`;
  rt.gauges.usedBytes = Number(r[0]?.n ?? 0);
  rt.gauges.freeRatio = await rt.store.freeRatio();
}

/** K9 B3: hızlı yeniden deneme aralığı ve sayısı. 30 sn × 19 ≈ 9,5 dk < bir sonraki 10 dk turu ve `remote-watch` "ardışık 2 tur". */
export const AV_FAST_RETRY_MS = 30_000;
export const AV_FAST_RETRY_MAX = 19;

export interface AvPollerOptions {
  intervalMs?: number;
  fastRetryMs?: number;
  fastRetryMax?: number;
}

/**
 * Öz-sınama yoklama zinciri (§7.3 + K9 B3). Turlar `setTimeout` zinciriyle kurulur (bir yoklama bitmeden yenisi başlamaz).
 * clamd erişilemezse (açılışta imza yüklerken ya da up→down geçişinde) `fastRetryMs` aralıkla en çok `fastRetryMax` kez
 * yeniden dener; bütçe yalnız açılışta ve başarılı bir yoklamadan sonra yenilenir -> hiç açılmayan clamd (profil kapalı)
 * kalıcı 30 sn yoklamasına dönüşmez. Hızlı denemeler `av_down` sayacına katılmaz (Scanner.poll fastRetry).
 */
export function createAvPoller(tick: (fastRetry: boolean) => Promise<boolean>, clock: Clock, o: AvPollerOptions = {}) {
  const intervalMs = o.intervalMs ?? AV_SELFTEST_INTERVAL_MS;
  const fastMs = o.fastRetryMs ?? AV_FAST_RETRY_MS;
  const fastMax = o.fastRetryMax ?? AV_FAST_RETRY_MAX;
  let budget = fastMax;
  let timer: unknown;
  let stopped = false;
  const run = async (fastRetry: boolean): Promise<void> => {
    timer = undefined;
    const up = await tick(fastRetry).catch(() => false);
    if (stopped) return;
    if (up) budget = fastMax;
    const fast = !up && budget > 0;
    if (fast) budget--;
    timer = clock.setTimeout(() => void run(fast), fast ? fastMs : intervalMs);
  };
  return {
    start: (): Promise<void> => run(false),
    stop: (): void => {
      stopped = true;
      if (timer !== undefined) clock.clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** `startJobs`: açılışta ve 10 dk'da bir öz-sınama yoklaması (§7.3); erişilemezken kısa aralıklı yeniden deneme (K9 B3). Kuyruğa girmez. */
export function startAvPolling(app: FastifyInstance, rt: FsrvRuntime, clock: Clock = realClock, o: AvPollerOptions = {}): void {
  const poller = createAvPoller(
    async (fastRetry) => {
      await rt.scanner.poll({ fastRetry });
      await refreshStorageGauges(app.db, rt).catch((err: unknown) => app.log.warn({ err }, "depolama göstergesi okunamadı"));
      return rt.scanner.up === 1;
    },
    clock,
    o,
  );
  app.addHook("onReady", async () => void poller.start());
  app.addHook("onClose", async () => poller.stop());
}
