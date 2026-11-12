-- P8c-1 (docs/mimari-e10.md §3 + BAĞLAYICI §15 r2, ADR-0017, ADR-0006 r5, ADR-0014; AC-165..195): müşteri firmalar,
-- tek ref ad alanı, bilgisayar kaydı. Expand-only: 3 yeni tablo (customers, request_refs, device_bindings);
-- support_requests += customer_id, binding_id; support_sessions += customer_id; support_requests.cancel_reason CHECK
-- genişler (CUSTOMER_PASSIVE, BINDING_REVOKED). Veri taşıma: yalnız request_refs geri doldurma (idempotent, aşağıda).
--
-- Kilitleme notu (MySQL 8.4):
--  * CREATE TABLE (boş) → kilit yok. Yeni tablolardaki MODIFY/CHECK boş tabloda anlık.
--  * ADD COLUMN (NULL, varsayılansız) → INSTANT. CREATE INDEX → INPLACE, LOCK=NONE.
--  * ADD FOREIGN KEY (support_requests, support_sessions) → foreign_key_checks=1 iken COPY; yeni sütunlar NULL → ihlal yok.
--  * support_requests cancel_reason DROP+ADD CHECK → COPY (tablo yeniden yazılır, süresince yazma bekler). Prod kapalı
--    (P10), staging küçük → kabul. Büyük tabloda bakım penceresinde.
--  Ön kontrol gerekmez: cancel_reason CHECK yalnız GENİŞLER; diğer CHECK'ler yeni tablolara/NULL sütunlara bakar.
--
-- Bileşik müşteri FK'si (tenant_id, customer_id) → customers(tenant_id, id) sırasıyla kuruldu (mimaride (customer_id,
-- tenant_id) → (id, tenant_id)): anlam aynı; InnoDB FK indeksinin sütun SIRASI eşleşmeli → mimarinin zaten istediği
-- IX(tenant_id, customer_id, …) indeksleri FK'yi de taşır, 4 tabloda ayrı (customer_id, tenant_id) indeksi gerekmez.
--
-- PRISMA ÜRETTİ (migrate diff --from-config-datasource --to-schema) ↓ — değiştirilmedi.

-- AlterTable
ALTER TABLE `support_requests` ADD COLUMN `binding_id` CHAR(26) NULL,
    ADD COLUMN `customer_id` CHAR(26) NULL;

-- AlterTable
ALTER TABLE `support_sessions` ADD COLUMN `customer_id` CHAR(26) NULL;

