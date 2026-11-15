-- GERİ ALMA (elle, dba) — 20261118000000_p16_hard_delete. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P16 sunucu kodu geri
-- alınmalı (purge işleri, mezar taşı) ve prisma/sql/grants.sql P15 hâline döndürülmeli (tenant_purge_jobs yokken GRANT
-- hata verir; 8 tablodaki DELETE yetkisi aşağıda REVOKE edilir).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261118000000_p16_hard_delete/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur):
--   * p16_down_guard_chk: DELETED (mezar taşı) kullanıcı ya da tenant_purge_jobs satırı var → P15 şeması bunları ifade
--     edemez (status_chk DELETED'i reddeder; iş satırı silme kararının kanıtıdır).
--   * p16_down_fk_guard_chk: audit_logs.tenant_id firması silinmiş (dangling) satır var → FK geri eklenemez.
-- Silinmiş veri geri gelmez (R26). `users.delete` sıfırlaması geri getirilmez (bilinçli; yetki toggle'dan yeniden verilir).
CREATE TEMPORARY TABLE `p16_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p16_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p16_down_guard` (`n`) SELECT
    (SELECT COUNT(*) FROM `users` WHERE CAST(`status` AS BINARY) = 'DELETED')
    + (SELECT COUNT(*) FROM `tenant_purge_jobs`);
DROP TEMPORARY TABLE `p16_down_guard`;
CREATE TEMPORARY TABLE `p16_down_fk_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p16_down_fk_guard_chk` CHECK (`n` = 0));
INSERT INTO `p16_down_fk_guard` (`n`) SELECT COUNT(*) FROM `audit_logs` a
    WHERE a.`tenant_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `tenants` t WHERE t.`id` = a.`tenant_id`);
DROP TEMPORARY TABLE `p16_down_fk_guard`;

DROP PROCEDURE IF EXISTS `p16_precheck`;

-- P16 yetkileri (grants.sql). IF EXISTS: grants.sql hiç çalışmamışsa uyarı verir, durmaz.
REVOKE IF EXISTS DELETE ON `support_sessions` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `support_requests` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `session_consents` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `device_bindings` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `customers` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `request_refs` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `consent_texts` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `tenant_request_settings` FROM 'app'@'%';
REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON `tenant_purge_jobs` FROM 'app'@'%';

DROP TRIGGER IF EXISTS `support_sessions_delete_guard`;
DROP TRIGGER IF EXISTS `support_requests_delete_guard`;
DROP TRIGGER IF EXISTS `session_consents_delete_guard`;
DROP TRIGGER IF EXISTS `device_bindings_delete_guard`;
DROP TRIGGER IF EXISTS `customers_delete_guard`;
DROP TRIGGER IF EXISTS `request_refs_delete_guard`;
DROP TRIGGER IF EXISTS `consent_texts_delete_guard`;
DROP TRIGGER IF EXISTS `tenant_request_settings_delete_guard`;
DROP TRIGGER IF EXISTS `users_delete_guard`;
DROP TRIGGER IF EXISTS `tenants_delete_guard`;
DROP TRIGGER IF EXISTS `tenant_purge_jobs_delete_guard`;
DROP TRIGGER IF EXISTS `support_sessions_update_guard`;
DROP TRIGGER IF EXISTS `support_requests_update_guard`;
DROP TRIGGER IF EXISTS `device_bindings_update_guard`;
DROP TRIGGER IF EXISTS `users_update_guard`;
DROP TRIGGER IF EXISTS `tenants_insert_guard`;
DROP TRIGGER IF EXISTS `tenants_update_guard`;
DROP TRIGGER IF EXISTS `tenant_purge_jobs_insert_guard`;
DROP TRIGGER IF EXISTS `tenant_purge_jobs_update_guard`;

DROP TABLE IF EXISTS `tenant_purge_jobs`;

ALTER TABLE `users`
    DROP CHECK `users_deleted_chk`,
    DROP CHECK `users_status_chk`,
    ADD CONSTRAINT `users_status_chk` CHECK (CAST(`status` AS BINARY) IN ('ACTIVE', 'PASSIVE'));

ALTER TABLE `tenants` DROP CHECK `tenants_passive_chk`;
ALTER TABLE `tenants` DROP COLUMN `passive_at`, ALGORITHM=INSTANT;

ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261118000000_p16_hard_delete';
