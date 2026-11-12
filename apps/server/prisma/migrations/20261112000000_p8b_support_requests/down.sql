-- GERİ ALMA (elle, dba) — 20261112000000_p8b_support_requests. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: support_requests ve tenant_request_settings tablolarını VE VERİSİNİ siler (talepler, firma ref'leri — eski
-- indirme bağlantıları geçersizleşir). Önce yedek alın (docs/runbook.md). P8b kodu önce geri alınmalıdır.
-- Koruma: talepten doğan oturum / talep onay satırı varsa veya 190 karakteri aşan oturum e-postası varsa eski CHECK'ler
-- ve sütun boyu geri yazılamaz → geçici tablo CHECK'i 3819 (`p8b_down_guard_chk`) ile HİÇBİR ŞEY DEĞİŞMEDEN durur.
-- Bu satırlar KVKK/oturum kanıtıdır: silmeyin, mimara bildirin.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261112000000_p8b_support_requests/down.sql
CREATE TEMPORARY TABLE `p8b_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p8b_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p8b_down_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `support_sessions` WHERE `request_id` IS NOT NULL OR CHAR_LENGTH(`customer_email`) > 190)
    + (SELECT COUNT(*) FROM `session_consents` WHERE `request_id` IS NOT NULL);
DROP TEMPORARY TABLE `p8b_down_guard`;

-- Yetkiler (MySQL tablo düşünce tablo yetkisini silmez).
REVOKE IF EXISTS UPDATE (`is_current`, `updated_at`) ON `consent_texts` FROM 'app'@'%';
REVOKE IF EXISTS ALL PRIVILEGES ON `support_requests` FROM 'app'@'%';
REVOKE IF EXISTS ALL PRIVILEGES ON `tenant_request_settings` FROM 'app'@'%';

ALTER TABLE `session_consents` DROP FOREIGN KEY `session_consents_request_id_tenant_id_fkey`;
ALTER TABLE `session_consents` DROP CHECK `session_consents_request_scope_chk`;
DROP INDEX `session_consents_request_id_tenant_id_idx` ON `session_consents`;
ALTER TABLE `session_consents` DROP COLUMN `request_id`;

ALTER TABLE `support_sessions` DROP FOREIGN KEY `support_sessions_request_id_tenant_id_fkey`;
ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_code_pending_chk`,
    DROP CHECK `support_sessions_ttl_chk`,
    DROP CHECK `support_sessions_customer_consumed_chk`,
    DROP CHECK `support_sessions_request_mode_chk`,
    DROP CHECK `support_sessions_guest_keys_chk`,
    ADD CONSTRAINT `support_sessions_code_pending_chk` CHECK ((`status` = 'PENDING') = (`active_code` IS NOT NULL)),
    ADD CONSTRAINT `support_sessions_ttl_chk` CHECK (`expires_at` BETWEEN `created_at` + INTERVAL 14 MINUTE AND `created_at` + INTERVAL 31 MINUTE),
    ADD CONSTRAINT `support_sessions_customer_consumed_chk` CHECK (`customer_name` IS NULL OR `consumed_at` IS NOT NULL);
DROP INDEX `support_sessions_request_id_tenant_id_key` ON `support_sessions`;
DROP INDEX `support_sessions_tenant_id_guest_net_key_consumed_at_idx` ON `support_sessions`;
DROP INDEX `support_sessions_tenant_id_guest_ip_key_consumed_at_idx` ON `support_sessions`;
ALTER TABLE `support_sessions` DROP COLUMN `request_id`,
    DROP COLUMN `guest_net_key`,
    DROP COLUMN `guest_ip_key`,
    MODIFY `customer_email` VARCHAR(190) NULL;

DROP TABLE `support_requests`;
DROP TABLE `tenant_request_settings`;

-- Not: seed'in eklediği aydınlatma metni v2 kalır (consent_texts değişmez kayıttır; P4 şemasıyla uyumlu).
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261112000000_p8b_support_requests';
