-- GERİ ALMA (elle, dba) — 20261123000000_p28b_stored_files. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce: tüm firmalarda
-- file_server_mode kapatılır (yeni oturumlar P2P), P28b sunucu kodu ve prisma/sql/grants.sql P28b öncesine döner,
-- deploy/mysql/audit-continuity.sql özet sabiti eski değerine (f029d544…3c90) döner.
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261123000000_p28b_stored_files/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur): p28b_down_guard_chk — saklanan dosya satırı, SERVER modlu oturum, clamav
-- ayarı ya da dosya modu açık firma var. Disk dosyaları (FILES_DIR) DB'den bağımsızdır: satırlar elle silinmeden önce
-- volume `stored_files` boşaltılır (runbook §28b).
-- Kalıcı kayıp (guard'sız): saklama günü ve kota (varsayılandan farklı değerler) — geri uygulamada 1 gün / 20 GB'a döner.
-- Kilit: support_sessions DROP COLUMN + DROP CHECK COPY (tek ALTER).
CREATE TEMPORARY TABLE `p28b_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p28b_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p28b_down_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `session_stored_files`)
    + (SELECT COUNT(*) FROM `support_sessions` WHERE CAST(`file_mode` AS BINARY) <> 'P2P')
    + (SELECT COUNT(*) FROM `system_settings` WHERE CAST(`key` AS BINARY) = 'clamav')
    + (SELECT COUNT(*) FROM `tenant_settings` WHERE `file_server_mode` <> 0);
DROP TEMPORARY TABLE `p28b_down_guard`;

-- Yetkiler (grants.sql). DROP TABLE tables_priv/columns_priv satırını SİLMEZ → önce REVOKE.
REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON `session_stored_files` FROM 'app'@'%';

-- Tetikleyici: P16 gövdesi (file_mode dalı yok).
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
END;

DROP TABLE `session_stored_files`;

ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_file_mode_chk`,
    DROP COLUMN `file_mode`,
    ALGORITHM=COPY;
ALTER TABLE `tenant_settings`
    DROP CHECK `tenant_settings_file_retention_chk`,
    DROP COLUMN `file_retention_days`,
    DROP COLUMN `file_server_mode`;
ALTER TABLE `tenants`
    DROP CHECK `tenants_storage_quota_chk`,
    DROP COLUMN `storage_quota_gb`;
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_clamav_chk`,
    DROP CHECK `system_settings_key_chk`,
    ADD CONSTRAINT `system_settings_key_chk` CHECK (CAST(`key` AS BINARY) IN ('mysql', 'turn', 'system_logo', 'whatsapp'));

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261123000000_p28b_stored_files';
