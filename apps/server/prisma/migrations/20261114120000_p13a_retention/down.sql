-- GERİ ALMA (elle, dba) — 20261114120000_p13a_retention. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Şemayı, tetikleyicileri ve app yetkilerini P12b (20261114090000_whatsapp_service_setting) durumuna döndürür.
-- Sunucu kodu ve grants.sql önce geri alınmalıdır (P13a kodu anonymized_at'i okur/yazar, retention DELETE yapar).
-- Uyarı: audit_logs_force_created_at kalkınca app yeniden created_at değerini kendisi belirler (I-P11-3 açığı geri
-- gelir) → bu yüzden P13a DELETE yetkileri de AYNI dosyada geri alınır (aşağıda REVOKE). Retention işi durmalıdır.
-- Koruma: anonimleştirilmiş oturum varsa sütunu düşürmek "bu oturum anonim" bilgisini kalıcı olarak yok eder (kişisel
-- alanlar zaten NULL; işaret kaybolunca geçmiş ekranı onları sıradan, müşteri adı boş oturum gibi gösterir ve PATCH ile
-- yeniden kişisel veri yazılabilir) → `p13a_down_guard_chk` (3819) ile HİÇBİR ŞEY DEĞİŞMEDEN durur.
-- Bilinçli karar verilirse: önce yedek (runbook §18), anonim oturum listesi dışa alınır, sonra migrator ile
-- `UPDATE support_sessions SET anonymized_at = NULL WHERE anonymized_at IS NOT NULL;` ve bu dosya tekrar çalıştırılır.
-- WhatsApp CHECK'i P12b'ye gevşer (\p{Cf} yeniden kabul edilir) → koruma gerekmez.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261114120000_p13a_retention/down.sql
CREATE TEMPORARY TABLE `p13a_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p13a_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p13a_down_guard` (`n`) SELECT COUNT(*) FROM `support_sessions` WHERE `anonymized_at` IS NOT NULL;
DROP TEMPORARY TABLE `p13a_down_guard`;

-- P13a yetkileri (grants.sql P13a satırları). Tablo düzeyi REVOKE sütun yetkisini kaldırmaz → sütun yetkisi ayrıca.
-- IF EXISTS: grants.sql hiç çalışmamışsa (yalnız migrate) uyarı verir, durmaz.
REVOKE IF EXISTS DELETE ON `audit_logs` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `password_reset_tokens` FROM 'app'@'%';
REVOKE IF EXISTS DELETE ON `session_files` FROM 'app'@'%';
REVOKE IF EXISTS UPDATE (`ip`, `user_agent`) ON `session_consents` FROM 'app'@'%';

DROP TRIGGER IF EXISTS `audit_logs_force_created_at`;
-- `audit_logs_no_update` BİLEREK P11 biçimine döndürülmez: BEGIN…END gövdeli sürüm davranışça aynıdır ve
-- mysqldump → düz `mysql` geri yüklemesini bozmaz (sondaki `;` sorunu, migration.sql madde 0).

ALTER TABLE `support_sessions` DROP CHECK `support_sessions_anonymized_chk`;
ALTER TABLE `support_sessions` DROP INDEX `support_sessions_tenant_id_anonymized_at_created_at_idx`;
ALTER TABLE `support_sessions` DROP COLUMN `anonymized_at`, ALGORITHM=INSTANT;

ALTER TABLE `system_settings`
    DROP CHECK `system_settings_whatsapp_chk`,
    ADD CONSTRAINT `system_settings_whatsapp_chk` CHECK (CAST(`key` AS BINARY) <> 'whatsapp' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["url"],"properties":{"url":{"type":["string","null"],"maxLength":200}}}',
            `value_json`)
        AND (JSON_TYPE(JSON_EXTRACT(`value_json`, '$.url')) = 'NULL'
            OR REGEXP_LIKE(`value_json` ->> '$.url', '^https?://[^@?#\\s\\p{Cc}]+\\z', 'c'))));

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261114120000_p13a_retention';
