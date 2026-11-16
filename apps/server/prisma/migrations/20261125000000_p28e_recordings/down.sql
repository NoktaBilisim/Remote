-- GERİ ALMA (elle, dba) — 20261125000000_p28e_recordings. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce: tüm firmalarda kayıt ve gözetimsiz
-- kayıt kapatılır (ayar ekranı), açık kayıtların durması beklenir, P28e sunucu kodu ve prisma/sql/grants.sql P28e öncesine döner
-- (mimari-p28e §11.4: asıl geri alma önceki imajdır, tablolar kalabilir — expand). Sonra precheck.sql (KORUMA satırları 0 olmalı).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261125000000_p28e_recordings/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur): p28e_down_guard_chk — kayıt satırı (her durum), RECORDING rıza satırı ya da kayıt /
-- gözetimsiz kayıt anahtarı açık firma var. Rıza satırları KVKK delilidir; silinmez/düzenlenmez → bu durumda şema geri alınmaz, ileri
-- düzeltme yapılır (mimara). Disk dosyaları (FILES_DIR) DB'den bağımsızdır: kayıt satırı yokken yetim `.rsf` mutabakatta silinir.
-- Kalıcı kayıp (guard'sız, bilinçli): saklama günü (varsayılandan farklı değer) ve gözetimsiz kayıt aydınlatma izi (ack_at/_by; kapalı
-- politikada iz). Kopyası audit_logs'ta (settings / recording_policy) 730 gün kalır.
-- Kilit: session_consents tek COPY ALTER; tenant_settings küçük; yeni tablolar DROP (boş — guard).
CREATE TEMPORARY TABLE `p28e_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p28e_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p28e_down_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `session_recordings`)
    + (SELECT COUNT(*) FROM `session_recording_parts`)
    + (SELECT COUNT(*) FROM `session_consents` WHERE CAST(`level` AS BINARY) = 'RECORDING' OR `line_sha256` IS NOT NULL)
    + (SELECT COUNT(*) FROM `tenant_settings` WHERE `recording_enabled` <> 0 OR `unattended_recording_enabled` <> 0);
DROP TEMPORARY TABLE `p28e_down_guard`;

-- Yetkiler (grants.sql). DROP TABLE tables_priv/columns_priv satırını SİLMEZ → önce REVOKE (sütun yetkileri dahil).
REVOKE IF EXISTS SELECT, INSERT, DELETE ON `session_recording_parts` FROM 'app'@'%';
REVOKE IF EXISTS SELECT, INSERT, DELETE ON `session_recordings` FROM 'app'@'%';
REVOKE IF EXISTS UPDATE (`state`, `stop_reason`, `delete_reason`, `recorder_user_id`, `stopped_at`, `duration_ms`, `size_bytes`,
    `part_count`, `deleted_at`, `updated_at`) ON `session_recordings` FROM 'app'@'%';

DROP TABLE `session_recording_parts`;
DROP TABLE `session_recordings`;

-- session_consents: P28u sonrası hâl (P4/P11 level ve text_scope tanımları birebir).
ALTER TABLE `session_consents`
    DROP CHECK `session_consents_recording_decision_chk`,
    DROP CHECK `session_consents_line_chk`,
    DROP CHECK `session_consents_text_scope_chk`,
    DROP CHECK `session_consents_level_chk`,
    ADD CONSTRAINT `session_consents_level_chk` CHECK (CAST(`level` AS BINARY) IN ('VIEW', 'CONTROL')),
    ADD CONSTRAINT `session_consents_text_scope_chk` CHECK (`consent_text_id` IS NULL OR (`level` = 'VIEW' AND `decision` = 'GRANTED')),
    DROP COLUMN `line_sha256`,
    ALGORITHM=COPY;

ALTER TABLE `tenant_settings`
    DROP FOREIGN KEY `tenant_settings_unattended_recording_ack_by_fkey`,
    DROP CHECK `tenant_settings_unattended_rec_ack_chk`,
    DROP CHECK `tenant_settings_unattended_rec_chk`,
    DROP CHECK `tenant_settings_recording_retention_chk`,
    DROP INDEX `tenant_settings_unattended_recording_ack_by_idx`,
    DROP COLUMN `recording_enabled`,
    DROP COLUMN `recording_retention_days`,
    DROP COLUMN `unattended_recording_ack_at`,
    DROP COLUMN `unattended_recording_ack_by`,
    DROP COLUMN `unattended_recording_enabled`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261125000000_p28e_recordings';
