-- GERİ ALMA (elle, dba) — 20261111060000_p8_session_history. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Ayrıca P8 indeksleri (support_sessions 2, audit_logs 1) düşer; veri kaybı yok.
-- Uyarı: customer_name/customer_email/ticket_no/note sütunlarını VE VERİSİNİ siler (teknisyen notları,
-- ticket eşlemeleri, müşteri adları). Önce yedek alın (docs/db-notlari.md "Geri alma", docs/runbook.md).
-- Sonraki (P9+) migration'lar uygulanmışsa önce onların down.sql'i çalıştırılmalıdır (ters sıra). P8 kodu
-- (admit'te customer_* yazan, PATCH/liste/CSV) önce geri alınmalıdır; aksi halde Prisma sorguları
-- olmayan sütun yüzünden hata verir.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261111060000_p8_session_history/down.sql
-- grants.sql değişmedi (yeni tablo yok).

-- DropCheck (sütunlar düşmeden önce; MySQL sütuna bağlı CHECK varken DROP COLUMN'ı reddeder)
ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_customer_name_chk`,
    DROP CHECK `support_sessions_customer_email_chk`,
    DROP CHECK `support_sessions_customer_consumed_chk`,
    DROP CHECK `support_sessions_ticket_no_chk`,
    DROP CHECK `support_sessions_note_chk`;

-- DropIndex
DROP INDEX `support_sessions_tenant_id_status_created_at_idx` ON `support_sessions`;
DROP INDEX `support_sessions_created_at_idx` ON `support_sessions`;
DROP INDEX `audit_logs_tenant_id_entity_entity_id_created_at_idx` ON `audit_logs`;

-- AlterTable
ALTER TABLE `support_sessions` DROP COLUMN `customer_email`,
    DROP COLUMN `customer_name`,
    DROP COLUMN `note`,
    DROP COLUMN `ticket_no`;

-- Migration kaydını kaldır (geri alma tamamlandı).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261111060000_p8_session_history';
