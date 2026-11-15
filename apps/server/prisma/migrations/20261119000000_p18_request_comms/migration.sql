-- P18 G6-a talep iletişimi veri modeli (docs/mimari-e11.md §8b.1; ADR-0025 m.1–m.3; AC-255..258). Ayrıntı ve gerekçeler:
-- docs/db-notlari.md "P18". Veri taşıma YOK (yeni sütunlar varsayılanla/NULL başlar: eski talepler NORMAL, SLA'sız, mesai içi).
-- Yeni tablolar `session_messages`, `business_holidays` → prisma/sql/grants.sql (SELECT/INSERT/DELETE; UPDATE yok).
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK, tetikleyici, saklı yordam, SIGNAL ve ALGORITHM yan tümcesi üretmez.
-- Prisma'nın ürettiği kısımlar (sütunlar, iki CREATE TABLE, FK'ler, indeksler) `migrate diff` çıktısıyla aynı ad/tiple
-- yazıldı; support_requests'in indeks + FK'si CHECK'lerle TEK ALTER'da birleştirildi (tek yeniden yazım). Sonrasında
-- `migrate diff --exit-code` = 0 (drift yok).
--
-- Sapmalar (mimari §8b.1'e not düşüldü, db-notlari "P18"):
--  * support_requests indeksi IX(assigned_to, tenant_id, status) — mimarideki IX(tenant_id, assigned_to, status) FK'yi
--    karşılamaz (MySQL FK sütunlarının indeksin İLK sütunları olmasını ister; aksi hâlde gizli ek indeks açar). Eşitlik
--    sorgusu ("Bana atananlar", "atanmamış") iki sırada da aynı aralığı okur.
--  * S-P18-T5 (mimari §8b.13): assigned_to FK'si bileşik (assigned_to, tenant_id) → users(id, tenant_id) (+ UQ users).
--    §8b.13'teki IX(assigned_to, tenant_id) yerine IX(assigned_to, tenant_id, status): aynı önek (FK'yi karşılar) + durum
--    süzgeci aynı indekste.
--  * support_requests_sla_due_chk: mimarideki `(sla_minutes IS NULL) >= (sla_due_at IS NULL)` niyetin tersini yapar
--    (dakika yokken due'ya izin verir). Niyet "dakika NULL ⇒ due NULL" → `<=`.
--
-- Kilit (MySQL 8.4):
--  * Ön kontrol → yalnız okuma.
--  * ADD COLUMN (sonda; NOT NULL DEFAULT sabit / NULL) → INSTANT (3 tablo).
--  * CHECK eklemeleri → COPY: tenant_request_settings, customers (küçük); support_requests (indeks + FK + CHECK tek ALTER,
--    tek yeniden yazım; retention'lı tablo). Migrate, server'dan önce `migrate` servisinde çalışır.
--  * session_messages, business_holidays yeni (boş) tablolar → kilit yok.
--  * tenant_purge_jobs step CHECK DROP+ADD → COPY (küçük). update_guard DROP + CREATE → kısa metadata kilidi; aradaki
--    korumasız an zararsız: ön kontrol RUNNING/FAILED iş olmadığını garanti eder ve server bu sırada çalışmaz.
--  * CREATE TRIGGER ×1 (session_messages) → yeni tablo.
--
-- ÖN KONTROL (P16 kalıbı): DDL transaction'a girmez → hiçbir şey değişmeden durmak için önce sayılır:
--   (a) RUNNING/FAILED firma silme işi → adım listesi değişiyor (MESSAGES, SESSION_CONSENTS ile REQUEST_UNLINK arasına);
--       yarım iş yeni adımı atlayabilir / update_guard'a takılabilir → `P18_PRECHECK purge_jobs_open=<n>`. SCHEDULED iş
--       sorun değildir (FENCE'ten başlar).
--   (b) binlog açık + log_bin_trust_function_creators=0 → tetikleyici 1419 ile yarıda kalırdı → `P18_PRECHECK binlog_flag`.
-- Düzeltme: db-notlari "P18"; sonra `prisma migrate resolve --rolled-back 20261119000000_p18_request_comms` + `pnpm db:migrate`.
-- Yordam SIGNAL sonrası DB'de kalır (zararsız); sonraki deneme ve down.sql siler (P15 kalıbı).
DROP PROCEDURE IF EXISTS `p18_precheck`;
CREATE PROCEDURE `p18_precheck`()
    READS SQL DATA
BEGIN
    DECLARE v_jobs BIGINT;
    DECLARE v_msg VARCHAR(128);
    SELECT COUNT(*) INTO v_jobs FROM `tenant_purge_jobs` WHERE CAST(`state` AS BINARY) IN ('RUNNING', 'FAILED');
    SET v_msg = CONCAT_WS(' ',
        IF(v_jobs > 0, CONCAT('purge_jobs_open=', v_jobs), NULL),
        IF(@@global.log_bin = 1 AND @@global.log_bin_trust_function_creators = 0, 'binlog_flag', NULL));
    IF v_msg <> '' THEN
        SET v_msg = CONCAT('P18_PRECHECK ', v_msg);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END;
CALL `p18_precheck`();
DROP PROCEDURE `p18_precheck`;

-- 1) tenant_request_settings: öncelik/SLA varsayılanı + mesai takvimi (AC-257, 258). PRISMA ÜRETTİ + ALGORITHM ELLE.
ALTER TABLE `tenant_request_settings` ADD COLUMN `after_hours_mode` VARCHAR(20) NOT NULL DEFAULT 'ACCEPT',
    ADD COLUMN `business_hours` JSON NULL,
    ADD COLUMN `default_priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN `default_sla_minutes` SMALLINT UNSIGNED NULL,
    ADD COLUMN `hours_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `time_zone` VARCHAR(40) NOT NULL DEFAULT 'Europe/Istanbul',
    ALGORITHM=INSTANT;
-- ELLE: ikili enum (ADR-0014); saat dilimi biçimi (geçerlilik zod'da Intl.supportedValuesOf); business_hours: JSON şeması
-- (7 gün, Pazartesi=0; gün başına ≤ 2 aralık {from,to}; from 00:00..23:59, to 00:01..24:00 — "24:00" gün sonu, gece
-- yarısını aşan aralık ifade edilemez) + gün içi `from < to` ve iki aralık örtüşmez (sıra serbest; sabit 14 yol, alt sorgu
-- yok). "HH:MM" sözlük sırası = saat sırası. CHECK NULL'da geçer → şema yanlışsa `FALSE AND …` = FALSE (fail-closed).
ALTER TABLE `tenant_request_settings`
    ADD CONSTRAINT `tenant_request_settings_default_priority_chk` CHECK (CAST(`default_priority` AS BINARY) IN ('LOW', 'NORMAL', 'HIGH')),
    ADD CONSTRAINT `tenant_request_settings_default_sla_chk` CHECK (`default_sla_minutes` IS NULL OR `default_sla_minutes` BETWEEN 5 AND 1440),
    ADD CONSTRAINT `tenant_request_settings_time_zone_chk` CHECK (REGEXP_LIKE(`time_zone`, '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}\\z', 'c')),
    ADD CONSTRAINT `tenant_request_settings_after_hours_mode_chk` CHECK (CAST(`after_hours_mode` AS BINARY) IN ('ACCEPT', 'REJECT')),
    ADD CONSTRAINT `tenant_request_settings_hours_enabled_chk` CHECK (`hours_enabled` = 0 OR `business_hours` IS NOT NULL),
    ADD CONSTRAINT `tenant_request_settings_business_hours_chk` CHECK (`business_hours` IS NULL OR (
        JSON_SCHEMA_VALID(
            '{"type":"array","minItems":7,"maxItems":7,"items":{"type":"array","maxItems":2,"items":{"type":"object","additionalProperties":false,"required":["from","to"],"properties":{"from":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"to":{"type":"string","pattern":"^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"}}}}}',
            `business_hours`)
            AND (JSON_LENGTH(`business_hours`, '$[0]') < 1 OR `business_hours`->>'$[0][0].from' < `business_hours`->>'$[0][0].to')
            AND (JSON_LENGTH(`business_hours`, '$[0]') < 2 OR (`business_hours`->>'$[0][1].from' < `business_hours`->>'$[0][1].to' AND (`business_hours`->>'$[0][0].to' <= `business_hours`->>'$[0][1].from' OR `business_hours`->>'$[0][1].to' <= `business_hours`->>'$[0][0].from')))
            AND (JSON_LENGTH(`business_hours`, '$[1]') < 1 OR `business_hours`->>'$[1][0].from' < `business_hours`->>'$[1][0].to')
            AND (JSON_LENGTH(`business_hours`, '$[1]') < 2 OR (`business_hours`->>'$[1][1].from' < `business_hours`->>'$[1][1].to' AND (`business_hours`->>'$[1][0].to' <= `business_hours`->>'$[1][1].from' OR `business_hours`->>'$[1][1].to' <= `business_hours`->>'$[1][0].from')))
            AND (JSON_LENGTH(`business_hours`, '$[2]') < 1 OR `business_hours`->>'$[2][0].from' < `business_hours`->>'$[2][0].to')
            AND (JSON_LENGTH(`business_hours`, '$[2]') < 2 OR (`business_hours`->>'$[2][1].from' < `business_hours`->>'$[2][1].to' AND (`business_hours`->>'$[2][0].to' <= `business_hours`->>'$[2][1].from' OR `business_hours`->>'$[2][1].to' <= `business_hours`->>'$[2][0].from')))
            AND (JSON_LENGTH(`business_hours`, '$[3]') < 1 OR `business_hours`->>'$[3][0].from' < `business_hours`->>'$[3][0].to')
            AND (JSON_LENGTH(`business_hours`, '$[3]') < 2 OR (`business_hours`->>'$[3][1].from' < `business_hours`->>'$[3][1].to' AND (`business_hours`->>'$[3][0].to' <= `business_hours`->>'$[3][1].from' OR `business_hours`->>'$[3][1].to' <= `business_hours`->>'$[3][0].from')))
            AND (JSON_LENGTH(`business_hours`, '$[4]') < 1 OR `business_hours`->>'$[4][0].from' < `business_hours`->>'$[4][0].to')
            AND (JSON_LENGTH(`business_hours`, '$[4]') < 2 OR (`business_hours`->>'$[4][1].from' < `business_hours`->>'$[4][1].to' AND (`business_hours`->>'$[4][0].to' <= `business_hours`->>'$[4][1].from' OR `business_hours`->>'$[4][1].to' <= `business_hours`->>'$[4][0].from')))
            AND (JSON_LENGTH(`business_hours`, '$[5]') < 1 OR `business_hours`->>'$[5][0].from' < `business_hours`->>'$[5][0].to')
            AND (JSON_LENGTH(`business_hours`, '$[5]') < 2 OR (`business_hours`->>'$[5][1].from' < `business_hours`->>'$[5][1].to' AND (`business_hours`->>'$[5][0].to' <= `business_hours`->>'$[5][1].from' OR `business_hours`->>'$[5][1].to' <= `business_hours`->>'$[5][0].from')))
            AND (JSON_LENGTH(`business_hours`, '$[6]') < 1 OR `business_hours`->>'$[6][0].from' < `business_hours`->>'$[6][0].to')
            AND (JSON_LENGTH(`business_hours`, '$[6]') < 2 OR (`business_hours`->>'$[6][1].from' < `business_hours`->>'$[6][1].to' AND (`business_hours`->>'$[6][0].to' <= `business_hours`->>'$[6][1].from' OR `business_hours`->>'$[6][1].to' <= `business_hours`->>'$[6][0].from')))
        ));

-- 2) customers: müşteri bazlı öncelik/SLA (AC-257; NULL = firma varsayılanı). PRISMA ÜRETTİ + ALGORITHM ELLE.
ALTER TABLE `customers` ADD COLUMN `default_priority` VARCHAR(20) NULL,
    ADD COLUMN `sla_minutes` SMALLINT UNSIGNED NULL,
    ALGORITHM=INSTANT;
ALTER TABLE `customers`
    ADD CONSTRAINT `customers_default_priority_chk` CHECK (`default_priority` IS NULL OR CAST(`default_priority` AS BINARY) IN ('LOW', 'NORMAL', 'HIGH')),
    ADD CONSTRAINT `customers_sla_minutes_chk` CHECK (`sla_minutes` IS NULL OR `sla_minutes` BETWEEN 5 AND 1440);

-- 3) support_requests: öncelik, atama, dondurulmuş SLA, mesai dışı işareti (AC-256, 257, 258). PRISMA ÜRETTİ + ALGORITHM
--    ELLE. Eski satırlar: NORMAL, atanmamış, SLA NULL, after_hours 0 (mimari §8b.1).
ALTER TABLE `support_requests` ADD COLUMN `after_hours` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `assigned_at` DATETIME(3) NULL,
    ADD COLUMN `assigned_to` CHAR(26) NULL,
    ADD COLUMN `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN `sla_due_at` DATETIME(3) NULL,
    ADD COLUMN `sla_minutes` SMALLINT UNSIGNED NULL,
    ALGORITHM=INSTANT;
-- S-P18-T5 (güvenlik tasarım turu): atanan kullanıcı DB düzeyinde AYNI tenant'ta — bileşik FK (assigned_to, tenant_id) →
-- users(id, tenant_id). Hedef UQ users(id, tenant_id) (PRISMA ÜRETTİ; INPLACE, eşzamanlı DML'e izin verir; id zaten PK →
-- ihlal olamaz). Super Admin (tenant_id NULL) atanamaz: talep tenant_id NOT NULL, eşleşen users satırı yok → 1452.
-- assigned_to NULL iken FK denetlenmez (MATCH SIMPLE).
CREATE UNIQUE INDEX `users_id_tenant_id_key` ON `users`(`id`, `tenant_id`);
-- PRISMA ÜRETTİ (indeks + FK; ad aynı) + ELLE CHECK'ler, tek ALTER (COPY bir kez). sla_due_chk: dakika NULL ⇒ due NULL
-- (dakika varken takvimde açık an yoksa due NULL olabilir); due oluşturmadan sonradır.
ALTER TABLE `support_requests`
    ADD INDEX `support_requests_assigned_to_tenant_id_status_idx`(`assigned_to`, `tenant_id`, `status`),
    ADD CONSTRAINT `support_requests_assigned_to_tenant_id_fkey` FOREIGN KEY (`assigned_to`, `tenant_id`) REFERENCES `users`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT `support_requests_priority_chk` CHECK (CAST(`priority` AS BINARY) IN ('LOW', 'NORMAL', 'HIGH')),
    ADD CONSTRAINT `support_requests_assigned_chk` CHECK ((`assigned_to` IS NULL) = (`assigned_at` IS NULL)),
    ADD CONSTRAINT `support_requests_sla_minutes_chk` CHECK (`sla_minutes` IS NULL OR `sla_minutes` BETWEEN 5 AND 1440),
    ADD CONSTRAINT `support_requests_sla_due_chk` CHECK ((`sla_minutes` IS NULL) <= (`sla_due_at` IS NULL)
        AND (`sla_due_at` IS NULL OR `sla_due_at` > `created_at`));

-- 4) session_messages (AC-255; ADR-0025). PRISMA ÜRETTİ (CREATE + FK + indeksler). Append-only: updated_at yok.
CREATE TABLE `session_messages` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `request_id` CHAR(26) NULL,
    `session_id` CHAR(26) NULL,
    `sender` VARCHAR(20) NOT NULL,
    `sender_user_id` CHAR(26) NULL,
    `client_msg_id` VARCHAR(36) NULL,
    `body_enc` VARBINARY(4200) NOT NULL,
    `body_chars` SMALLINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_messages_request_id_tenant_id_created_at_idx`(`request_id`, `tenant_id`, `created_at`),
    INDEX `session_messages_session_id_tenant_id_created_at_idx`(`session_id`, `tenant_id`, `created_at`),
    INDEX `session_messages_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `session_messages_sender_user_id_idx`(`sender_user_id`),
    UNIQUE INDEX `session_messages_request_id_sender_client_msg_id_key`(`request_id`, `sender`, `client_msg_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `session_messages` ADD CONSTRAINT `session_messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `session_messages` ADD CONSTRAINT `session_messages_request_id_tenant_id_fkey` FOREIGN KEY (`request_id`, `tenant_id`) REFERENCES `support_requests`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `session_messages` ADD CONSTRAINT `session_messages_session_id_tenant_id_fkey` FOREIGN KEY (`session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `session_messages` ADD CONSTRAINT `session_messages_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE: CHECK'ler. Gövde biçimi lib/crypto.ts: ver(1) | iv(12) | tag(16) | UTF-8 şifreli metin (GCM: şifreli metin = düz
-- metin uzunluğu) → LENGTH(body_enc) ∈ [29 + body_chars, 29 + 4 × body_chars] (kod noktası 1..4 bayt). Düz metin DB'ye
-- yanlışlıkla yazılsa da uzunluk kuralı çoğunu yakalar; asıl güvence uygulamadaki tek yazım yolu.
ALTER TABLE `session_messages`
    ADD CONSTRAINT `session_messages_sender_chk` CHECK (CAST(`sender` AS BINARY) IN ('TECH', 'CUSTOMER')),
    ADD CONSTRAINT `session_messages_sender_user_chk` CHECK ((CAST(`sender` AS BINARY) = 'TECH') = (`sender_user_id` IS NOT NULL)),
    ADD CONSTRAINT `session_messages_parent_chk` CHECK (`request_id` IS NOT NULL OR `session_id` IS NOT NULL),
    ADD CONSTRAINT `session_messages_client_msg_id_fmt_chk` CHECK (`client_msg_id` IS NULL
        OR REGEXP_LIKE(`client_msg_id`, '^[A-Za-z0-9_-]{1,36}\\z', 'c')),
    ADD CONSTRAINT `session_messages_body_chars_chk` CHECK (`body_chars` BETWEEN 1 AND 1000),
    ADD CONSTRAINT `session_messages_body_enc_chk` CHECK (LENGTH(`body_enc`) BETWEEN 29 + `body_chars` AND 29 + 4 * `body_chars`);

-- 5) business_holidays (AC-258). PRISMA ÜRETTİ (CREATE + FK + indeksler). UPDATE yok → updated_at yok.
CREATE TABLE `business_holidays` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `day` DATE NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `open_until` TIME(0) NULL,
    `created_by` CHAR(26) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `business_holidays_created_by_idx`(`created_by`),
    UNIQUE INDEX `business_holidays_tenant_id_day_key`(`tenant_id`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `business_holidays` ADD CONSTRAINT `business_holidays_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `business_holidays` ADD CONSTRAINT `business_holidays_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE: ad metin kuralı (request_blocks_note_chk kalıbı: 1..100, kırpılmış, Cc/Cf/Zl/Zp yok); open_until gün içinde
-- (00:00 < t < 24:00) ve saniyesiz ("HH:MM").
ALTER TABLE `business_holidays`
    ADD CONSTRAINT `business_holidays_name_chk` CHECK (CHAR_LENGTH(`name`) BETWEEN 1 AND 100
        AND CHAR_LENGTH(`name`) = CHAR_LENGTH(TRIM(`name`))
        AND NOT REGEXP_LIKE(`name`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')),
    ADD CONSTRAINT `business_holidays_open_until_chk` CHECK (`open_until` IS NULL
        OR (`open_until` > '00:00:00' AND `open_until` < '24:00:00' AND SECOND(`open_until`) = 0));

-- 6) TETİKLEYİCİ (ADR-0025 m.3; toplam 23 = audit 3 + P16 19 + bu). P16 ortak gövdesi: bileşik gövde, migrator/root muaf
--    (USER()), saat UTC_SYSDATE, COALESCE fail-closed, PURGING satır içi (RUNNING iş + PASSIVE + passive_at ≤ UTC − 30 g).
--    İzin (S-P18-T11, mimari §8b.13): DOLU HER üst bağ anonim (talep VE oturum; P22'de iki bağlı satır, yalnız biri
--    anonimken silinemez) — retention anonimleştirme ile AYNI TX'te siler, tetikleyici aynı TX'in UPDATE'ini görür — ya da
--    firma silme. session_messages_parent_chk en az bir bağı garanti eder (bağsız satır yok → "boş VE" izin açmaz). Böylece mesaj yalnız retention ya da firma silme ile silinir. MESSAGE_TEXT
--    `p18:` önekli (lib/db.ts isP16Signal `p16:`/`p18:` önekini db_signal sayar).
--    Tetikleyici değişirse: deploy/mysql/audit-continuity.sql sabiti, check-app-grants.sh (sayı), backup.sh/restore.sh
--    beklenen sayı (23) birlikte güncellenir (S16-11).
CREATE TRIGGER `session_messages_delete_guard` BEFORE DELETE ON `session_messages` FOR EACH ROW
BEGIN
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT COALESCE((OLD.`request_id` IS NULL
                OR EXISTS (SELECT 1 FROM `support_requests` r WHERE r.`id` = OLD.`request_id` AND r.`anonymized_at` IS NOT NULL))
            AND (OLD.`session_id` IS NULL
                OR EXISTS (SELECT 1 FROM `support_sessions` s WHERE s.`id` = OLD.`session_id` AND s.`anonymized_at` IS NOT NULL))
            OR EXISTS (SELECT 1 FROM `tenant_purge_jobs` j JOIN `tenants` x ON x.`id` = j.`tenant_id`
                WHERE j.`tenant_id` = OLD.`tenant_id` AND CAST(j.`state` AS BINARY) = 'RUNNING'
                  AND CAST(x.`status` AS BINARY) = 'PASSIVE'
                  AND x.`passive_at` <= CONVERT_TZ(SYSDATE(3), @@session.time_zone, '+00:00') - INTERVAL 30 DAY), FALSE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p18: session_messages DELETE denied (a parent is not anonymized, no running purge)';
    END IF;
END;

-- 7) Firma silme adımı MESSAGES (mimari §8b.1): SESSION_CONSENTS ile REQUEST_UNLINK arasına (mesajlar oturum/talep
--    satırlarından önce silinmeli). business_holidays mevcut SETTINGS adımına parça olarak eklenir (uygulama; DB değişmez).
--    step CHECK DROP/ADD (18 adım) + update_guard DROP/CREATE (gövde P16 ile aynı, üç FIELD() listesi yeni sırayla;
--    tetikleyici sayısı değişmez). İki ifade arası korumasız an: ön kontrol açık iş olmadığını garanti eder.
ALTER TABLE `tenant_purge_jobs`
    DROP CHECK `tenant_purge_jobs_step_chk`,
    ADD CONSTRAINT `tenant_purge_jobs_step_chk` CHECK (CAST(`step` AS BINARY) IN ('FENCE', 'SESSION_FILES', 'SESSION_CONSENTS',
        'MESSAGES', 'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS', 'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS',
        'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS', 'TENANT_ROW', 'FILES', 'DONE'));

DROP TRIGGER `tenant_purge_jobs_update_guard`;
-- P16 metni (S16-4/10/15) aynen; yalnız adım listesi += MESSAGES.
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
                    AND FIELD(CAST(OLD.`step` AS BINARY), 'FENCE', 'SESSION_FILES', 'SESSION_CONSENTS', 'MESSAGES', 'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS',
                  'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS', 'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS',
                  'TENANT_ROW', 'FILES', 'DONE') > 0
                    AND FIELD(CAST(NEW.`step` AS BINARY), 'FENCE', 'SESSION_FILES', 'SESSION_CONSENTS', 'MESSAGES', 'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS',
                  'REQUEST_BLOCKS', 'REQUEST_REFS', 'CUSTOMERS', 'SETTINGS', 'CONSENT_TEXTS', 'USER_CHILDREN', 'USERS',
                  'TENANT_ROW', 'FILES', 'DONE')
                        = FIELD(CAST(OLD.`step` AS BINARY), 'FENCE', 'SESSION_FILES', 'SESSION_CONSENTS', 'MESSAGES', 'REQUEST_UNLINK', 'BINDINGS', 'SESSIONS', 'REQUESTS',
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
