-- GERİ ALMA (elle, dba) — 20261120000000_p19_web_requests. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P19 sunucu kodu geri
-- alınmalı (DATA_STEPS.MESSAGES'taki notification_outbox parçası, anonimleştirmedeki outbox silmesi, WEB/SMS/outbox yazan
-- yollar) ve prisma/sql/grants.sql P18 hâline döndürülmeli (notification_outbox yokken GRANT hata verir; yetki aşağıda
-- REVOKE edilir).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261120000000_p19_web_requests/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur):
--   * p19_down_guard_chk: `source='WEB'` talep ya da notification_outbox satırı var (WEB talebi NOT NULL client_version'a
--     dönemez; bildirim kaydı onaysız silinmez — önce bilinçli silinir/anonimleştirilir, migrator).
-- Kalıcı kayıp (guard'sız): talep bildirim bayrakları, firma web formu/bildirim anahtarları, firma SMS ayarı (URL, şifreli
-- anahtar, başlık) — SMS ayarı varsa önce not alın.
CREATE TEMPORARY TABLE `p19_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p19_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p19_down_guard` (`n`) SELECT
    (SELECT COUNT(*) FROM `support_requests` WHERE CAST(`source` AS BINARY) <> 'AGENT')
    + (SELECT COUNT(*) FROM `notification_outbox`);
DROP TEMPORARY TABLE `p19_down_guard`;

-- P19 yetkisi (grants.sql). DROP TABLE tables_priv satırını SİLMEZ → önce REVOKE. IF EXISTS: grants.sql hiç çalışmamışsa
-- uyarı verir, durmaz.
REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON `notification_outbox` FROM 'app'@'%';

DROP TABLE IF EXISTS `notification_outbox`;

ALTER TABLE `support_requests`
    DROP CHECK `support_requests_source_chk`,
    DROP CHECK `support_requests_source_version_chk`,
    DROP COLUMN `notify_email`,
    DROP COLUMN `notify_sms`,
    DROP COLUMN `notify_whatsapp`,
    DROP COLUMN `source`,
    MODIFY `client_version` VARCHAR(20) NOT NULL;

ALTER TABLE `tenant_request_settings`
    DROP COLUMN `notify_email_enabled`,
    DROP COLUMN `notify_sms_enabled`,
    DROP COLUMN `notify_whatsapp_enabled`,
    DROP COLUMN `web_form_enabled`;

ALTER TABLE `tenant_settings`
    DROP CHECK `tenant_settings_sms_url_chk`,
    DROP CHECK `tenant_settings_sms_header_chk`,
    DROP CHECK `tenant_settings_sms_api_key_enc_chk`,
    DROP COLUMN `sms_api_key_enc`,
    DROP COLUMN `sms_header`,
    DROP COLUMN `sms_url`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261120000000_p19_web_requests';
