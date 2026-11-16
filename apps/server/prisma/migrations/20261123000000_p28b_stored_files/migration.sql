-- P28b-K1 sunucuda dosya saklama + ClamAV + depolama kotası veri modeli (docs/mimari-p28b.md r2 §3.1–3.4, §13 K1, §r2;
-- ADR-0032; AC-354, 355, 356, 358, 360, 362). Ayrıntı ve gerekçeler: docs/db-notlari.md "P28b". Veri taşıma YOK: yeni tablo
-- boş; mevcut oturumlar file_mode = 'P2P', firmalar file_server_mode = FALSE / saklama 1 gün / kota 20 GB alır (varsayılan).
-- Yeni tablo → prisma/sql/grants.sql. Tetikleyici sayısı DEĞİŞMEZ (23): yalnız support_sessions_update_guard gövdesi genişler
-- (aşağıda 5) → deploy/mysql/audit-continuity.sql özet sabiti aynı commit'te güncellendi.
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK, ALGORITHM ve tetikleyici üretmez. Prisma'nın ürettiği kısımlar (sütunlar,
-- CREATE TABLE, indeksler, FK) `migrate diff` çıktısıyla aynı ad/tipte; yeni tablonun CHECK'leri CREATE'e gömüldü, mevcut
-- tablolarda sütun + CHECK tablo başına TEK ALTER'da (tek yeniden yazım). Sonrasında `migrate diff --exit-code` = 0.
--
-- Sapmalar / daraltmalar (db-notlari "P28b"):
--  * İndeks IX(session_id, tenant_id, created_at) (mimari IX(session_id, created_at)): bileşik session FK'nin öneki olmalı,
--    yoksa MySQL gizli ek indeks açar; oturum detayı / tavan SUM / anonimleştirme aynı indeksi kullanır.
--  * file_mode değişmezliği: app'in support_sessions'ta tablo düzeyi UPDATE'i var (P2) → sütun düzeyinde geri alınamaz.
--    Mimari §3.4 "UPDATE grant'ı verilmez" niyeti mevcut support_sessions_update_guard tetikleyicisine bir dal eklenerek
--    karşılandı (yeni tetikleyici yok; migrator/root muaf — P16 kalıbı).
--  * Mimariye ek CHECK'ler: durum ↔ alan tutarlılığı (storage_rel yalnız UPLOADING/SCANNING/CLEAN; scan_reason ⇔ SCAN_FAILED;
--    imza yalnız INFECTED; CLEAN taranmadan olmaz; teslim edilmiş FILE+CLEAN'in expires_at'i dolu ve ≤ teslim + 7 g + 1 dk);
--    PRINT ⇒ ad 'belge.pdf' + ≤ 20 MiB (D-P28b-3); uploaded_by yalnız TO_CUSTOMER; key_ver ≥ 1.
--
-- Kilit (MySQL 8.4):
--  * session_stored_files yeni (boş) → kilit yok.
--  * support_sessions: ADD COLUMN + ADD CHECK → TEK COPY ALTER (tablo yeniden yazılır; süresince oturum yazımı bekler).
--    Bakım penceresi + `SELECT COUNT(*) FROM support_sessions` ile süre tahmini — db-notlari "P28b".
--  * tenant_settings, tenants, system_settings: küçük; CHECK → COPY (tablo başına tek ALTER).
--  * Tetikleyici DROP + CREATE: support_sessions'ta kısa metadata kilidi; arada guard'sız an saniyenin altı (P18 kalıbı).
-- Ön kontrol gerekmez: yeni sütunlar varsayılanla CHECK'leri geçer; key CHECK genişler.
-- Geri alma: down.sql (elle; Prisma çalıştırmaz).

