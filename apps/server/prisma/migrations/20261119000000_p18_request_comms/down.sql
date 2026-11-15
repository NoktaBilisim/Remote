-- GERİ ALMA (elle, dba) — 20261119000000_p18_request_comms. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P18 sunucu kodu geri
-- alınmalı (TENANT_PURGE_STEPS'te MESSAGES yok; mesaj/tatil/atama yazan yollar) ve prisma/sql/grants.sql P16 hâline
-- döndürülmeli (session_messages/business_holidays yokken GRANT hata verir; yetkiler aşağıda REVOKE edilir).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261119000000_p18_request_comms/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur):
--   * p18_down_guard_chk: session_messages ya da business_holidays satırı var (mesaj/tatil kaybı onaysız olmaz; önce
--     dışa alınır ya da bilinçli silinir — migrator, tetikleyiciden muaf).
--   * p18_down_jobs_guard_chk: RUNNING/FAILED firma silme işi ya da step = MESSAGES satırı var (P16 adım listesi
--     MESSAGES'ı ifade edemez; yarım iş P16 update_guard'ına takılır).
-- Kalıcı kayıp (guard'sız): talep öncelik/atama/SLA/mesai dışı işaretleri, müşteri öncelik/SLA'sı, firma mesai ayarları.
CREATE TEMPORARY TABLE `p18_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p18_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p18_down_guard` (`n`) SELECT
    (SELECT COUNT(*) FROM `session_messages`) + (SELECT COUNT(*) FROM `business_holidays`);
DROP TEMPORARY TABLE `p18_down_guard`;
CREATE TEMPORARY TABLE `p18_down_jobs_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p18_down_jobs_guard_chk` CHECK (`n` = 0));
INSERT INTO `p18_down_jobs_guard` (`n`) SELECT COUNT(*) FROM `tenant_purge_jobs`
    WHERE CAST(`state` AS BINARY) IN ('RUNNING', 'FAILED') OR CAST(`step` AS BINARY) = 'MESSAGES';
DROP TEMPORARY TABLE `p18_down_jobs_guard`;

DROP PROCEDURE IF EXISTS `p18_precheck`;

-- P18 yetkileri (grants.sql). DROP TABLE tables_priv satırını SİLMEZ → önce REVOKE. IF EXISTS: grants.sql hiç
-- çalışmamışsa uyarı verir, durmaz.
REVOKE IF EXISTS SELECT, INSERT, DELETE ON `session_messages` FROM 'app'@'%';
REVOKE IF EXISTS SELECT, INSERT, DELETE ON `business_holidays` FROM 'app'@'%';

