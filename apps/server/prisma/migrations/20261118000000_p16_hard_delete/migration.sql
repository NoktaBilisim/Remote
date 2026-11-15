-- P16 G1 kalıcı silme veri modeli (docs/mimari-e11.md §7.1; ADR-0030 r2 m.1, m.3, m.4, m.5; güvenlik P16 turları
-- S16-2, 3, 4, 6, 10, 11, 13, 15; AC-240, 241, 242). Ayrıntı ve gerekçeler: docs/db-notlari.md "P16".
-- Yetkiler bu dosyada DEĞİL: prisma/sql/grants.sql (8 tabloya DELETE, tenant_purge_jobs SELECT/INSERT/UPDATE/DELETE).
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK, tetikleyici, saklı yordam, fonksiyonel indeks, SIGNAL ve ALGORITHM
-- yan tümcesi üretmez. Prisma'nın ürettiği kısımlar (FK düşürme, passive_at, tenant_purge_jobs CREATE + FK + indeksler)
-- `migrate diff` çıktısıyla aynı ad/tiple yazıldı; sonrasında `migrate diff --exit-code` = 0.
--
-- Kilit (MySQL 8.4):
--  * Ön kontrol (yordam) → yalnız okuma.
--  * audit_logs DROP FOREIGN KEY → yalnız metadata (INPLACE). İndeksler kalır.
--  * tenants ADD COLUMN → INSTANT; geri doldurma UPDATE (yalnız PASSIVE satırlar); ADD CHECK → COPY (tablo küçük).
--  * users CHECK DROP+ADD → COPY (tek ALTER; kısıtsız ara an yok). Tablo küçük.
--  * tenant_purge_jobs yeni (boş) tablo → kilit yok.
--  * CREATE TRIGGER ×19 → ilgili tablolarda kısa metadata kilidi.
--
-- ÖN KONTROL (P14a kalıbı): DDL transaction'a girmez → hiçbir şey değişmeden durmak için önce sayılır:
--   (a) `deleted_at` dolu kullanıcı (P16 öncesi status yalnız ACTIVE|PASSIVE → hepsi DELETED-olmayan; users_deleted_chk
--       bunları reddeder) → `P16_PRECHECK users=<n>`.
--   (b) binlog açık + log_bin_trust_function_creators=0 → tetikleyici 1419 ile yarıda kalırdı → `P16_PRECHECK binlog_flag`.
-- Düzeltme: db-notlari "P16"; sonra `prisma migrate resolve --rolled-back 20261118000000_p16_hard_delete` + `pnpm db:migrate`.
DROP PROCEDURE IF EXISTS `p16_precheck`;
CREATE PROCEDURE `p16_precheck`()
    READS SQL DATA
BEGIN
    DECLARE v_users BIGINT;
    DECLARE v_msg VARCHAR(128);
    SELECT COUNT(*) INTO v_users FROM `users` WHERE `deleted_at` IS NOT NULL;
    SET v_msg = CONCAT_WS(' ',
        IF(v_users > 0, CONCAT('users=', v_users), NULL),
        IF(@@global.log_bin = 1 AND @@global.log_bin_trust_function_creators = 0, 'binlog_flag', NULL));
    IF v_msg <> '' THEN
        SET v_msg = CONCAT('P16_PRECHECK ', v_msg);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END;
CALL `p16_precheck`();
DROP PROCEDURE `p16_precheck`;

-- 1) ADR-0030 m.1: audit_logs.tenant_id FK kalkar (firma silinse de audit satırı kalır; satıra dokunulmaz → içerik
--    özeti `h` değişmez). PRISMA ÜRETTİ. IX(tenant_id, …) indeksleri kalır (Prisma @@index).
ALTER TABLE `audit_logs` DROP FOREIGN KEY `audit_logs_tenant_id_fkey`;

