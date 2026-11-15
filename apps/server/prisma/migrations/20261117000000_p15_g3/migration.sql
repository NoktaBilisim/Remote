-- P15 G3 veri modeli (docs/mimari-e11.md §6; AC-233, 235, 237, 238, 239) + P14'ten devreden 4 e-posta CHECK'i (`$` → `\z`).
-- Ayrıntı ve gerekçeler: docs/db-notlari.md "P15". Veri taşıma YOK. Yeni tablo `request_blocks` → prisma/sql/grants.sql
-- (app SELECT/INSERT/DELETE; UPDATE yok). AC-237: `users.delete` / `support_requests.block` yetki anahtarları DB'de
-- değişiklik istemez (user_permissions.perm_key serbest VARCHAR(60); katalog packages/contracts/src/permissions.ts).
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK, saklı yordam, SIGNAL ve ALGORITHM yan tümcesi üretmez. Prisma'nın
-- ürettiği kısımlar (request_blocks CREATE + FK'ler, sütun eklemeleri, UQ) `migrate diff` çıktısıyla aynı ad/tiple yazıldı;
-- sonrasında `migrate diff --exit-code` = 0 (drift yok).
--
-- Sapmalar (docs/mimari.md §3 notu): session_files.reported_by mimaride `ENUM('TECH','CUSTOMER')`; projede enum'lar
-- VARCHAR(20) + ikili CHECK (ADR-0014) → `VARCHAR(20) NOT NULL DEFAULT 'TECH'` + `session_files_reported_by_chk`.
-- system_settings_mysql_chk DEĞİŞMEDİ: JSON_SCHEMA_VALID `pattern`'i ECMAScript düzenli ifadesidir; `$` gerçek sondur ve
-- 8 satır sonlandırıcının hepsini zaten reddeder, `\z` orada DESTEKLENMEZ (geçerli değeri de reddeder) — 8.4.13'te denendi.
--
-- Kilit (MySQL 8.4):
--  * Ön kontrol → yalnız okuma (4 tablo tam tarama).
--  * E-posta CHECK DROP+ADD → ALGORITHM=COPY: customers, support_requests, support_sessions, tenant_settings yeniden yazılır.
--    Tablo başına TEK ALTER → kısıtsız ara an yok. Migrate server'dan önce `migrate` servisinde çalışır.
--  * ADD COLUMN (sonda; NOT NULL DEFAULT sabit / NULL) → INSTANT. session_files CHECK'leri COPY (oturum başına birkaç
--    satır, retention'lı). session_files UQ → INPLACE (eşzamanlı DML'e izin verir).
--  * request_blocks yeni (boş) tablo — kilit yok.
--
-- ÖN KONTROL (AC-201 kalıbı, P14a): DDL transaction'a girmez → e-posta ALTER'larından ÖNCE yeni desenleri ihlal eden
-- satırlar sayılır; varsa `SIGNAL SQLSTATE '45000'` ile migration HİÇBİR ŞEY DEĞİŞMEDEN durur. Mesaj ör.:
-- `P15_PRECHECK customers=1 tenant_settings=1`. Düzeltme SQL'i docs/db-notlari.md "P15"; sonra
-- `prisma migrate resolve --rolled-back 20261117000000_p15_g3` + `pnpm db:migrate`. Yordam düşerse DB'de kalır (zararsız);
-- sonraki deneme ve down.sql siler.
DROP PROCEDURE IF EXISTS `p15_precheck`;
CREATE PROCEDURE `p15_precheck`()
    READS SQL DATA
