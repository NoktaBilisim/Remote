// YALNIZ YEREL P10 sayfa testi: gerçek buildApp + yerel sahte SMTP'ye (127.0.0.1) izin veren netguard.
// setup.sh bu dosyayı anlık görüntünün apps/server/ klasörüne kopyalar. Diğer tüm özel/iç ağ kuralları aynen geçerli.
// "smtp.op.test" adı 127.0.0.1'e çözülür (DNS yok). server.ts ile tek fark netguard'dır.
import { buildApp } from "./src/app.ts";
import { loadEnv } from "./src/env.ts";
import { createDb } from "./src/lib/db.ts";
import { createLogger } from "./src/lib/logger.ts";
import { createNetGuard, isBlockedIp } from "./src/lib/netguard.ts";
import { lookup } from "node:dns/promises";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const netguard = createNetGuard({
  lookupAll: async (h) => (h === "smtp.op.test" ? ["127.0.0.1"] : (await lookup(h, { all: true, verbatim: true })).map((a) => a.address)),
  isBlocked: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip),
});
const app = buildApp({ env, db, logger, startJobs: true, netguard });
process.once("SIGTERM", () => void app.close().then(() => db.$disconnect()).finally(() => process.exit(0)));
await app.listen({ host: env.HOST, port: env.PORT });
