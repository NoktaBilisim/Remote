-- S-P13b-3: WhatsApp servis anahtarı (`x-api-key`) panelde şifreli saklanır → `whatsapp` satırında `secret_enc` artık
-- yalnız adres JSON null iken (DELETE sonrası "env'e dön" satırı) NULL olmak zorunda; adres doluyken NULL ya da şifreli
-- anahtar (AES-256-GCM, AAD `system_settings.secret_enc:whatsapp:<köken>`). Uzunluk alt sınırı genel
-- `system_settings_secret_enc_chk` (≥ 30) ile. Yeni tablo/sütun, veri taşıma, Prisma şema değişikliği YOK (drift 0);
-- yetki değişmedi (app zaten secret_enc yazar: turn/mysql).
--
-- ELLE YAZILDI (backend-dev; dba incelemesi gerekli). Adres kuralı P13a (20261114120000) ile birebir aynı; yalnız
-- `secret_enc IS NULL` maddesi gevşer. Kilit: ADD CHECK = ALGORITHM=COPY (≤ birkaç satır); tek ALTER (DROP + ADD) →
-- kısıtsız ara an yok. Mevcut satırlar eski kuralla secret_enc NULL → yeni kuralı ihlal edemez.
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_whatsapp_chk`,
    ADD CONSTRAINT `system_settings_whatsapp_chk` CHECK (CAST(`key` AS BINARY) <> 'whatsapp' OR (`value_json` IS NOT NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["url"],"properties":{"url":{"type":["string","null"],"maxLength":200}}}',
            `value_json`)
        AND ((JSON_TYPE(JSON_EXTRACT(`value_json`, '$.url')) = 'NULL' AND `secret_enc` IS NULL)
            OR REGEXP_LIKE(`value_json` ->> '$.url', '^https?://[^@?#\\s\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+\\z', 'c'))));
