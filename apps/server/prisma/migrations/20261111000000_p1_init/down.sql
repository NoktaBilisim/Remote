-- GERİ ALMA (elle, dba) — 20261111000000_p1_init. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: tüm P1 tablolarını VE VERİSİNİ siler; önce yedek alın (docs/db-notlari.md "Geri alma").
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111000000_p1_init/down.sql
-- `prisma migrate resolve --rolled-back` yalnız BAŞARISIZ migration için çalışır; bu yüzden kayıt
-- dosyanın sonunda _prisma_migrations'tan silinir (sonraki migrate deploy yeniden uygular).
-- CHECK kısıtları tablolarla birlikte düşer. MySQL tablo yetkilerini (tables_priv) DROP TABLE ile
-- silmez; app yetkileri kalır ve tablo yeniden oluşunca grants.sql ile aynı hale gelir (zararsız).

-- DropForeignKey
ALTER TABLE `tenant_settings` DROP FOREIGN KEY `tenant_settings_tenant_id_fkey`;

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_tenant_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_permissions` DROP FOREIGN KEY `user_permissions_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `auth_sessions` DROP FOREIGN KEY `auth_sessions_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `auth_sessions` DROP FOREIGN KEY `auth_sessions_acting_tenant_id_fkey`;

-- DropForeignKey
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_tenant_id_fkey`;

-- DropTable
DROP TABLE `tenants`;

-- DropTable
DROP TABLE `tenant_settings`;

-- DropTable
DROP TABLE `users`;

-- DropTable
DROP TABLE `user_permissions`;

-- DropTable
DROP TABLE `auth_sessions`;

-- DropTable
DROP TABLE `audit_logs`;

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111000000_p1_init';
