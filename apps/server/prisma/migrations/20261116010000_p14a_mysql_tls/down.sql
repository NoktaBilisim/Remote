-- GERİ ALMA (elle) — 20261116010000_p14a_mysql_tls. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P14a A3 sunucu kodu geri alınmalı.
-- `requireTls` anahtarı silinir (P11 şeması bilinmeyen anahtarı reddeder), sonra P11 CHECK'i geri gelir.
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261116010000_p14a_mysql_tls/down.sql
UPDATE `system_settings` SET `value_json` = JSON_REMOVE(`value_json`, '$.requireTls')
    WHERE CAST(`key` AS BINARY) = 'mysql' AND JSON_CONTAINS_PATH(`value_json`, 'one', '$.requireTls');
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_mysql_chk`,
    ADD CONSTRAINT `system_settings_mysql_chk` CHECK (CAST(`key` AS BINARY) <> 'mysql' OR (`value_json` IS NOT NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["host","port","database","user"],"properties":{"host":{"type":"string","minLength":1,"maxLength":253,"pattern":"^([A-Za-z0-9.-]+|\\\\[[0-9A-Fa-f:.]+\\\\])$"},"port":{"type":"integer","minimum":1,"maximum":65535},"database":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[A-Za-z0-9_$-]+$"},"user":{"type":"string","minLength":1,"maxLength":32}}}',
            `value_json`)
        AND NOT REGEXP_LIKE(`value_json` ->> '$.user', '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')));

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261116010000_p14a_mysql_tls';
