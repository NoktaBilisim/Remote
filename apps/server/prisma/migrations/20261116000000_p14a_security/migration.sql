-- P14a güvenlik veri modeli (docs/mimari-e11.md §4.1; ADR-0014, ADR-0022, ADR-0023; AC-201, AC-206, AC-215).
-- Expand + sıkılaştırma; veri taşıma YOK. Yeni tablo YOK → prisma/sql/grants.sql değişmez (users ve auth_sessions'ta
-- app'in tablo düzeyi UPDATE yetkisi yeni sütunları kapsar). Ayrıntı: docs/db-notlari.md "P14a".
--
-- 1) 6 biçim CHECK'i `$` → `\z` (AC-201). ICU `$` (REGEXP_LIKE, çok satır kipi kapalı) girdinin sonundaki TEK satır
--    sonlandırıcıdan önce de eşleşir: LF, CR, CRLF, VT, FF, NEL (U+0085), LS (U+2028), PS (U+2029) — 8.4.13'te denendi.
--    `\z` yalnız gerçek sonda eşleşir. 'c' (harf duyarlı) ve desenlerin geri kalanı aynen korunur (ADR-0014).
--    Sabit uzunluklu CHAR(n) + `{n}` desenleri etkilenmez (sonlandırıcı sütuna sığmaz); bu migration'a girmedi.
-- 2) users.version (If-Match / ETag, ADR-0023) ve auth_sessions.step_up_at (son step-up anı, ADR-0022).
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK, saklı yordam ve SIGNAL üretmez. Prisma'nın ürettiği kısım (madde 2,
-- `migrate diff --from-config-datasource --to-schema` çıktısı) aynı tip/varsayılanla yazıldı, yalnız ALGORITHM=INSTANT
-- yan tümcesi eklendi. Sonrasında `migrate diff --exit-code` = 0 (drift yok).
--
-- Kilit (MySQL 8.4):
--  * Ön kontrol → yalnız okuma (tam tarama; tablolar küçük).
--  * DROP+ADD CHECK → ALGORITHM=COPY: customers, support_requests, device_bindings, tenant_request_settings yeniden
--    yazılır (süre boyunca yazma bekler). Tablo başına TEK ALTER (DROP CHECK + ADD CONSTRAINT) → kısıtsız ara an yok.
--    Staging küçük; prod'da migrate, server başlamadan önce `migrate` servisinde çalışır (compose sırası).
--  * ADD COLUMN (sonda, NOT NULL DEFAULT sabit / NULL) → ALGORITHM=INSTANT (yalnız metadata; satır yeniden yazılmaz).
--
-- ÖN KONTROL (AC-201): MySQL'de DDL transaction'a girmez; 3. tabloda ihlal çıkarsa ilk ikisi değişmiş kalırdı. Bu yüzden
-- ALTER'lardan ÖNCE yeni desenleri ihlal eden satırlar sayılır; varsa `SIGNAL SQLSTATE '45000'` ile migration HİÇBİR ŞEY
-- DEĞİŞMEDEN durur. Mesaj ihlali olan tabloları ve satır sayılarını taşır (Prisma P3018 çıktısında/migrate logunda
-- görünür), ör.: `P14A_PRECHECK customers=2 support_requests=1`. Sütun bazında döküm sorgusu: docs/db-notlari.md "P14a".
-- Düzeltme SQL'i (sondaki sonlandırıcıyı kırpma) docs/db-notlari.md "P14a"da; düzeltme sonrası
-- `prisma migrate resolve --rolled-back 20261116000000_p14a_security` + `pnpm db:migrate`.
-- SIGNAL yalnız saklı program içinde geçerli → geçici yordam (DEFINER migrator; migrator `<db>`.* ALL'a sahip).
-- Prisma betiği sunucuya bütün olarak gönderir; BEGIN…END bileşik gövde `END`'de biter, DELIMITER gerekmez (P13a madde 0).
-- Ön kontrol düşerse yordam DB'de kalır (zararsız, yalnız okur); bir sonraki deneme önce DROP IF EXISTS yapar,
-- down.sql de siler. Yedek dökümüne girmez: backup.sh `--routines` kullanmaz; restore-sec-snapshot `routines=` farkı
-- verirse `DROP PROCEDURE IF EXISTS p14a_precheck` (docs/db-notlari.md "P14a").
DROP PROCEDURE IF EXISTS `p14a_precheck`;
CREATE PROCEDURE `p14a_precheck`()
    READS SQL DATA
BEGIN
    DECLARE v_customers BIGINT;
    DECLARE v_support_requests BIGINT;
    DECLARE v_device_bindings BIGINT;
    DECLARE v_tenant_request_settings BIGINT;
    DECLARE v_msg VARCHAR(128);
    -- NULL olabilen sütunda REGEXP_LIKE(NULL) = NULL → NOT NULL = NULL → sayılmaz (CHECK'teki `IS NULL OR` ile aynı).
    SELECT COUNT(*) INTO v_customers FROM `customers`
        WHERE NOT REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}\\z', 'c')
           OR NOT REGEXP_LIKE(`phone`, '^[+][1-9][0-9]{7,14}\\z', 'c');
    SELECT COUNT(*) INTO v_support_requests FROM `support_requests`
        WHERE NOT REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c')
           OR NOT REGEXP_LIKE(`customer_phone`, '^[+][1-9][0-9]{7,14}\\z', 'c');
    SELECT COUNT(*) INTO v_device_bindings FROM `device_bindings`
        WHERE NOT REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c');
    SELECT COUNT(*) INTO v_tenant_request_settings FROM `tenant_request_settings`
        WHERE NOT REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}\\z', 'c');
    -- CONCAT_WS NULL'ları atlar → yalnız ihlalli tablolar yazılır. En uzun hâli ~100 karakter (MESSAGE_TEXT ≤ 128).
    SET v_msg = CONCAT_WS(' ',
        IF(v_customers > 0, CONCAT('customers=', v_customers), NULL),
        IF(v_support_requests > 0, CONCAT('support_requests=', v_support_requests), NULL),
        IF(v_device_bindings > 0, CONCAT('device_bindings=', v_device_bindings), NULL),
        IF(v_tenant_request_settings > 0, CONCAT('tenant_request_settings=', v_tenant_request_settings), NULL));
    IF v_msg <> '' THEN
        SET v_msg = CONCAT('P14A_PRECHECK ', v_msg);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END;
