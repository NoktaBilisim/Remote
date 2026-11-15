-- P14a A3 (docs/mimari-e11.md §4.2 AC-211): `system_settings.mysql` değerine isteğe bağlı `requireTls: boolean` alanı.
-- ELLE YAZILDI (backend-dev, A3): §4.1 migration'ı bu alanı kapsamıyordu; P11 JSON şeması `additionalProperties:false`
-- olduğu için yeni anahtar yazılamazdı (3819). Şemanın geri kalanı P11 ile birebir; yalnız `requireTls` eklendi
-- (zorunlu değil → eski satırlar geçerli kalır, okuyucu yokluğu `false` sayar). Yeni tablo/yetki yok → grants.sql değişmez.
-- Kilit: system_settings en çok 3 satır; DROP+ADD CHECK tek ALTER (kısıtsız ara an yok).
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_mysql_chk`,
    ADD CONSTRAINT `system_settings_mysql_chk` CHECK (CAST(`key` AS BINARY) <> 'mysql' OR (`value_json` IS NOT NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["host","port","database","user"],"properties":{"host":{"type":"string","minLength":1,"maxLength":253,"pattern":"^([A-Za-z0-9.-]+|\\\\[[0-9A-Fa-f:.]+\\\\])$"},"port":{"type":"integer","minimum":1,"maximum":65535},"database":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[A-Za-z0-9_$-]+$"},"user":{"type":"string","minLength":1,"maxLength":32},"requireTls":{"type":"boolean"}}}',
            `value_json`)
        AND NOT REGEXP_LIKE(`value_json` ->> '$.user', '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')));
