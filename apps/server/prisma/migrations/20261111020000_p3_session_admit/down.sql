-- GERİ ALMA (elle, dba) — 20261111020000_p3_session_admit. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: mode, consumed_at, terminated_by sütunlarını VE VERİSİNİ siler (ACTIVE/ENDED oturumların admit
-- zamanı ve zorla sonlandıran bilgisi kaybolur); önce yedek alın (docs/db-notlari.md "Geri alma").
-- Sonraki (P4+) migration'lar uygulanmışsa önce onların down.sql'i çalıştırılmalıdır (ters sıra).
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111020000_p3_session_admit/down.sql
-- ACTIVE satırlar varken geri alınırsa P2 kısıtları ihlal edilmez (P2 ACTIVE'i yasaklamaz); ancak P2 kodu
-- ACTIVE'i yönetmez — geri almadan önce ACTIVE oturumları ENDED yapın.

-- DropCheck (sütun düşmeden önce; MySQL sütuna bağlı CHECK varken DROP COLUMN'ı reddeder)
ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_mode_chk`,
    DROP CHECK `support_sessions_consumed_mode_chk`,
    DROP CHECK `support_sessions_consumed_status_chk`,
    DROP CHECK `support_sessions_consumed_before_expiry_chk`,
    DROP CHECK `support_sessions_terminated_by_chk`;

-- DropForeignKey
ALTER TABLE `support_sessions` DROP FOREIGN KEY `support_sessions_terminated_by_fkey`;

-- DropIndex
DROP INDEX `support_sessions_terminated_by_idx` ON `support_sessions`;

-- AlterTable
ALTER TABLE `support_sessions` DROP COLUMN `consumed_at`,
    DROP COLUMN `mode`,
    DROP COLUMN `terminated_by`;

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111020000_p3_session_admit';
