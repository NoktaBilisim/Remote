-- P12 marka ve kişiselleştirme (docs/mimari.md §3.1, §10 P12; AC-81..85; T16). Yalnız CHECK değişikliği:
-- yeni tablo/sütun YOK (tenants.logo_path, users.avatar_path, users.theme P1'den beri var), veri taşıma YOK,
-- Prisma şeması ve drift DEĞİŞMEZ. Ayrıntı ve kararlar: docs/db-notlari.md "P12".
--
-- ELLE YAZILDI (dba): Prisma CHECK ifade edemez. Tetikleyicilere dokunulmaz.
--  1) system_settings_key_chk genişler: + 'system_logo' (ikili, ADR-0014). Yeni system_settings_system_logo_chk:
--     value_json = {"path": "system/<rastgele>.<png|jpg|webp>"} (additionalProperties:false), secret_enc NULL.
--  2) Dosya yolu biçimi (savunma derinliği; backend upload katmanı birincil): tenants_logo_path_chk,
--     users_avatar_path_chk. Yol, yükleme köküne göre göreli: `{öndek}/{rastgele}.{uzantı}`
--       öndek    = tenants: satırın kendi `id`'si; users: satırın `tenant_id`'si, Super Admin (tenant_id NULL) → `system`
--       rastgele = [A-Za-z0-9_-]{16,100} (base64url/ULID/hex; nokta ve `/` yok → `..`, gizli dosya, alt dizin imkânsız)
--       uzantı   = png | jpg | webp (küçük harf; sharp yeniden kodlar, uzantıyı sunucu seçer)
--     Öndek satırın tenant'ına BAĞLI: başka tenant'ın klasörünü gösteren yol DB'ye yazılamaz (AC-84 izolasyonu).
--     Sondaki `\z`: ICU `$` sondaki `\n`'yi kabul eder (db-notlari P10 madde 3). Harf duyarlı ('c'): sütunlar *_ci.
--  users.theme: `users_theme_chk` zaten ikili (ADR-0014 migration'ı) → değişiklik yok.
--
-- Kilit (MySQL 8.4): ADD CHECK = ALGORITHM=COPY → tenants, users ve system_settings yeniden yazılır (üçü de küçük;
-- prod henüz kapalı, staging küçük). Tablo başına tek ALTER (DROP + ADD aynı ifadede) → kısıtsız ara an yok.
--
-- ÖN KONTROL (koruma): MySQL DDL transaction'a girmez; 2. ALTER ihlalle düşerse 1. değişmiş kalırdı. P12 öncesi kod
-- logo_path/avatar_path yazmıyor ve system_logo anahtarı yazılamıyordu → dolu satır beklenmez. Biçime uymayan satır
-- varsa `p12_up_guard_chk` (3819) migration'ı HİÇBİR ŞEY DEĞİŞMEDEN durdurur; satır mimar/backend ile incelenir
-- (dosya sistemindeki karşılığı da kontrol edilmeli), elle "düzeltilmez" → NULL'a çekilip yeniden yüklenir.
CREATE TEMPORARY TABLE `p12_up_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p12_up_guard_chk` CHECK (`n` = 0));
INSERT INTO `p12_up_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `tenants` WHERE `logo_path` IS NOT NULL AND NOT (
            REGEXP_LIKE(`logo_path`, '^[0-9A-Z]{26}/[A-Za-z0-9_-]{16,100}[.](png|jpg|webp)\\z', 'c')
            AND CAST(SUBSTRING_INDEX(`logo_path`, '/', 1) AS BINARY) = CAST(`id` AS BINARY)))
    + (SELECT COUNT(*) FROM `users` WHERE `avatar_path` IS NOT NULL AND NOT (
            REGEXP_LIKE(`avatar_path`, '^([0-9A-Z]{26}|system)/[A-Za-z0-9_-]{16,100}[.](png|jpg|webp)\\z', 'c')
            AND CAST(SUBSTRING_INDEX(`avatar_path`, '/', 1) AS BINARY) = CAST(COALESCE(`tenant_id`, 'system') AS BINARY)));
DROP TEMPORARY TABLE `p12_up_guard`;

-- 1) system_settings: anahtar kümesi + sistem logosu şeması (P11 JSON şema kalıbı). Boş/az satırlı tablo.
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_key_chk`,
    ADD CONSTRAINT `system_settings_key_chk` CHECK (CAST(`key` AS BINARY) IN ('mysql', 'turn', 'system_logo')),
    ADD CONSTRAINT `system_settings_system_logo_chk` CHECK (CAST(`key` AS BINARY) <> 'system_logo' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["path"],"properties":{"path":{"type":"string","maxLength":200,"pattern":"^system/[A-Za-z0-9_-]{16,100}[.](png|jpg|webp)$"}}}',
            `value_json`)));

-- 2) Tenant logosu: öndek = satırın kendi id'si.
ALTER TABLE `tenants`
    ADD CONSTRAINT `tenants_logo_path_chk` CHECK (`logo_path` IS NULL OR (
        REGEXP_LIKE(`logo_path`, '^[0-9A-Z]{26}/[A-Za-z0-9_-]{16,100}[.](png|jpg|webp)\\z', 'c')
        AND CAST(SUBSTRING_INDEX(`logo_path`, '/', 1) AS BINARY) = CAST(`id` AS BINARY)));

-- 3) Kullanıcı avatarı: öndek = tenant_id; Super Admin (tenant_id NULL) → 'system'.
ALTER TABLE `users`
    ADD CONSTRAINT `users_avatar_path_chk` CHECK (`avatar_path` IS NULL OR (
        REGEXP_LIKE(`avatar_path`, '^([0-9A-Z]{26}|system)/[A-Za-z0-9_-]{16,100}[.](png|jpg|webp)\\z', 'c')
        AND CAST(SUBSTRING_INDEX(`avatar_path`, '/', 1) AS BINARY) = CAST(COALESCE(`tenant_id`, 'system') AS BINARY)));
