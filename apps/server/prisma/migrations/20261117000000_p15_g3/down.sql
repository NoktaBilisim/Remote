-- GERİ ALMA (elle, dba) — 20261117000000_p15_g3. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P15 sunucu kodu geri alınmalı.
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261117000000_p15_g3/down.sql
-- Ayrıca grants.sql'deki request_blocks satırları kaldırılmalı (tablo yokken GRANT hata verir).
-- Kalıcı kayıp: request_blocks (engel listesi; audit'te izi var), session_files.reported_by/match_key, require_accept_code
-- tercihi, "logo kaldırıldı" satırı (= varsayılan logo; satırın yokluğu aynı anlam). E-posta CHECK'leri `$`'a GEVŞER
-- (guard gerekmez).
DROP PROCEDURE IF EXISTS `p15_precheck`;

DROP TABLE IF EXISTS `request_blocks`;

-- P15 sonrası gönderen tarafın ayrı satırı (match_key dolu) eski "tek satır = alıcı raporu" modelinde çift görünür → silinir.
-- Eski satırlar (match_key NULL) korunur. Migration'ın eski TO_CUSTOMER satırlarına yazdığı reported_by='CUSTOMER'
-- (S15-2) sütunla birlikte düşer; eski modelde bu satırlar zaten alıcı (müşteri) raporuydu, ek geri alma gerekmez.
DELETE FROM `session_files` WHERE `match_key` IS NOT NULL
    AND ((CAST(`direction` AS BINARY) = 'TO_CUSTOMER' AND CAST(`reported_by` AS BINARY) = 'TECH')
      OR (CAST(`direction` AS BINARY) = 'TO_TECH' AND CAST(`reported_by` AS BINARY) = 'CUSTOMER'));
ALTER TABLE `session_files` DROP CHECK `session_files_reported_by_chk`, DROP CHECK `session_files_match_key_fmt_chk`;
DROP INDEX `session_files_session_id_match_key_reported_by_key` ON `session_files`;
ALTER TABLE `session_files` DROP COLUMN `match_key`, DROP COLUMN `reported_by`, ALGORITHM=INSTANT;

ALTER TABLE `tenant_request_settings` DROP COLUMN `require_accept_code`, ALGORITHM=INSTANT;

-- `{"path": null}` P12 şemasına uymaz; satırın yokluğu aynı anlam (varsayılan logo).
DELETE FROM `system_settings` WHERE CAST(`key` AS BINARY) = 'system_logo'
    AND JSON_TYPE(JSON_EXTRACT(`value_json`, '$.path')) = 'NULL';
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_system_logo_chk`,
    ADD CONSTRAINT `system_settings_system_logo_chk` CHECK (CAST(`key` AS BINARY) <> 'system_logo' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["path"],"properties":{"path":{"type":"string","maxLength":200,"pattern":"^system/[A-Za-z0-9_-]{16,100}[.](png|jpg|webp)$"}}}',
            `value_json`)));

ALTER TABLE `tenant_settings`
    DROP CHECK `tenant_settings_smtp_from_email_chk`,
    ADD CONSTRAINT `tenant_settings_smtp_from_email_chk` CHECK (`smtp_from_email` IS NULL
        OR REGEXP_LIKE(`smtp_from_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c'));
ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_customer_email_chk`,
    ADD CONSTRAINT `support_sessions_customer_email_chk` CHECK (
        `customer_email` IS NULL
        OR (REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c')
            AND `customer_name` IS NOT NULL));
ALTER TABLE `support_requests`
    DROP CHECK `support_requests_email_fmt_chk`,
    ADD CONSTRAINT `support_requests_email_fmt_chk` CHECK (`customer_email` IS NULL
        OR REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c'));
ALTER TABLE `customers`
    DROP CHECK `customers_email_fmt_chk`,
    ADD CONSTRAINT `customers_email_fmt_chk` CHECK (`email` IS NULL
        OR REGEXP_LIKE(`email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c'));

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261117000000_p15_g3';
