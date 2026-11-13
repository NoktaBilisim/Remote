-- WhatsApp servis adresi (Super Admin sistem ayarı). Yalnız CHECK: yeni tablo/sütun, veri taşıma, Prisma şema
-- değişikliği YOK (drift 0). Ayrıntı ve kararlar: docs/db-notlari.md "WhatsApp servis ayarı".
--
-- ELLE YAZILDI (dba): Prisma CHECK ifade edemez. P11/P12 kalıbı (ADR-0014 ikili anahtar, anahtar başına JSON şeması).
--  1) system_settings_key_chk genişler: + 'whatsapp' (ikili).
--  2) Yeni system_settings_whatsapp_chk: value_json = {"url": null | "<adres>"} (tek alan, zorunlu,
--     additionalProperties:false), secret_enc NULL (servis kimlik doğrulamasız; gizli değer yok).
--     url string ise: ≤ 200 karakter (JSON şema maxLength, kod noktası), `^https?://` ile başlar (harf duyarlı 'c'),
--     sonrası en az 1 karakter ve hiçbiri `@` `?` `#`, boşluk (\s: Unicode boşlukları) veya kontrol (\p{Cc}) değil.
--     Desen ICU REGEXP_LIKE ile, sonu `\z` (ICU `$` sondaki `\n`'yi kabul eder — db-notlari P10 madde 3).
--     url JSON null → ayar yok sayılır (env WHATSAPP_SERVICE_URL / varsayılan; karar backend).
--
-- Kilit (MySQL 8.4): ADD CHECK = ALGORITHM=COPY → system_settings yeniden yazılır (≤ birkaç satır). Tek ALTER
-- (DROP + ADD aynı ifadede) → kısıtsız ara an yok. Ön koruma gerekmez: önceki key CHECK'i 'whatsapp' satırına izin
-- vermiyordu, yeni CHECK yalnız key = 'whatsapp' satırlarını sınar → mevcut satırlar ihlal edemez.
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_key_chk`,
    ADD CONSTRAINT `system_settings_key_chk` CHECK (CAST(`key` AS BINARY) IN ('mysql', 'turn', 'system_logo', 'whatsapp')),
    ADD CONSTRAINT `system_settings_whatsapp_chk` CHECK (CAST(`key` AS BINARY) <> 'whatsapp' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["url"],"properties":{"url":{"type":["string","null"],"maxLength":200}}}',
            `value_json`)
        AND (JSON_TYPE(JSON_EXTRACT(`value_json`, '$.url')) = 'NULL'
            OR REGEXP_LIKE(`value_json` ->> '$.url', '^https?://[^@?#\\s\\p{Cc}]+\\z', 'c'))));