-- Firma silme adım listesi P16 hâline (update_guard gövdesi P16 migration'ındakiyle birebir).
DROP TRIGGER IF EXISTS `tenant_purge_jobs_update_guard`;
CREATE TRIGGER `tenant_purge_jobs_update_guard` BEFORE UPDATE ON `tenant_purge_jobs` FOR EACH ROW
BEGIN
    DECLARE v_now DATETIME(3);
    DECLARE v_o VARBINARY(20);
    DECLARE v_n VARBINARY(20);
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root') THEN
        SET v_now = CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00');
        SET v_o = CAST(OLD.`state` AS BINARY), v_n = CAST(NEW.`state` AS BINARY);
        IF NOT (NEW.`id` <=> OLD.`id` AND CAST(NEW.`tenant_id` AS BINARY) <=> CAST(OLD.`tenant_id` AS BINARY)
                AND NEW.`scheduled_for` <=> OLD.`scheduled_for` AND NEW.`started_by` <=> OLD.`started_by`
                AND NEW.`created_at` <=> OLD.`created_at`) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs id/tenant_id/scheduled_for/started_by/created_at are immutable';
        END IF;
        IF v_o IN ('DONE', 'CANCELLED') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs DONE/CANCELLED rows are immutable';
        END IF;
        IF NOT (v_n <=> v_o) AND NOT COALESCE(
                (v_o = 'SCHEDULED' AND v_n = 'RUNNING' AND v_now >= OLD.`scheduled_for`)
                OR (v_o = 'SCHEDULED' AND v_n = 'CANCELLED')
                OR (v_o = 'RUNNING' AND v_n IN ('DONE', 'FAILED'))
                OR (v_o = 'FAILED' AND v_n = 'RUNNING'), FALSE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs state transition denied (or scheduled_for not reached)';
        END IF;
        IF NOT (NEW.`started_at` <=> OLD.`started_at`) AND NOT (v_o = 'SCHEDULED' AND v_n = 'RUNNING') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs started_at is set only on SCHEDULED->RUNNING';
        END IF;
        IF NOT (NEW.`finished_at` <=> OLD.`finished_at`) AND NOT (v_o <> 'DONE' AND v_n = 'DONE') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs finished_at is set only on ->DONE';
        END IF;
        IF NOT (NEW.`cancelled_at` <=> OLD.`cancelled_at` AND NEW.`cancelled_by` <=> OLD.`cancelled_by`)
           AND NOT (v_o = 'SCHEDULED' AND v_n = 'CANCELLED') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs cancelled_at/by are set only on SCHEDULED->CANCELLED';
        END IF;
        IF v_o = 'FAILED' AND v_n = 'RUNNING' THEN
            IF CAST(NEW.`preview_hash` AS BINARY) <=> CAST(OLD.`preview_hash` AS BINARY) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs resume (FAILED->RUNNING) requires a new preview_hash';
            END IF;
        ELSEIF NOT (CAST(NEW.`preview_hash` AS BINARY) <=> CAST(OLD.`preview_hash` AS BINARY)) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs preview_hash changes only on FAILED->RUNNING';
        END IF;
        IF NOT (CAST(NEW.`step` AS BINARY) <=> CAST(OLD.`step` AS BINARY)) THEN
            IF NOT COALESCE(v_o = 'RUNNING' AND v_n IN ('RUNNING', 'DONE')
                    AND FIELD(CAST(OLD.`step` AS BINARY), 'FENCE', 'SESSION_FILES', 'SESSION_CONSENTS', 'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS',
                  'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS', 'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS',
                  'TENANT_ROW', 'FILES', 'DONE') > 0
                    AND FIELD(CAST(NEW.`step` AS BINARY), 'FENCE', 'SESSION_FILES', 'SESSION_CONSENTS', 'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS',
                  'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS', 'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS',
                  'TENANT_ROW', 'FILES', 'DONE')
                        = FIELD(CAST(OLD.`step` AS BINARY), 'FENCE', 'SESSION_FILES', 'SESSION_CONSENTS', 'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS',
                  'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS', 'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS',
                  'TENANT_ROW', 'FILES', 'DONE') + 1, FALSE) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs step may only advance by one while RUNNING';
            END IF;
        END IF;
        IF NOT (NEW.`tenant_row_deleted_at` <=> OLD.`tenant_row_deleted_at`) THEN
            IF NOT COALESCE(OLD.`tenant_row_deleted_at` IS NULL AND v_o = 'RUNNING'
                    AND CAST(OLD.`step` AS BINARY) = 'TENANT_ROW'
                    AND NOT EXISTS (SELECT 1 FROM `tenants` x WHERE x.`id` = OLD.`tenant_id`), FALSE) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_row_deleted_at is write-once at step TENANT_ROW after the tenant row is gone';
            END IF;
            SET NEW.`tenant_row_deleted_at` = v_now;
        END IF;
        IF v_o = 'SCHEDULED' AND v_n = 'RUNNING' THEN
            SET NEW.`started_at` = v_now;
        ELSEIF v_n = 'DONE' AND v_o <> 'DONE' THEN
            SET NEW.`finished_at` = v_now;
        ELSEIF v_n = 'CANCELLED' AND v_o <> 'CANCELLED' THEN
            SET NEW.`cancelled_at` = v_now;
        END IF;
    END IF;
END;

ALTER TABLE `tenant_purge_jobs`
    DROP CHECK `tenant_purge_jobs_step_chk`,
    ADD CONSTRAINT `tenant_purge_jobs_step_chk` CHECK (CAST(`step` AS BINARY) IN ('FENCE', 'SESSION_FILES', 'SESSION_CONSENTS',
        'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS', 'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS',
        'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS', 'TENANT_ROW', 'FILES', 'DONE'));

DROP TRIGGER IF EXISTS `session_messages_delete_guard`;
DROP TABLE IF EXISTS `session_messages`;
DROP TABLE IF EXISTS `business_holidays`;

-- FK önce (indeksi kullanıyor), sonra indeks, CHECK'ler ve sütunlar (tek ALTER).
ALTER TABLE `support_requests` DROP FOREIGN KEY `support_requests_assigned_to_tenant_id_fkey`;
ALTER TABLE `support_requests`
    DROP INDEX `support_requests_assigned_to_tenant_id_status_idx`,
    DROP CHECK `support_requests_priority_chk`,
    DROP CHECK `support_requests_assigned_chk`,
    DROP CHECK `support_requests_sla_minutes_chk`,
    DROP CHECK `support_requests_sla_due_chk`,
    DROP COLUMN `after_hours`,
    DROP COLUMN `assigned_at`,
    DROP COLUMN `assigned_to`,
    DROP COLUMN `priority`,
    DROP COLUMN `sla_due_at`,
    DROP COLUMN `sla_minutes`;
DROP INDEX `users_id_tenant_id_key` ON `users`;

ALTER TABLE `customers`
    DROP CHECK `customers_default_priority_chk`,
    DROP CHECK `customers_sla_minutes_chk`,
    DROP COLUMN `default_priority`,
    DROP COLUMN `sla_minutes`;

ALTER TABLE `tenant_request_settings`
    DROP CHECK `tenant_request_settings_default_priority_chk`,
    DROP CHECK `tenant_request_settings_default_sla_chk`,
    DROP CHECK `tenant_request_settings_time_zone_chk`,
    DROP CHECK `tenant_request_settings_after_hours_mode_chk`,
    DROP CHECK `tenant_request_settings_hours_enabled_chk`,
    DROP CHECK `tenant_request_settings_business_hours_chk`,
    DROP COLUMN `after_hours_mode`,
    DROP COLUMN `business_hours`,
    DROP COLUMN `default_priority`,
    DROP COLUMN `default_sla_minutes`,
    DROP COLUMN `hours_enabled`,
    DROP COLUMN `time_zone`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261119000000_p18_request_comms';
