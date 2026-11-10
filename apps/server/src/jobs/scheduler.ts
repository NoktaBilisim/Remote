// Periyodik işler (mimari §6: P2 expiry, P13 retention). Tek instance (ADR-0005); zamanlayıcı unref'li,
// turlar üst üste binmez, uygulama kapanınca durur. Hata loglanır, bir sonraki turda yeniden denenir.
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import { expireDue } from "../sessions/service.ts";

const EXPIRY_INTERVAL_MS = 30_000;

export interface Scheduler {
  /** Expiry turunu hemen çalıştırır (testler ve ilk açılış). */
  runExpiry(): Promise<number>;
  stop(): void;
}

export function startScheduler(db: Db, log: FastifyBaseLogger, intervalMs = EXPIRY_INTERVAL_MS): Scheduler {
  let running = false;
  const runExpiry = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const ctx = { ip: "", userAgent: "scheduler", requestId: newId() };
      const n = await expireDue(db, ctx, new Date());
      if (n > 0) log.info({ job: "session-expiry", expired: n }, "oturum süresi doldu");
      return n;
    } catch (err) {
      log.error({ err, job: "session-expiry" }, "zamanlanmış iş hatası");
      return 0;
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void runExpiry(), intervalMs);
  timer.unref();
  return { runExpiry, stop: () => clearInterval(timer) };
}