-- 2) tenants.passive_at (AC-242; 30 gün sınırı). PRISMA ÜRETTİ + ALGORITHM ELLE. Geri doldurma: PASSIVE satırlarda
--    updated_at (güvenlik turu 1 "Olumlu": temkinli — pasife alınma anı en geç budur). Idempotent.
ALTER TABLE `tenants` ADD COLUMN `passive_at` DATETIME(3) NULL, ALGORITHM=INSTANT;
UPDATE `tenants` SET `passive_at` = `updated_at`
    WHERE CAST(`status` AS BINARY) = 'PASSIVE' AND `passive_at` IS NULL;
ALTER TABLE `tenants`
    ADD CONSTRAINT `tenants_passive_chk` CHECK ((CAST(`status` AS BINARY) = 'PASSIVE') = (`passive_at` IS NOT NULL));

-- 3) Kullanıcı mezar taşı (ADR-0030 m.4, AC-241). status += DELETED; DELETED ⇔ deleted_at; mezar taşı alanları.
--    email biçimi harf duyarlı: 'deleted+' + id (saklandığı gibi, büyük harf ULID) + '@invalid'.
ALTER TABLE `users`
    DROP CHECK `users_status_chk`,
    ADD CONSTRAINT `users_status_chk` CHECK (CAST(`status` AS BINARY) IN ('ACTIVE', 'PASSIVE', 'DELETED')),
    ADD CONSTRAINT `users_deleted_chk` CHECK (
        (CAST(`status` AS BINARY) = 'DELETED') = (`deleted_at` IS NOT NULL)
        AND (CAST(`status` AS BINARY) <> 'DELETED' OR (
            `username` IS NULL AND `avatar_path` IS NULL AND `totp_secret_enc` IS NULL
            AND CAST(`password_hash` AS BINARY) = '!deleted'
            AND CAST(`email` AS BINARY) = CAST(CONCAT('deleted+', `id`, '@invalid') AS BINARY))));