BEGIN
    DECLARE v_customers BIGINT;
    DECLARE v_support_requests BIGINT;
    DECLARE v_support_sessions BIGINT;
    DECLARE v_tenant_settings BIGINT;
    DECLARE v_msg VARCHAR(128);
    -- NULL e-postada REGEXP_LIKE(NULL) = NULL → sayılmaz (CHECK'teki `IS NULL OR` ile aynı).
    SELECT COUNT(*) INTO v_customers FROM `customers`
        WHERE NOT REGEXP_LIKE(`email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
    SELECT COUNT(*) INTO v_support_requests FROM `support_requests`
        WHERE NOT REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
    SELECT COUNT(*) INTO v_support_sessions FROM `support_sessions`
        WHERE NOT REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
    SELECT COUNT(*) INTO v_tenant_settings FROM `tenant_settings`
        WHERE NOT REGEXP_LIKE(`smtp_from_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c');
    SET v_msg = CONCAT_WS(' ',
        IF(v_customers > 0, CONCAT('customers=', v_customers), NULL),
        IF(v_support_requests > 0, CONCAT('support_requests=', v_support_requests), NULL),
        IF(v_support_sessions > 0, CONCAT('support_sessions=', v_support_sessions), NULL),
        IF(v_tenant_settings > 0, CONCAT('tenant_settings=', v_tenant_settings), NULL));
    IF v_msg <> '' THEN
        SET v_msg = CONCAT('P15_PRECHECK ', v_msg);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END;
CALL `p15_precheck`();
DROP PROCEDURE `p15_precheck`;

-- 1) P14 devri: e-posta iskeleti `$` → `\z` (gövde aynı, 'c' korunur). support_sessions'ta `customer_name IS NOT NULL`
--    koşulu P8'deki gibi korunur.
ALTER TABLE `customers`
    DROP CHECK `customers_email_fmt_chk`,
    ADD CONSTRAINT `customers_email_fmt_chk` CHECK (`email` IS NULL
        OR REGEXP_LIKE(`email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c'));

ALTER TABLE `support_requests`
    DROP CHECK `support_requests_email_fmt_chk`,
    ADD CONSTRAINT `support_requests_email_fmt_chk` CHECK (`customer_email` IS NULL
        OR REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c'));

ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_customer_email_chk`,
    ADD CONSTRAINT `support_sessions_customer_email_chk` CHECK (
        `customer_email` IS NULL
        OR (REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c')
            AND `customer_name` IS NOT NULL));

ALTER TABLE `tenant_settings`
    DROP CHECK `tenant_settings_smtp_from_email_chk`,
    ADD CONSTRAINT `tenant_settings_smtp_from_email_chk` CHECK (`smtp_from_email` IS NULL
        OR REGEXP_LIKE(`smtp_from_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c'));

-- 2) AC-233: sistem logosu kaldırma = `{"path": null}` (V31 boş değer; app'e DELETE verilmez — WhatsApp `{"url": null}`
--    kalıbı). JSON şeması `pattern`'i yalnız string'e uygulanır; `$` burada gerçek sondur (bkz. üst not).
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_system_logo_chk`,
    ADD CONSTRAINT `system_settings_system_logo_chk` CHECK (CAST(`key` AS BINARY) <> 'system_logo' OR (`value_json` IS NOT NULL
        AND `secret_enc` IS NULL
        AND JSON_SCHEMA_VALID(
            '{"type":"object","additionalProperties":false,"required":["path"],"properties":{"path":{"type":["string","null"],"maxLength":200,"pattern":"^system/[A-Za-z0-9_-]{16,100}[.](png|jpg|webp)$"}}}',
            `value_json`)));

-- 3) AC-239: talep kabulünde kabul kodu (varsayılan kapalı → mevcut akış değişmez). PRISMA ÜRETTİ + ALGORITHM ELLE.
ALTER TABLE `tenant_request_settings` ADD COLUMN `require_accept_code` BOOLEAN NOT NULL DEFAULT false, ALGORITHM=INSTANT;

-- 4) AC-238: raporlayan taraf + eşleşme anahtarı. PRISMA ÜRETTİ + ALGORITHM ELLE. Eski satırlar 'TECH' (mimari §6),
--    match_key NULL (eşleşme bilgisi yok). match_key = sunucunun ürettiği SHA-256 hex (db-notlari "P15" backend notu).
ALTER TABLE `session_files`
    ADD COLUMN `reported_by` VARCHAR(20) NOT NULL DEFAULT 'TECH',
    ADD COLUMN `match_key` CHAR(64) NULL,
    ALGORITHM=INSTANT;
-- ELLE (S15-2, P15 düzeltme 1): P5 kuralında tek satır ALICININ raporuydu (gönderen raporu yalnız audit). TO_CUSTOMER'da
-- alıcı müşteri → eski satır müşteri bildirimi; "doğrulanmış" görünmemeli. TO_TECH eski satırları teknisyenin (TECH kalır).
-- Bu noktada match_key yalnız eski satırlarda NULL (sütun yeni). Idempotent.
UPDATE `session_files` SET `reported_by` = 'CUSTOMER'
    WHERE `match_key` IS NULL AND CAST(`direction` AS BINARY) = 'TO_CUSTOMER';
-- Aynı aktarımı aynı taraf bir kez raporlar (sahte/tekrar meta ile şişirmeyi sınırlar; eşleşme araması session_id önekli).
-- NULL match_key (eski satırlar) UQ'ya takılmaz.
CREATE UNIQUE INDEX `session_files_session_id_match_key_reported_by_key` ON `session_files`(`session_id`, `match_key`, `reported_by`);
-- ELLE: ikili enum (ADR-0014) + anahtar biçimi.
ALTER TABLE `session_files`
    ADD CONSTRAINT `session_files_reported_by_chk` CHECK (CAST(`reported_by` AS BINARY) IN ('TECH', 'CUSTOMER')),
    ADD CONSTRAINT `session_files_match_key_fmt_chk` CHECK (`match_key` IS NULL OR REGEXP_LIKE(`match_key`, '^[a-f0-9]{64}\\z', 'c'));

-- 5) AC-235: talep engelleri. PRISMA ÜRETTİ (CREATE + FK). Append + delete: updated_at yok (app UPDATE yetkisi yok;
--    süre değişimi = aynı TX'te DELETE + INSERT). Tenant başına ≤ 1.000 satır uygulamada (tenant satırı FOR UPDATE + COUNT).
CREATE TABLE `request_blocks` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `ip_from` VARBINARY(16) NULL,
    `ip_to` VARBINARY(16) NULL,
    `device_key_hash` CHAR(64) NULL,
    `expires_at` DATETIME(3) NULL,
    `note` VARCHAR(200) NULL,
    `created_by` CHAR(26) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_blocks_tenant_id_kind_expires_at_idx`(`tenant_id`, `kind`, `expires_at`),
    INDEX `request_blocks_created_by_idx`(`created_by`),
    UNIQUE INDEX `request_blocks_tenant_id_ip_from_ip_to_key`(`tenant_id`, `ip_from`, `ip_to`),
    UNIQUE INDEX `request_blocks_tenant_id_device_key_hash_key`(`tenant_id`, `device_key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `request_blocks` ADD CONSTRAINT `request_blocks_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `request_blocks` ADD CONSTRAINT `request_blocks_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE: CHECK'ler. IP: 4 bayt (IPv4) ya da 16 bayt (IPv6; IPv4-eşlemeli adres uygulamada 4 bayta indirgenir), aynı
-- uzunluk, gerçek CIDR bloğu (ip_from ağ adresi, ip_to yayın adresi; XOR maskesi sondan bitişik 1'ler), genişlik IPv4
-- ≤ /24 (ilk 3 bayt eşit), IPv6 ≤ /48 (ilk 6 bayt eşit). VARBINARY karşılaştırması baytsaldır.
-- ELLE: HEX() bağlantı karakter setinde döner → `COLLATE utf8mb4_bin` olmadan 1267 (harmanlama karışımı); bin ile
-- bağlantı karakter setinden bağımsız (latin1/0900_ai_ci bağlantıda denendi).
ALTER TABLE `request_blocks`
    ADD CONSTRAINT `request_blocks_kind_chk` CHECK (CAST(`kind` AS BINARY) IN ('IP', 'DEVICE')),
    ADD CONSTRAINT `request_blocks_target_chk` CHECK (
        (CAST(`kind` AS BINARY) = 'IP' AND `ip_from` IS NOT NULL AND `ip_to` IS NOT NULL AND `device_key_hash` IS NULL)
        OR (CAST(`kind` AS BINARY) = 'DEVICE' AND `device_key_hash` IS NOT NULL AND `ip_from` IS NULL AND `ip_to` IS NULL)),
    ADD CONSTRAINT `request_blocks_ip_range_chk` CHECK (`ip_from` IS NULL OR `ip_to` IS NULL OR (
        LENGTH(`ip_from`) IN (4, 16)
        AND LENGTH(`ip_to`) = LENGTH(`ip_from`)
        AND ((LENGTH(`ip_from`) = 4 AND LEFT(`ip_from`, 3) = LEFT(`ip_to`, 3))
            OR (LENGTH(`ip_from`) = 16 AND LEFT(`ip_from`, 6) = LEFT(`ip_to`, 6)))
        AND REGEXP_LIKE(HEX(`ip_from` ^ `ip_to`) COLLATE utf8mb4_bin, '^0*[137]?F*\\z', 'c')
        AND REGEXP_LIKE(HEX(`ip_from` & (`ip_from` ^ `ip_to`)) COLLATE utf8mb4_bin, '^0+\\z', 'c'))),
    ADD CONSTRAINT `request_blocks_device_key_hash_fmt_chk` CHECK (`device_key_hash` IS NULL
        OR REGEXP_LIKE(`device_key_hash`, '^[a-f0-9]{64}\\z', 'c')),
    ADD CONSTRAINT `request_blocks_expires_chk` CHECK (`expires_at` IS NULL OR `expires_at` > `created_at`),
    ADD CONSTRAINT `request_blocks_note_chk` CHECK (`note` IS NULL
        OR (CHAR_LENGTH(`note`) BETWEEN 1 AND 200
            AND CHAR_LENGTH(`note`) = CHAR_LENGTH(TRIM(`note`))
            AND NOT REGEXP_LIKE(`note`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')));
