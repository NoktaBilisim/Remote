-- GERİ ALMA (elle, dba) — 20261111010000_p2_support_sessions. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: support_sessions tablosunu VE VERİSİNİ siler; önce yedek alın (docs/db-notlari.md "Geri alma").
-- P3+ migration'ları uygulanmışsa önce onların down.sql'i çalıştırılmalıdır (ters sıra).
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111010000_p2_support_sessions/down.sql
-- CHECK kısıtları ve indeksler tabloyla birlikte düşer. app'in tablo yetkisi (tables_priv) kalır;
-- tablo yeniden oluşunca grants.sql ile aynı hale gelir (zararsız).

-- DropForeignKey
ALTER TABLE `support_sessions` DROP FOREIGN KEY `support_sessions_tenant_id_fkey`;

-- DropForeignKey
ALTER TABLE `support_sessions` DROP FOREIGN KEY `support_sessions_technician_id_fkey`;

-- DropTable
DROP TABLE `support_sessions`;

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111010000_p2_support_sessions';
