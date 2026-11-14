-- GERİ ALMA (elle, dba) — 20261115090000_whatsapp_api_key. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Önce sunucu kodu geri alınmalıdır (anahtar yazan kod). Kayıtlı panel anahtarı SİLİNİR (secret_enc NULL), sonra CHECK
-- P13a durumuna döner. Sonrasında servis anahtarı yalnız env'den gelebilir (eski kodda hiç gönderilmez).
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261115090000_whatsapp_api_key/down.sql
UPDATE `system_settings` SET `secret_enc` = NULL WHERE CAST(`key` AS BINARY) = 'whatsapp';
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_whatsapp_chk`,
    ADD CONSTRAINT `system_settings_whatsapp_chk` CHECK (CAST(`key` AS BINARY) <> 'whatsapp' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["url"],"properties":{"url":{"type":["string","null"],"maxLength":200}}}',
            `value_json`)
        AND (JSON_TYPE(JSON_EXTRACT(`value_json`, '$.url')) = 'NULL'
            OR REGEXP_LIKE(`value_json` ->> '$.url', '^https?://[^@?#\\s\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+\\z', 'c'))));
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261115090000_whatsapp_api_key';
