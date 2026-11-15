-- GERİ ALMA (elle, dba) — 20261121010000_p27_unattended. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce: UNATTENDED_MODE=off, açık
-- gözetimsiz oturumların bitmesi, P27 sunucu kodunun geri alınması ve prisma/sql/grants.sql'in P27 öncesi hâline dönmesi
-- (tablolar yokken GRANT hata verir; yetkiler aşağıda REVOKE edilir). Sonra precheck.sql (hepsi 0 olmalı).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261121010000_p27_unattended/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur): p27_down_guard_chk — gözetimsiz oturum/onay, talep dışı outbox satırı,
-- kayıtlı cihaz ya da kayıt kodu var. Bu satırlar eski CHECK'lere sığmaz ve oturum geçmişi silinmez (precheck.sql başlığı).
-- Kalıcı kayıp (guard'sız): customer_notify_contacts (müşteri bildirim adresleri) ve cihazsız grant satırı olamaz (FK).
-- Kilit: support_sessions / session_consents / notification_outbox CHECK geri dönüşü COPY (tablo başına tek ALTER; R-P27-5).
CREATE TEMPORARY TABLE `p27_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p27_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p27_down_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `support_sessions` WHERE `device_id` IS NOT NULL OR CAST(`mode` AS BINARY) = 'UNATTENDED')
    + (SELECT COUNT(*) FROM `session_consents` WHERE CAST(`source` AS BINARY) = 'UNATTENDED')
    + (SELECT COUNT(*) FROM `notification_outbox` WHERE `request_id` IS NULL)
    + (SELECT COUNT(*) FROM `unattended_devices`)
    + (SELECT COUNT(*) FROM `unattended_registration_codes`);
DROP TEMPORARY TABLE `p27_down_guard`;

-- P27 yetkileri (grants.sql). DROP TABLE tables_priv satırını SİLMEZ → önce REVOKE. IF EXISTS: grants.sql hiç çalışmamışsa
-- uyarı verir, durmaz.
REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON `unattended_devices` FROM 'app'@'%';
REVOKE IF EXISTS SELECT, INSERT, DELETE ON `unattended_device_grants` FROM 'app'@'%';
REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON `unattended_registration_codes` FROM 'app'@'%';
REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON `customer_notify_contacts` FROM 'app'@'%';

-- notification_outbox: P19 hâli. FK'si olan sütun MODIFY edilemez (MySQL 1832) → talep FK'si aynı ALTER'da düşer, ayrı ALTER'da
-- aynı adla geri gelir (ikinci COPY; tablo 7 gün temizlikle küçük).
ALTER TABLE `notification_outbox`
    DROP FOREIGN KEY `notification_outbox_session_id_tenant_id_fkey`,
    DROP FOREIGN KEY `notification_outbox_request_id_tenant_id_fkey`,
    DROP CHECK `notification_outbox_event_id_chk`,
    DROP CHECK `notification_outbox_kind_anchor_chk`,
    DROP CHECK `notification_outbox_anchor_chk`,
    DROP CHECK `notification_outbox_kind_chk`,
    ADD CONSTRAINT `notification_outbox_kind_chk` CHECK (CAST(`kind` AS BINARY) IN ('REQ_ACCEPTED', 'REQ_REJECTED', 'REQ_EXPIRED')),
    DROP INDEX `notification_outbox_session_id_tenant_id_kind_channel_recipi_key`,
    DROP INDEX `notification_outbox_event_id_tenant_id_kind_channel_recipien_key`,
    DROP COLUMN `session_id`,
    DROP COLUMN `event_id`,
    MODIFY `request_id` CHAR(26) NOT NULL,
    ALGORITHM=COPY;
ALTER TABLE `notification_outbox` ADD CONSTRAINT `notification_outbox_request_id_tenant_id_fkey` FOREIGN KEY (`request_id`, `tenant_id`) REFERENCES `support_requests`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `session_consents`
    DROP CHECK `session_consents_source_chk`,
    ADD CONSTRAINT `session_consents_source_chk` CHECK (CAST(`source` AS BINARY) IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM', 'TECH')),
    ALGORITHM=COPY;

-- support_sessions: P19 J2 sonrası hâl (P8b/P8/P13a/P3+ADR-0014 tanımları birebir).
ALTER TABLE `support_sessions`
    DROP FOREIGN KEY `support_sessions_device_id_tenant_id_fkey`,
    DROP CHECK `support_sessions_unattended_device_chk`,
    DROP CHECK `support_sessions_device_mode_chk`,
    DROP CHECK `support_sessions_device_request_chk`,
    DROP CHECK `support_sessions_mode_chk`,
    DROP CHECK `support_sessions_code_pending_chk`,
    DROP CHECK `support_sessions_ttl_chk`,
    DROP CHECK `support_sessions_customer_consumed_chk`,
    DROP CHECK `support_sessions_customer_name_chk`,
    DROP CHECK `support_sessions_anonymized_chk`,
    ADD CONSTRAINT `support_sessions_mode_chk` CHECK (`mode` IS NULL OR CAST(`mode` AS BINARY) IN ('AGENT', 'BROWSER')),
    ADD CONSTRAINT `support_sessions_code_pending_chk` CHECK (
        (`request_id` IS NOT NULL AND `active_code` IS NULL)
        OR (`request_id` IS NULL AND (`status` = 'PENDING') = (`active_code` IS NOT NULL))),
    ADD CONSTRAINT `support_sessions_ttl_chk` CHECK (
        (`request_id` IS NULL AND `expires_at` BETWEEN `created_at` + INTERVAL 14 MINUTE AND `created_at` + INTERVAL 31 MINUTE)
        OR (`request_id` IS NOT NULL AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) BETWEEN 55 AND 65)),
    ADD CONSTRAINT `support_sessions_customer_consumed_chk` CHECK (`customer_name` IS NULL OR `consumed_at` IS NOT NULL OR `request_id` IS NOT NULL),
    ADD CONSTRAINT `support_sessions_customer_name_chk` CHECK (
        `customer_name` IS NULL
        OR (CHAR_LENGTH(`customer_name`) BETWEEN 2 AND 100
            AND CHAR_LENGTH(`customer_name`) = CHAR_LENGTH(TRIM(`customer_name`))
            AND NOT REGEXP_LIKE(`customer_name`, '[\\p{Cc}\\p{Cf}]', 'c'))),
    ADD CONSTRAINT `support_sessions_anonymized_chk` CHECK (`anonymized_at` IS NULL
        OR (`status` IN ('ENDED', 'EXPIRED', 'CANCELLED')
            AND `customer_name` IS NULL AND `customer_email` IS NULL AND `note` IS NULL
            AND `guest_net_key` IS NULL AND `guest_ip_key` IS NULL)),
    DROP INDEX `support_sessions_device_id_tenant_id_idx`,
    DROP COLUMN `device_id`,
    ALGORITHM=COPY;

DROP TABLE IF EXISTS `unattended_device_grants`;
DROP TABLE IF EXISTS `unattended_registration_codes`;
DROP TABLE IF EXISTS `customer_notify_contacts`;
DROP TABLE IF EXISTS `unattended_devices`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261121010000_p27_unattended';