CALL `p14a_precheck`();
DROP PROCEDURE `p14a_precheck`;

-- 1) AC-201: `$` → `\z`. Desenler P8b/P8c ile birebir aynı, yalnız son çapa değişti.
ALTER TABLE `customers`
    DROP CHECK `customers_file_label_chk`,
    DROP CHECK `customers_phone_fmt_chk`,
    ADD CONSTRAINT `customers_file_label_chk` CHECK (REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}\\z', 'c')),
    ADD CONSTRAINT `customers_phone_fmt_chk` CHECK (`phone` IS NULL OR REGEXP_LIKE(`phone`, '^[+][1-9][0-9]{7,14}\\z', 'c'));

ALTER TABLE `support_requests`
    DROP CHECK `support_requests_client_version_fmt_chk`,
    DROP CHECK `support_requests_phone_fmt_chk`,
    ADD CONSTRAINT `support_requests_client_version_fmt_chk` CHECK (REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c')),
    ADD CONSTRAINT `support_requests_phone_fmt_chk` CHECK (`customer_phone` IS NULL OR REGEXP_LIKE(`customer_phone`, '^[+][1-9][0-9]{7,14}\\z', 'c'));

ALTER TABLE `device_bindings`
    DROP CHECK `device_bindings_client_version_fmt_chk`,
    ADD CONSTRAINT `device_bindings_client_version_fmt_chk` CHECK (REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c'));

ALTER TABLE `tenant_request_settings`
    DROP CHECK `tenant_request_settings_file_label_chk`,
    ADD CONSTRAINT `tenant_request_settings_file_label_chk` CHECK (REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}\\z', 'c'));

-- 2) PRISMA ÜRETTİ (adlar/tipler migrate diff ile aynı) + ALGORITHM yan tümceleri ELLE:
-- ADR-0023 (AC-206): PATCH /users/:id koşullu `UPDATE … WHERE id=? AND version=?` + `version=version+1`. Mevcut satırlar 0.
-- Yeni indeks yok: koşul PK eşitliğiyle tek satırı bulur, version yalnız o satırda süzülür.
ALTER TABLE `users` ADD COLUMN `version` INTEGER UNSIGNED NOT NULL DEFAULT 0, ALGORITHM=INSTANT;
-- ADR-0022 (AC-215): son başarılı step-up anı (UTC). Guard `step_up_at >= now - 5 dk`'yı oturum satırından (PK/token_hash
-- ile zaten okunan) kontrol eder → indeks gerekmez. Yeni oturum NULL = step-up yok.
ALTER TABLE `auth_sessions` ADD COLUMN `step_up_at` DATETIME(3) NULL, ALGORITHM=INSTANT;