-- CreateTable
CREATE TABLE `customers` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `name_key` VARCHAR(200) NOT NULL,
    `search_key` VARCHAR(400) NOT NULL,
    `file_label` VARCHAR(20) NOT NULL,
    `request_ref` CHAR(16) NOT NULL,
    `ref_rotated_at` DATETIME(3) NULL,
    `contact_name` VARCHAR(80) NULL,
    `phone` VARCHAR(16) NULL,
    `email` VARCHAR(254) NULL,
    `note` VARCHAR(1000) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `passive_at` DATETIME(3) NULL,
    `anonymized_at` DATETIME(3) NULL,
    `created_by` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_request_ref_key`(`request_ref`),
    INDEX `customers_tenant_id_status_name_key_idx`(`tenant_id`, `status`, `name_key`),
    INDEX `customers_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `customers_status_passive_at_idx`(`status`, `passive_at`),
    INDEX `customers_created_by_idx`(`created_by`),
    UNIQUE INDEX `customers_tenant_id_name_key_key`(`tenant_id`, `name_key`),
    UNIQUE INDEX `customers_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_refs` (
    `ref` CHAR(16) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `customer_id` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_refs_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    PRIMARY KEY (`ref`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_bindings` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `customer_id` CHAR(26) NULL,
    `key_hash` CHAR(64) NULL,
    `client_version` VARCHAR(20) NOT NULL,
    `first_session_id` CHAR(26) NOT NULL,
    `last_session_id` CHAR(26) NOT NULL,
    `issue_count` INTEGER NOT NULL DEFAULT 1,
    `last_used_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(20) NULL,
    `active_session_id` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `device_bindings_key_hash_key`(`key_hash`),
    UNIQUE INDEX `device_bindings_active_session_id_key`(`active_session_id`),
    INDEX `device_bindings_tenant_id_customer_id_revoked_at_idx`(`tenant_id`, `customer_id`, `revoked_at`),
    INDEX `device_bindings_revoked_at_last_used_at_idx`(`revoked_at`, `last_used_at`),
    INDEX `device_bindings_last_session_id_tenant_id_idx`(`last_session_id`, `tenant_id`),
    INDEX `device_bindings_first_session_id_tenant_id_idx`(`first_session_id`, `tenant_id`),
    UNIQUE INDEX `device_bindings_id_tenant_id_key`(`id`, `tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `support_requests_tenant_id_customer_id_created_at_idx` ON `support_requests`(`tenant_id`, `customer_id`, `created_at`);

-- CreateIndex
CREATE INDEX `support_requests_binding_id_tenant_id_status_idx` ON `support_requests`(`binding_id`, `tenant_id`, `status`);

-- CreateIndex
CREATE INDEX `support_sessions_tenant_id_customer_id_created_at_idx` ON `support_sessions`(`tenant_id`, `customer_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `support_sessions` ADD CONSTRAINT `support_sessions_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_binding_id_tenant_id_fkey` FOREIGN KEY (`binding_id`, `tenant_id`) REFERENCES `device_bindings`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `request_refs` ADD CONSTRAINT `request_refs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `request_refs` ADD CONSTRAINT `request_refs_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `device_bindings` ADD CONSTRAINT `device_bindings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `device_bindings` ADD CONSTRAINT `device_bindings_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `device_bindings` ADD CONSTRAINT `device_bindings_first_session_id_tenant_id_fkey` FOREIGN KEY (`first_session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `device_bindings` ADD CONSTRAINT `device_bindings_last_session_id_tenant_id_fkey` FOREIGN KEY (`last_session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;




-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ELLE EKLENDİ (dba): sütun harmanlaması, STORED üretilmiş sütun, CHECK kısıtları, geri doldurma. Prisma bunları ifade
-- edemez; MySQL drift'inde karşılaştırılmaz (`migrate diff --exit-code` 0 doğrulandı). contracts zod kurallarının
-- (api/customers.ts, api/bindings.ts) DB'deki ikinci emniyetidir; değiştirirken contracts ile birlikte güncelleyin.
-- Notlar P8b ile aynı: NULL dönen CHECK geçer; enum'lar ADR-0014 ikili; utf8mb4_unicode_ci PAD SPACE → kırpılmışlık
-- CHAR_LENGTH(x) = CHAR_LENGTH(TRIM(x)); metin kuralı = contracts UNSAFE_NAME_CHARS ([\p{Cc}\p{Cf}\p{Zl}\p{Zp}]).

-- (1) customers (mimari-e10 §3.1, §3.7, §15.6).
-- Katlanmış anahtarlar ikili harmanlamada: UQ(tenant_id, name_key) ve `search_key LIKE` foldKey çıktısını AYNEN karşılaştırır
-- (ci harmanlama ayrıca harf/aksan katlayıp contracts foldKey'den farklı eşitlikler üretmesin). Prisma sütun harmanlaması
-- ifade edemediği için CREATE TABLE değil buradaki MODIFY ile (boş tablo, anlık).
ALTER TABLE `customers`
    MODIFY `name_key` VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    MODIFY `search_key` VARCHAR(400) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

ALTER TABLE `customers`
    ADD CONSTRAINT `customers_status_chk` CHECK (CAST(`status` AS BINARY) IN ('ACTIVE', 'PASSIVE')),
    -- customerFirmNameSchema: trim, 2..100 kod noktası, Cc/Cf/Zl/Zp yok.
    ADD CONSTRAINT `customers_name_chk` CHECK (
        CHAR_LENGTH(`name`) BETWEEN 2 AND 100
        AND CHAR_LENGTH(`name`) = CHAR_LENGTH(TRIM(`name`))
        AND NOT REGEXP_LIKE(`name`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c')),
    -- foldKey çıktısı boş olamaz ve kırpılmıştır; search_key = name_key + ' ' + … (ad değişip search_key yeniden
    -- hesaplanmazsa reddedilir; ikili harmanlama → tam önek eşitliği).
    ADD CONSTRAINT `customers_name_key_chk` CHECK (CHAR_LENGTH(`name_key`) >= 1 AND CHAR_LENGTH(`name_key`) = CHAR_LENGTH(TRIM(`name_key`))),
    ADD CONSTRAINT `customers_search_key_chk` CHECK (LEFT(`search_key`, CHAR_LENGTH(`name_key`)) = `name_key`),
    ADD CONSTRAINT `customers_file_label_chk` CHECK (REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}$', 'c')),
    ADD CONSTRAINT `customers_ref_fmt_chk` CHECK (REGEXP_LIKE(`request_ref`, '^[a-z2-7]{16}$', 'c')),
    -- Kişisel alanlar: boş metin saklanmaz (servis "" → NULL).
    ADD CONSTRAINT `customers_contact_name_chk` CHECK (`contact_name` IS NULL
        OR (CHAR_LENGTH(`contact_name`) BETWEEN 1 AND 80
            AND CHAR_LENGTH(`contact_name`) = CHAR_LENGTH(TRIM(`contact_name`))
            AND NOT REGEXP_LIKE(`contact_name`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    ADD CONSTRAINT `customers_phone_fmt_chk` CHECK (`phone` IS NULL OR REGEXP_LIKE(`phone`, '^[+][1-9][0-9]{7,14}$', 'c')),
    ADD CONSTRAINT `customers_email_fmt_chk` CHECK (`email` IS NULL
        OR REGEXP_LIKE(`email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c')),
    -- customerNoteSchema: 1..1000, kırpılmış; yalnız \n serbest (\t ve \r dahil diğer Cc yasak), Cf/Zl/Zp yasak.
    ADD CONSTRAINT `customers_note_chk` CHECK (`note` IS NULL
        OR (CHAR_LENGTH(`note`) BETWEEN 1 AND 1000
            AND CHAR_LENGTH(`note`) = CHAR_LENGTH(TRIM(`note`))
            AND NOT REGEXP_LIKE(`note`, '[\\x{00}-\\x{09}\\x{0B}-\\x{1F}\\x{7F}-\\x{9F}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    ADD CONSTRAINT `customers_passive_chk` CHECK ((`status` = 'PASSIVE') = (`passive_at` IS NOT NULL)),
    -- Anonimleşmiş kayıtta PII yok (AC-195). PII yazan her UPDATE (yeniden aktif + düzenleme) anonymized_at'i NULL'lamalı.
    ADD CONSTRAINT `customers_anonymized_chk` CHECK (`anonymized_at` IS NULL
        OR (`contact_name` IS NULL AND `phone` IS NULL AND `email` IS NULL AND `note` IS NULL));

-- (2) request_refs (mimari-e10 §3.2, ADR-0006 r5): append-only ad alanı.
ALTER TABLE `request_refs`
    ADD CONSTRAINT `request_refs_ref_fmt_chk` CHECK (REGEXP_LIKE(`ref`, '^[a-z2-7]{16}$', 'c'));

-- Geri doldurma: mevcut Genel ref'ler ad alanına (ref'in üretildiği an = son yenileme ya da oluşturma). İdempotent
-- (NOT EXISTS): eski sunucu kodunun çalıştığı bir pencereden sonra (Genel ref yenilemesi kayda girmemişse) aynı ifade
-- migrator ile yeniden çalıştırılabilir — docs/db-notlari.md P8c. Pre-P8c emekli Genel ref'ler hiçbir yerde
-- saklanmadığından (audit'te yalnız ilk 4 karakter) kayda alınamaz; 80 bitte yeniden üretilme olasılığı ihmal edilebilir.
INSERT INTO `request_refs` (`ref`, `tenant_id`, `customer_id`, `created_at`)
SELECT s.`request_ref`, s.`tenant_id`, NULL, COALESCE(s.`ref_rotated_at`, s.`created_at`)
FROM `tenant_request_settings` s
WHERE NOT EXISTS (SELECT 1 FROM `request_refs` r WHERE r.`ref` = s.`request_ref`);

-- (3) device_bindings (mimari-e10 §3.3, §15.2, §15.3; ADR-0017).
-- §15.3 G-E10-3: oturum başına en çok bir ETKİN kayıt. STORED üretilmiş sütun (geçersiz satırda NULL → UQ'ya girmez;
-- MySQL UQ'da çoklu NULL serbest). Prisma generated column ifade edemez → normal sütun olarak oluşturulup burada
-- dönüştürülür (boş tablo; UQ device_bindings_active_session_id_key korunur). Uygulama bu sütuna YAZMAZ (3105).
ALTER TABLE `device_bindings`
    MODIFY `active_session_id` CHAR(26) AS (IF(`revoked_at` IS NULL, `last_session_id`, NULL)) STORED;

ALTER TABLE `device_bindings`
    ADD CONSTRAINT `device_bindings_revoke_reason_chk` CHECK (`revoke_reason` IS NULL OR CAST(`revoke_reason` AS BINARY) IN
        ('FORGOTTEN', 'REPLACED', 'CUSTOMER_ROTATED', 'CUSTOMER_PASSIVE', 'GENERAL_ROTATED', 'TENANT_PASSIVE', 'EXPIRED', 'ADMIN_REVOKED')),
    -- Etkin ⇔ özet dolu ⇔ neden yok (AC-195: geçersizleşen satır özetini kaybeder).
    ADD CONSTRAINT `device_bindings_revoked_chk` CHECK (
        (`revoked_at` IS NULL) = (`key_hash` IS NOT NULL)
        AND (`revoked_at` IS NULL) = (`revoke_reason` IS NULL)),
    ADD CONSTRAINT `device_bindings_key_hash_fmt_chk` CHECK (`key_hash` IS NULL OR REGEXP_LIKE(`key_hash`, '^[0-9a-f]{64}$', 'c')),
    ADD CONSTRAINT `device_bindings_client_version_fmt_chk` CHECK (REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$', 'c')),
    ADD CONSTRAINT `device_bindings_issue_count_chk` CHECK (`issue_count` >= 1);

-- (4) support_requests.cancel_reason (§3.5, §15.2): += CUSTOMER_PASSIVE, BINDING_REVOKED. Aynı ad tek ALTER'da DROP + ADD
-- (kısıtsız ara an yok). accepted_chk değişmez: yeni nedenler yalnız PENDING talepleri kapatır (kabulcü yok).
ALTER TABLE `support_requests`
    DROP CHECK `support_requests_cancel_reason_chk`,
    ADD CONSTRAINT `support_requests_cancel_reason_chk` CHECK (`cancel_reason` IS NULL OR CAST(`cancel_reason` AS BINARY) IN
        ('CUSTOMER', 'DISCONNECTED', 'TENANT_PASSIVE', 'CUSTOMER_PASSIVE', 'BINDING_REVOKED'));

-- (5) support_sessions.customer_id: yalnız FK + indeks (Prisma kısmında). AC-177 talep = oturum müşterisi eşitliği çapraz
-- tablo CHECK'i MySQL'de yok → kabul TX'inde kopya + entegrasyon testi (mimari-e10 §3.5).