-- 1) session_stored_files (§3.1). PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `session_stored_files` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `session_id` CHAR(26) NOT NULL,
    `direction` VARCHAR(12) NOT NULL,
    `purpose` VARCHAR(8) NOT NULL,
    `uploaded_by_user_id` CHAR(26) NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `ext` VARCHAR(16) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `storage_rel` VARCHAR(80) NULL,
    `key_ver` TINYINT UNSIGNED NOT NULL,
    `state` VARCHAR(12) NOT NULL,
    `scan_reason` VARCHAR(16) NULL,
    `signature` VARCHAR(120) NULL,
    `delivered_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `scanned_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `session_stored_files_tenant_id_state_idx`(`tenant_id`, `state`),
    INDEX `session_stored_files_session_id_tenant_id_created_at_idx`(`session_id`, `tenant_id`, `created_at`),
    INDEX `session_stored_files_state_expires_at_idx`(`state`, `expires_at`),
    PRIMARY KEY (`id`),
    -- ELLE: ikili enum'lar (ADR-0014).
    CONSTRAINT `session_stored_files_direction_chk` CHECK (CAST(`direction` AS BINARY) IN ('TO_CUSTOMER', 'TO_TECH')),
    CONSTRAINT `session_stored_files_purpose_chk` CHECK (CAST(`purpose` AS BINARY) IN ('FILE', 'PRINT')),
    CONSTRAINT `session_stored_files_state_chk` CHECK (CAST(`state` AS BINARY) IN ('UPLOADING', 'SCANNING', 'CLEAN', 'INFECTED',
        'SCAN_FAILED', 'CORRUPT', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DELETED')),
    -- ELLE: neden yalnız ve her zaman SCAN_FAILED'de.
    CONSTRAINT `session_stored_files_scan_reason_chk` CHECK ((CAST(`state` AS BINARY) = 'SCAN_FAILED') = (`scan_reason` IS NOT NULL)
        AND (`scan_reason` IS NULL
            OR CAST(`scan_reason` AS BINARY) IN ('UNAVAILABLE', 'TIMEOUT', 'ENCRYPTED', 'LIMIT', 'BUSY', 'ERROR'))),
    -- ELLE: imza yalnız INFECTED'de, §7.2 biçimi (dışındaysa backend "bilinmeyen imza" yazar).
    CONSTRAINT `session_stored_files_signature_chk` CHECK (`signature` IS NULL
        OR (CAST(`state` AS BINARY) = 'INFECTED' AND REGEXP_LIKE(`signature`, '^[A-Za-z0-9._:/-]{1,120}\\z', 'c'))),
    -- ELLE: P5 session_files_file_name_chk kalıbı (sanitizeFileName çıktısı) + Zl/Zp; PRINT'te sabit ad (K-P28b-13).
    CONSTRAINT `session_stored_files_file_name_chk` CHECK (CHAR_LENGTH(`file_name`) BETWEEN 1 AND 255
        AND NOT REGEXP_LIKE(`file_name`, '[\\\\/:*?"<>|\\x{00}-\\x{1F}\\x{7F}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')
        AND NOT REGEXP_LIKE(`file_name`, '[. ]\\z', 'c')
        AND (CAST(`purpose` AS BINARY) <> 'PRINT' OR CAST(`file_name` AS BINARY) = 'belge.pdf')),
    CONSTRAINT `session_stored_files_ext_chk` CHECK (REGEXP_LIKE(`ext`, '^[a-z0-9]{0,16}\\z', 'c')),
    -- ELLE: 1..256 MiB (K-P28b-12 r2); PRINT ≤ 20 MiB (FSRV_PRINT_MAX_BYTES, D-P28b-3).
    CONSTRAINT `session_stored_files_size_chk` CHECK (`size_bytes` BETWEEN 1 AND 268435456
        AND (CAST(`purpose` AS BINARY) <> 'PRINT' OR `size_bytes` <= 20971520)),
    CONSTRAINT `session_stored_files_sha256_chk` CHECK (REGEXP_LIKE(`sha256`, '^[0-9a-f]{64}\\z', 'c')),
    -- ELLE: `{tenant_id}/{rastgele24}.rsf` (P12 kalıbı: öndek = satırın tenant'ı); disk dosyası yalnız bu üç durumda (§3.2).
    CONSTRAINT `session_stored_files_storage_rel_chk` CHECK (`storage_rel` IS NULL OR (
        REGEXP_LIKE(`storage_rel`, '^[0-9A-Z]{26}/[A-Za-z0-9_-]{24}[.]rsf\\z', 'c')
        AND CAST(SUBSTRING_INDEX(`storage_rel`, '/', 1) AS BINARY) = CAST(`tenant_id` AS BINARY)
        AND CAST(`state` AS BINARY) IN ('UPLOADING', 'SCANNING', 'CLEAN')
        AND `deleted_at` IS NULL)),
    CONSTRAINT `session_stored_files_key_ver_chk` CHECK (`key_ver` >= 1),
    -- ELLE: teknisyen yüklemesi TO_CUSTOMER; müşteri yüklemesinde NULL. 26 karakterlik kimlik biçimi (FK değil; tenants_logo_path_chk kalıbı).
    CONSTRAINT `session_stored_files_uploaded_by_chk` CHECK (`uploaded_by_user_id` IS NULL
        OR (CAST(`direction` AS BINARY) = 'TO_CUSTOMER' AND REGEXP_LIKE(`uploaded_by_user_id`, '^[0-9A-Z]{26}\\z', 'c'))),
    -- ELLE: CLEAN ve ondan türeyen durumlar taranmadan oluşamaz (fail-closed savunma derinliği).
    CONSTRAINT `session_stored_files_scanned_chk` CHECK (`scanned_at` IS NOT NULL
        OR CAST(`state` AS BINARY) NOT IN ('CLEAN', 'INFECTED', 'REJECTED', 'EXPIRED', 'DELETED')),
    -- ELLE: teslim yalnız CLEAN (ve sonrası EXPIRED/DELETED) satırda.
    CONSTRAINT `session_stored_files_delivered_chk` CHECK (`delivered_at` IS NULL
        OR (CAST(`state` AS BINARY) IN ('CLEAN', 'EXPIRED', 'DELETED') AND `delivered_at` >= `created_at`)),
    -- ELLE: saklama süresi teslimden en çok 7 g (+1 dk saat farkı); teslim edilmiş saklanan dosyanın süresi dolu (aksi
    -- hâlde 03:30 işi onu hiç silmezdi — AC-360).
    CONSTRAINT `session_stored_files_expires_chk` CHECK ((`expires_at` IS NULL
            OR (`delivered_at` IS NOT NULL AND `expires_at` > `delivered_at`
                AND `expires_at` <= `delivered_at` + INTERVAL 7 DAY + INTERVAL 1 MINUTE))
        AND (`expires_at` IS NOT NULL OR `delivered_at` IS NULL OR CAST(`purpose` AS BINARY) <> 'FILE'
            OR CAST(`state` AS BINARY) <> 'CLEAN'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (PRISMA ÜRETTİ) — yeni tablo (boş; kilit yok).
ALTER TABLE `session_stored_files` ADD CONSTRAINT `session_stored_files_session_id_tenant_id_fkey` FOREIGN KEY (`session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 2) support_sessions.file_mode (§3.1, K-P28b-3). PRISMA ÜRETTİ (sütun) + CHECK ELLE — TEK COPY ALTER.
ALTER TABLE `support_sessions`
    ADD COLUMN `file_mode` VARCHAR(10) NOT NULL DEFAULT 'P2P',
    ADD CONSTRAINT `support_sessions_file_mode_chk` CHECK (CAST(`file_mode` AS BINARY) IN ('P2P', 'SERVER')),
    ALGORITHM=COPY;

-- 3) tenant_settings dosya modu + saklama (AC-354). PRISMA ÜRETTİ + CHECK ELLE — tek ALTER.
ALTER TABLE `tenant_settings`
    ADD COLUMN `file_retention_days` TINYINT NOT NULL DEFAULT 1,
    ADD COLUMN `file_server_mode` BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT `tenant_settings_file_retention_chk` CHECK (`file_retention_days` BETWEEN 1 AND 7);

-- 4) tenants.storage_quota_gb (AC-362, K-P28b-10). PRISMA ÜRETTİ + CHECK ELLE — tek ALTER.
ALTER TABLE `tenants`
    ADD COLUMN `storage_quota_gb` SMALLINT NOT NULL DEFAULT 20,
    ADD CONSTRAINT `tenants_storage_quota_chk` CHECK (`storage_quota_gb` BETWEEN 1 AND 2000);

-- 5) system_settings anahtar `clamav` (§3.1, §4, §7.3). ELLE — P11/P12/WhatsApp kalıbı. value_json =
--    {host, port, lastTest: null | {ok, at, version?, dbDate?, message?}}; secret_enc NULL (gizli değer yok).
--    host: hostname | IPv4 | IPv6 (köşeli parantezsiz), ≤ 253; hedef CIDR kuralı (K-P28b-16) uygulamada.
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_key_chk`,
    ADD CONSTRAINT `system_settings_key_chk` CHECK (CAST(`key` AS BINARY) IN ('mysql', 'turn', 'system_logo', 'whatsapp', 'clamav')),
    ADD CONSTRAINT `system_settings_clamav_chk` CHECK (CAST(`key` AS BINARY) <> 'clamav' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["host","port","lastTest"],"properties":{"host":{"type":"string","minLength":1,"maxLength":253},"port":{"type":"integer","minimum":1,"maximum":65535},"lastTest":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,"required":["ok","at"],"properties":{"ok":{"type":"boolean"},"at":{"type":"string","maxLength":40},"version":{"type":["string","null"],"maxLength":200},"dbDate":{"type":["string","null"],"maxLength":40},"message":{"type":["string","null"],"maxLength":200}}}]}}}',
            `value_json`)
        AND REGEXP_LIKE(`value_json` ->> '$.host', '^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}\\z', 'c')));

-- 6) file_mode değişmezliği (§3.4 niyeti; AC-355). ELLE — mevcut tetikleyiciye dal (yeni tetikleyici YOK, sayı 23).
--    P16 metni (S16-3) aynen; ek: migrator/root dışında file_mode UPDATE'le değiştirilemez.
DROP TRIGGER `support_sessions_update_guard`;
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
    IF CAST(SUBSTRING_INDEX(USER(), '@', 1) AS BINARY) NOT IN ('migrator', 'root')
       AND NOT (CAST(NEW.`file_mode` AS BINARY) <=> CAST(OLD.`file_mode` AS BINARY)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p28b: support_sessions.file_mode is fixed at insert';
    END IF;
END;