-- 4) tenant_purge_jobs (ADR-0030 m.5, §7.1). PRISMA ÜRETTİ (CREATE + FK + indeksler). tenant_id bilinçli FK DEĞİL
--    (firma satırı silinince iş satırı kalır; m.1 kuralı). counts NOT NULL: uygulama `{}` ile açar.
CREATE TABLE `tenant_purge_jobs` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    `step` VARCHAR(30) NOT NULL DEFAULT 'FENCE',
    `scheduled_for` DATETIME(3) NOT NULL,
    `counts` JSON NOT NULL,
    `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `last_error` VARCHAR(60) NULL,
    `preview_hash` CHAR(64) NOT NULL,
    `started_by` CHAR(26) NOT NULL,
    `cancelled_by` CHAR(26) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `tenant_row_deleted_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_purge_jobs_preview_hash_key`(`preview_hash`),
    INDEX `tenant_purge_jobs_state_scheduled_for_idx`(`state`, `scheduled_for`),
    INDEX `tenant_purge_jobs_tenant_id_idx`(`tenant_id`),
    INDEX `tenant_purge_jobs_started_by_idx`(`started_by`),
    INDEX `tenant_purge_jobs_cancelled_by_idx`(`cancelled_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tenant_purge_jobs` ADD CONSTRAINT `tenant_purge_jobs_started_by_fkey` FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `tenant_purge_jobs` ADD CONSTRAINT `tenant_purge_jobs_cancelled_by_fkey` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE: CHECK'ler (ikili enum ADR-0014; S16-2 Crockford ULID biçimi → 'system', '..' vb. reddedilir).
ALTER TABLE `tenant_purge_jobs`
    ADD CONSTRAINT `tenant_purge_jobs_tenant_id_fmt_chk` CHECK (REGEXP_LIKE(`tenant_id`, '^[0-9A-HJKMNP-TV-Z]{26}\\z', 'c')),
    ADD CONSTRAINT `tenant_purge_jobs_state_chk` CHECK (CAST(`state` AS BINARY) IN ('SCHEDULED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
    ADD CONSTRAINT `tenant_purge_jobs_step_chk` CHECK (CAST(`step` AS BINARY) IN ('FENCE', 'SESSION_FILES', 'SESSION_CONSENTS',
        'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS', 'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS',
        'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS', 'TENANT_ROW', 'FILES', 'DONE')),
    ADD CONSTRAINT `tenant_purge_jobs_done_chk` CHECK ((CAST(`state` AS BINARY) = 'DONE') = (`finished_at` IS NOT NULL)
        AND (CAST(`state` AS BINARY) = 'DONE') = (CAST(`step` AS BINARY) = 'DONE')),
    ADD CONSTRAINT `tenant_purge_jobs_cancelled_chk` CHECK ((CAST(`state` AS BINARY) = 'CANCELLED') = (`cancelled_at` IS NOT NULL)
        AND (`cancelled_at` IS NULL) = (`cancelled_by` IS NULL)),
    ADD CONSTRAINT `tenant_purge_jobs_tenant_row_chk` CHECK (
        (`tenant_row_deleted_at` IS NULL OR CAST(`step` AS BINARY) IN ('TENANT_ROW', 'FILES', 'DONE'))
        AND (CAST(`step` AS BINARY) NOT IN ('FILES', 'DONE') OR `tenant_row_deleted_at` IS NOT NULL)),
    ADD CONSTRAINT `tenant_purge_jobs_counts_chk` CHECK (JSON_TYPE(`counts`) = 'OBJECT' AND JSON_STORAGE_SIZE(`counts`) <= 4096),
    ADD CONSTRAINT `tenant_purge_jobs_last_error_chk` CHECK (`last_error` IS NULL OR REGEXP_LIKE(`last_error`, '^[a-z_]{1,60}\\z', 'c')),
    ADD CONSTRAINT `tenant_purge_jobs_preview_hash_fmt_chk` CHECK (REGEXP_LIKE(`preview_hash`, '^[a-f0-9]{64}\\z', 'c'));
-- ELLE: firma başına tek açık iş (consent_texts_one_current_uq kalıbı; Prisma ifade edemez).
CREATE UNIQUE INDEX `tenant_purge_jobs_one_open_uq` ON `tenant_purge_jobs`
    ((IF(CAST(`state` AS BINARY) IN ('SCHEDULED', 'RUNNING', 'FAILED'), `tenant_id`, NULL)));


-- 5) TETİKLEYİCİLER (ADR-0030 m.3; 19 yeni, toplam 22: 11 BEFORE DELETE, 6 BEFORE UPDATE, 2 BEFORE INSERT).
--    Ortak kurallar: bileşik gövde (BEGIN…END; mysqldump/geri yükleme, db-notlari P13a); saat UTC_SYSDATE =
--    CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') (SET TIMESTAMP etkilemez); NULL karşılaştırma reddedilir
--    (COALESCE(…, FALSE) = fail-closed); `migrator` ve `root` muaf (USER(): tetikleyici içinde CURRENT_USER() DEFINER'ı
--    döndürür); saklı fonksiyon yok (yedek --routines almaz). PURGING(t) her tetikleyicide satır içi: firmanın RUNNING
--    işi var VE firma PASSIVE VE passive_at ≤ UTC − 30 g. SCHEDULED iş kilidi AÇMAZ (S16-4).
--    MESSAGE_TEXT önekli `p16:` (uygulama db_signal sınıflaması ve testler bu öneki arar).
--    Tetikleyici değişirse: deploy/mysql/audit-continuity.sql sabiti, check-app-grants.sh (sayı), backup.sh/restore.sh
--    beklenen sayı (22) birlikte güncellenir (S16-11).

-- AC-240/242: anonim + 30 gün ya da firma silme işi.
CREATE TRIGGER `support_sessions_delete_guard` BEFORE DELETE ON `support_sessions` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(OLD.`anonymized_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY
            OR EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: support_sessions DELETE denied (not anonymized 30+ days, no running purge)';
    END IF;
