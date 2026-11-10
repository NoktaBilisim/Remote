// Prisma 7 yapılandırması. Migration komutları (migrate deploy, db execute) yalnız `migrate`
// servisinde MIGRATE_DATABASE_URL (migrator kullanıcısı, DDL) ile çalışır; uygulama süreci
// DATABASE_URL (app kullanıcısı, yalnız DML) kullanır ve bu dosyayı okumaz (G-15, ADR-0003).
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});
