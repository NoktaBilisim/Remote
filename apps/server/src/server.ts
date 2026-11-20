// Süreç giriş noktası: env doğrula → DB → uygulama → dinle; SIGTERM/SIGINT'te düzgün kapanış.
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { createDb } from "./lib/db.ts";
import { createLogger } from "./lib/logger.ts";
import { riskAcceptedAlarm } from "./unattended/gate.ts";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const db = createDb(env.DATABASE_URL);
  const app = buildApp({ env, db, logger, startJobs: true });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "kapanıyor");
    void app
      .close()
      .then(() => db.$disconnect())
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await app.listen({ host: env.HOST, port: env.PORT });
  // P27 (AC-297, 342): gözetimsiz erişim kapısının etkin değeri (gizli bilgi yok; SHA listesi yazılmaz).
  const deployEnv = env.DEPLOY_ENV ?? "unset";
  logger.info({ unattendedMode: env.UNATTENDED_MODE, deployEnv }, `unattended.mode=${env.UNATTENDED_MODE} deployEnv=${deployEnv}`);
  // P32 (AC-527a, ADR-0042): prod'da imzasız servis risk kabulü — açılışta bir kez alarm (remote-watch/runbook `grep -c` 1).
  const alarm = riskAcceptedAlarm(env);
  if (alarm) logger.warn(alarm, "gözetimsiz servis imzasız çalışıyor (risk kabul, ADR-0042)");
}

main().catch((error: unknown) => {
  process.stderr.write(`server başlatılamadı: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