END;

-- AC-240/242: anonim + 30 gün ya da firma silme işi.
CREATE TRIGGER `support_requests_delete_guard` BEFORE DELETE ON `support_requests` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(OLD.`anonymized_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY
            OR EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: support_requests DELETE denied (not anonymized 30+ days, no running purge)';
    END IF;
END;

-- AC-240/242: üst oturum anonim + 30 gün ya da firma silme işi (gece işi onayları oturumdan önce siler).
CREATE TRIGGER `session_consents_delete_guard` BEFORE DELETE ON `session_consents` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE((SELECT s.`anonymized_at` FROM `support_sessions` s WHERE s.`id` = OLD.`session_id`) <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY
            OR EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: session_consents DELETE denied (session not anonymized 30+ days, no running purge)';
    END IF;
END;

-- AC-240/242: kayıt için anonimleşme anı revoked_at (ADR-0030 varsayımı) + 30 gün ya da firma silme işi.
CREATE TRIGGER `device_bindings_delete_guard` BEFORE DELETE ON `device_bindings` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(OLD.`revoked_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY
            OR EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: device_bindings DELETE denied (not revoked 30+ days, no running purge)';
    END IF;
END;

-- AC-242: yalnız firma silme işi (gece işi silmez).
CREATE TRIGGER `customers_delete_guard` BEFORE DELETE ON `customers` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: customers DELETE denied (only during running tenant purge)';
    END IF;
END;

-- AC-242: yalnız firma silme işi (gece işi silmez).
CREATE TRIGGER `request_refs_delete_guard` BEFORE DELETE ON `request_refs` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: request_refs DELETE denied (only during running tenant purge)';
    END IF;
END;

-- AC-242: yalnız firma silme işi (gece işi silmez).
CREATE TRIGGER `consent_texts_delete_guard` BEFORE DELETE ON `consent_texts` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: consent_texts DELETE denied (only during running tenant purge)';
    END IF;
END;

-- AC-242: yalnız firma silme işi (gece işi silmez).
CREATE TRIGGER `tenant_request_settings_delete_guard` BEFORE DELETE ON `tenant_request_settings` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_request_settings DELETE denied (only during running tenant purge)';
    END IF;
END;

-- AC-241/242: kullanıcı satırı yalnız firma silmede silinir (tek kullanıcı = mezar taşı UPDATE). Super Admin (tenant_id NULL) hiçbir zaman.
CREATE TRIGGER `users_delete_guard` BEFORE DELETE ON `users` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(OLD.`tenant_id` IS NOT NULL
            AND EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: users DELETE denied (only tenant users during running tenant purge)';
    END IF;
END;

-- AC-242: firma satırı yalnız PASSIVE + 30 gün + RUNNING iş TENANT_ROW adımındayken.
CREATE TRIGGER `tenants_delete_guard` BEFORE DELETE ON `tenants` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(CAST(OLD.`status` AS BINARY) = 'PASSIVE'
            AND OLD.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY
            AND EXISTS (SELECT 1 FROM `tenant_purge_jobs` j WHERE j.`tenant_id` = OLD.`id`
                AND CAST(j.`state` AS BINARY) = 'RUNNING' AND CAST(j.`step` AS BINARY) = 'TENANT_ROW'), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenants DELETE denied (passive 30+ days and running job at TENANT_ROW required)';
    END IF;
END;

-- S16-10: iş satırı (kanıt) yalnız DONE/CANCELLED + 730 gün sonra silinir.
CREATE TRIGGER `tenant_purge_jobs_delete_guard` BEFORE DELETE ON `tenant_purge_jobs` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE(CAST(OLD.`state` AS BINARY) IN ('DONE', 'CANCELLED')
            AND COALESCE(OLD.`finished_at`, OLD.`cancelled_at`) <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 730 DAY, FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs DELETE denied (only DONE/CANCELLED older than 730 days)';
    END IF;
END;

-- S16-3: anonymized_at bir kez yazılır, DB saatine yakın olur; dolu değer değişmez/NULL'lanmaz.
CREATE TRIGGER `support_sessions_update_guard` BEFORE UPDATE ON `support_sessions` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT (NEW.`anonymized_at` <=> OLD.`anonymized_at`) THEN
        IF OLD.`anonymized_at` IS NOT NULL
           OR NOT COALESCE(NEW.`anonymized_at` BETWEEN CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 1 DAY
                                AND CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') + INTERVAL 1 MINUTE, FALSE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: support_sessions.anonymized_at is write-once and must be within [UTC-1d, UTC+1min]';
        END IF;
    END IF;
END;

-- S16-3: anonymized_at bir kez yazılır, DB saatine yakın olur; dolu değer değişmez/NULL'lanmaz.
CREATE TRIGGER `support_requests_update_guard` BEFORE UPDATE ON `support_requests` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT (NEW.`anonymized_at` <=> OLD.`anonymized_at`) THEN
        IF OLD.`anonymized_at` IS NOT NULL
           OR NOT COALESCE(NEW.`anonymized_at` BETWEEN CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 1 DAY
                                AND CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') + INTERVAL 1 MINUTE, FALSE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: support_requests.anonymized_at is write-once and must be within [UTC-1d, UTC+1min]';
        END IF;
    END IF;
END;

-- S16-3: revoked_at aynı kural (bindings/repo.ts yalnız revokedAt IS NULL koşullu yazar).
CREATE TRIGGER `device_bindings_update_guard` BEFORE UPDATE ON `device_bindings` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT (NEW.`revoked_at` <=> OLD.`revoked_at`) THEN
        IF OLD.`revoked_at` IS NOT NULL
           OR NOT COALESCE(NEW.`revoked_at` BETWEEN CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 1 DAY
                                AND CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') + INTERVAL 1 MINUTE, FALSE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: device_bindings.revoked_at is write-once and must be within [UTC-1d, UTC+1min]';
        END IF;
    END IF;
END;

-- ADR-0030 m.4: mezar taşı değişmez (giriş sayaçları DELETED'e çarpmasın diye auth sorguları status <> DELETED süzer, S16-7).
CREATE TRIGGER `users_update_guard` BEFORE UPDATE ON `users` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND CAST(OLD.`status` AS BINARY) = 'DELETED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: users tombstone (DELETED) is immutable';
    END IF;
END;

-- AC-242: passive_at DB saatine zorlanır (uygulama geri tarihleyemez).
CREATE TRIGGER `tenants_insert_guard` BEFORE INSERT ON `tenants` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root') THEN
        SET NEW.`passive_at` = IF(CAST(NEW.`status` AS BINARY) = 'PASSIVE', CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00'), NULL);
    END IF;
END;

-- AC-242, S16-10: passive_at zorlanır (PASSIVE'e geçişte UTC, ACTIVE'de NULL, diğerlerinde eski); açık işte durum değişmez.
CREATE TRIGGER `tenants_update_guard` BEFORE UPDATE ON `tenants` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root') THEN
        IF NOT (CAST(NEW.`status` AS BINARY) <=> CAST(OLD.`status` AS BINARY))
           AND EXISTS (SELECT 1 FROM `tenant_purge_jobs` j WHERE j.`tenant_id` = OLD.`id`
                   AND CAST(j.`state` AS BINARY) IN ('SCHEDULED', 'RUNNING', 'FAILED')) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenants status change denied while a purge job is SCHEDULED/RUNNING/FAILED';
        END IF;
        IF CAST(NEW.`status` AS BINARY) = 'PASSIVE' AND CAST(OLD.`status` AS BINARY) <> 'PASSIVE' THEN
            SET NEW.`passive_at` = CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00');
        ELSEIF CAST(NEW.`status` AS BINARY) = 'ACTIVE' THEN
            SET NEW.`passive_at` = NULL;
        ELSE
            SET NEW.`passive_at` = OLD.`passive_at`;
        END IF;
    END IF;
END;

-- S16-4: iş yalnız SCHEDULED açılır; scheduled_for = DB saati + 24 saat (uygulamanın değeri yok sayılır).
CREATE TRIGGER `tenant_purge_jobs_insert_guard` BEFORE INSERT ON `tenant_purge_jobs` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root') THEN
        IF NOT COALESCE(CAST(NEW.`state` AS BINARY) = 'SCHEDULED' AND CAST(NEW.`step` AS BINARY) = 'FENCE'
                AND NEW.`attempts` = 0 AND NEW.`started_at` IS NULL AND NEW.`heartbeat_at` IS NULL
                AND NEW.`tenant_row_deleted_at` IS NULL AND NEW.`finished_at` IS NULL
                AND NEW.`cancelled_at` IS NULL AND NEW.`cancelled_by` IS NULL, FALSE) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p16: tenant_purge_jobs INSERT must be a fresh SCHEDULED job at step FENCE';
        END IF;
        SET NEW.`scheduled_for` = CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') + INTERVAL 24 HOUR;
    END IF;
END;

-- S16-4/10/15: izinli geçişler (SCHEDULED→RUNNING yalnız scheduled_for dolunca, SCHEDULED→CANCELLED, RUNNING→DONE|FAILED,
-- FAILED→RUNNING yeni preview_hash ile); sabit sütunlar; adım yalnız RUNNING'de birer ilerler; tenant_row_deleted_at yalnız
-- TENANT_ROW adımında, firma satırı yokken ve DB saatiyle bir kez; started_at/finished_at/cancelled_at DB saatine zorlanır.
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

-- 6) `users.delete` sıfırlama (ana oturum kararı, §7.1; db-notlari "P15" AC-237 riski). Anahtar P16'ya kadar hiçbir ucu
--    korumuyordu ama toggle'ı vardı → önceden açılmış USER satırı kalıcı silme yetkisine dönüşürdü. Herkes rol
--    varsayılanına döner (ADMIN açık, USER kapalı). Öncesi/sonrası `granted = 1` sayısı "migration çıktısı" olarak
--    audit_logs'a yazılır (Prisma deploy SELECT sonucunu basmaz; audit ekranında ve dökümde kalıcı iz).
--    username 'migrator', entity 'user_permissions'. down.sql bunu geri GETİRMEZ (bilinçli). Idempotent: tekrar
--    çalışırsa before = 0 yazar.
SET @p16_ud_before = (SELECT COUNT(*) FROM `user_permissions` WHERE CAST(`perm_key` AS BINARY) = 'users.delete' AND `granted` = 1);
SET @p16_ud_rows = (SELECT COUNT(*) FROM `user_permissions` WHERE CAST(`perm_key` AS BINARY) = 'users.delete');
DELETE FROM `user_permissions` WHERE CAST(`perm_key` AS BINARY) = 'users.delete';
SET @p16_ud_after = (SELECT COUNT(*) FROM `user_permissions` WHERE CAST(`perm_key` AS BINARY) = 'users.delete' AND `granted` = 1);
INSERT INTO `audit_logs` (`created_at`, `username`, `action`, `entity`, `entity_id`, `new_value`, `result`)
    VALUES (UTC_TIMESTAMP(3), 'migrator', 'migration.p16_users_delete_reset', 'user_permissions', 'users.delete',
            JSON_OBJECT('migration', '20261118000000_p16_hard_delete', 'grantedBefore', @p16_ud_before,
                        'rowsDeleted', @p16_ud_rows, 'grantedAfter', @p16_ud_after),
            'success');
