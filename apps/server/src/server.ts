// Süreç giriş noktası: env doğrula → DB → uygulama → dinle; SIGTERM/SIGINT'te düzgün kapanış.
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { createDb } from "./lib/db.ts";
import { createLogger } from "./lib/logger.ts";

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
}

main().catch((error: unknown) => {
  process.stderr.write(`server başlatılamadı: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
