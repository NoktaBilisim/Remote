-- P8b-1 (docs/mimari-e9.md §3 + §13 bağlayıcı, ADR-0016, ADR-0014; AC-129..160): müşteri destek talepleri.
-- Expand-only: 2 yeni tablo (tenant_request_settings, support_requests); support_sessions += request_id, guest_net_key,
-- guest_ip_key (G-E9-15), customer_email 190→254; session_consents += request_id. Mevcut satırlar NULL kalır
-- (veri taşıma yok; tenant_request_settings tembel oluşturulur — migration'da rastgele ref üretilmez).
--
-- Kilitleme notu (MySQL 8.4):
--  * CREATE TABLE (boş) → kilit yok.
--  * ADD COLUMN (NULL, varsayılansız) → INSTANT. customer_email VARCHAR(190→254): utf8mb4'te ikisi de 2 baytlık uzunluk
--    önekli (760/1016 B > 255) → INPLACE, tablo kopyalanmaz. Prisma ikisini tek ALTER'da birleştirir → INPLACE.
--  * CREATE INDEX → INPLACE, LOCK=NONE. ADD FOREIGN KEY → foreign_key_checks=1 iken COPY (support_sessions,
--    session_consents küçük; yeni sütunlar NULL → ihlal yok).
--  * ADD/DROP CHECK → COPY (support_sessions, session_consents yeniden yazılır, süresince yazma bekler). Prod kapalı
--    (P10), staging küçük → kabul. Büyük tabloda CHECK değişimi bakım penceresinde yapılır.
--  Ön kontrol (precheck) gerekmez: değişen P2/P8 CHECK'leri yalnız GENİŞLER (mevcut satırların hepsi request_id NULL →
--  yeni ifade eskisine eşdeğer); yeni CHECK'ler yalnız yeni (NULL) sütunlara/yeni tablolara bakar.
--
-- PRISMA ÜRETTİ (migrate diff --from-config-datasource --to-schema) ↓ — değiştirilmedi.

-- AlterTable
ALTER TABLE `session_consents` ADD COLUMN `request_id` CHAR(26) NULL;

-- AlterTable
ALTER TABLE `support_sessions` ADD COLUMN `guest_ip_key` VARCHAR(64) NULL,
    ADD COLUMN `guest_net_key` VARCHAR(64) NULL,
    ADD COLUMN `request_id` CHAR(26) NULL,
    MODIFY `customer_email` VARCHAR(254) NULL;

-- CreateTable
CREATE TABLE `tenant_request_settings` (
    `tenant_id` CHAR(26) NOT NULL,
    `request_ref` CHAR(16) NOT NULL,
    `ref_rotated_at` DATETIME(3) NULL,
    `file_label` VARCHAR(20) NOT NULL,
    `wait_minutes` INTEGER NOT NULL DEFAULT 30,
    `wa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `wa_recipients` JSON NOT NULL,
    `email_enabled` BOOLEAN NOT NULL DEFAULT false,
    `email_recipients` JSON NOT NULL,
    `trusted_cidrs` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_request_settings_request_ref_key`(`request_ref`),
    PRIMARY KEY (`tenant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_requests` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `cancel_reason` VARCHAR(20) NULL,
    `request_code` CHAR(6) NOT NULL,
    `secret_hash` CHAR(64) NOT NULL,
    `client_instance` CHAR(22) NOT NULL,
    `client_version` VARCHAR(20) NOT NULL,
    `customer_name` VARCHAR(80) NULL,
    `customer_phone` VARCHAR(16) NULL,
    `customer_email` VARCHAR(254) NULL,
    `description` VARCHAR(500) NULL,
    `consent_text_id` CHAR(26) NOT NULL,
    `consent_sha256` CHAR(64) NOT NULL,
    `consented_at` DATETIME(3) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `ip_key` VARCHAR(64) NULL,
    `net_key` VARCHAR(64) NULL,
    `device_hash` CHAR(64) NULL,
    `network_match` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    `known_device` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_by` CHAR(26) NULL,
    `accepted_at` DATETIME(3) NULL,
    `rejected_by` CHAR(26) NULL,
    `reject_message` VARCHAR(200) NULL,
    `closed_at` DATETIME(3) NULL,
    `anonymized_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `support_requests_secret_hash_key`(`secret_hash`),
    INDEX `support_requests_tenant_id_status_created_at_idx`(`tenant_id`, `status`, `created_at`),
    INDEX `support_requests_tenant_id_closed_at_idx`(`tenant_id`, `closed_at`),
    INDEX `support_requests_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `support_requests_tenant_id_ip_key_status_idx`(`tenant_id`, `ip_key`, `status`),
    INDEX `support_requests_tenant_id_net_key_status_idx`(`tenant_id`, `net_key`, `status`),
    INDEX `support_requests_tenant_id_client_instance_status_idx`(`tenant_id`, `client_instance`, `status`),
    INDEX `support_requests_tenant_id_device_hash_idx`(`tenant_id`, `device_hash`),
    INDEX `support_requests_tenant_id_anonymized_at_created_at_idx`(`tenant_id`, `anonymized_at`, `created_at`),
    INDEX `support_requests_consent_text_id_tenant_id_consent_sha256_idx`(`consent_text_id`, `tenant_id`, `consent_sha256`),
    INDEX `support_requests_accepted_by_idx`(`accepted_by`),
    INDEX `support_requests_rejected_by_idx`(`rejected_by`),
    UNIQUE INDEX `support_requests_id_tenant_id_key`(`id`, `tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `session_consents_request_id_tenant_id_idx` ON `session_consents`(`request_id`, `tenant_id`);

-- CreateIndex
CREATE INDEX `support_sessions_tenant_id_guest_net_key_consumed_at_idx` ON `support_sessions`(`tenant_id`, `guest_net_key`, `consumed_at`);

-- CreateIndex
CREATE INDEX `support_sessions_tenant_id_guest_ip_key_consumed_at_idx` ON `support_sessions`(`tenant_id`, `guest_ip_key`, `consumed_at`);

-- CreateIndex
CREATE UNIQUE INDEX `support_sessions_request_id_tenant_id_key` ON `support_sessions`(`request_id`, `tenant_id`);

-- AddForeignKey
ALTER TABLE `support_sessions` ADD CONSTRAINT `support_sessions_request_id_tenant_id_fkey` FOREIGN KEY (`request_id`, `tenant_id`) REFERENCES `support_requests`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `session_consents` ADD CONSTRAINT `session_consents_request_id_tenant_id_fkey` FOREIGN KEY (`request_id`, `tenant_id`) REFERENCES `support_requests`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tenant_request_settings` ADD CONSTRAINT `tenant_request_settings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_consent_text_id_tenant_id_consent_sha256_fkey` FOREIGN KEY (`consent_text_id`, `tenant_id`, `consent_sha256`) REFERENCES `consent_texts`(`id`, `tenant_id`, `sha256`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_accepted_by_fkey` FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_rejected_by_fkey` FOREIGN KEY (`rejected_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;



-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ELLE EKLENDİ (dba): CHECK kısıtları + fonksiyonel UQ. Prisma bunları ifade edemez; MySQL drift'inde karşılaştırılmaz
-- (`migrate diff --exit-code` 0 doğrulandı). zod/servis kurallarının (packages/contracts api/requests.ts) DB'deki ikinci
-- emniyetidir; değiştirirken contracts ile birlikte güncelleyin.
-- Not 1: CHECK ifadesi NULL dönerse GEÇER; NULL olabilen sütunlar `IS NULL OR …` / `IS [NOT] NULL` eşitliğiyle yazıldı.
-- Not 2: enum CHECK'leri ADR-0014 biçiminde (CAST(col AS BINARY) IN …: harf/aksan/sondaki boşluk reddi); aynı
--        tablodaki eşitlik ifadeleri (status = 'PENDING') enum CHECK değeri kanonik kıldığı için doğru kalır.
-- Not 3: utf8mb4_unicode_ci PAD SPACE → kırpılmışlık `CHAR_LENGTH(x) = CHAR_LENGTH(TRIM(x))` ile denetlenir.
-- Not 4: metin kuralı = contracts UNSAFE_NAME_CHARS ([\p{Cc}\p{Cf}\p{Zl}\p{Zp}]) reddi; açıklama tek satır (r2, G-E9-5).

-- tenant_request_settings (mimari-e9 §3.1, §13.6). JSON dizileri JSON_SCHEMA_VALID ile (MySQL ≥ 8.0.17, CHECK'te
-- kullanılabilir): tip, üst sınır, tekillik ve öğe biçimi. CIDR genişlik/özel aralık kuralı yalnız zod'da (§13.6).
ALTER TABLE `tenant_request_settings`
    ADD CONSTRAINT `tenant_request_settings_ref_fmt_chk` CHECK (REGEXP_LIKE(`request_ref`, '^[a-z2-7]{16}$', 'c')),
    ADD CONSTRAINT `tenant_request_settings_file_label_chk` CHECK (REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}$', 'c')),
    ADD CONSTRAINT `tenant_request_settings_wait_chk` CHECK (`wait_minutes` BETWEEN 10 AND 120),
    ADD CONSTRAINT `tenant_request_settings_wa_recipients_chk` CHECK (JSON_SCHEMA_VALID(
        '{"type":"array","maxItems":5,"uniqueItems":true,"items":{"type":"string","pattern":"^\\\\+[1-9][0-9]{7,14}$"}}',
        `wa_recipients`)),
    ADD CONSTRAINT `tenant_request_settings_email_recipients_chk` CHECK (JSON_SCHEMA_VALID(
        '{"type":"array","maxItems":5,"uniqueItems":true,"items":{"type":"string","minLength":3,"maxLength":254,"pattern":"^[^@\\\\s]+@[^@\\\\s]+$"}}',
        `email_recipients`)),
    ADD CONSTRAINT `tenant_request_settings_trusted_cidrs_chk` CHECK (JSON_SCHEMA_VALID(
        '{"type":"array","maxItems":10,"uniqueItems":true,"items":{"type":"string","maxLength":43,"pattern":"^[0-9A-Fa-f:.]+/[0-9]{1,3}$"}}',
        `trusted_cidrs`)),
    -- Kanal açıksa en az bir alıcı (mimari-api PUT: whatsapp.enabled=true iken ≥ 1 alıcı; e-posta P10 aynı kural).
    ADD CONSTRAINT `tenant_request_settings_wa_enabled_chk` CHECK (NOT `wa_enabled` OR JSON_LENGTH(`wa_recipients`) >= 1),
    ADD CONSTRAINT `tenant_request_settings_email_enabled_chk` CHECK (NOT `email_enabled` OR JSON_LENGTH(`email_recipients`) >= 1);

-- support_requests (mimari-e9 §3.2, §3.4 durum makinesi, §13.1, §13.3, §13.8; G-E9-15/17).
ALTER TABLE `support_requests`
    -- Enum'lar (ADR-0014 ikili).
    ADD CONSTRAINT `support_requests_status_chk` CHECK (CAST(`status` AS BINARY) IN ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'CONNECT_FAILED')),
    ADD CONSTRAINT `support_requests_cancel_reason_chk` CHECK (`cancel_reason` IS NULL OR CAST(`cancel_reason` AS BINARY) IN ('CUSTOMER', 'DISCONNECTED', 'TENANT_PASSIVE')),
    -- G-E9-15 (dba sapma: mimari-e9 §13.1 `known_network BOOL` yerine): NONE | PREFIX (yalnız /24-/48 öneki — nötr metin,
    -- ayrıcalık yok) | IP (tam ipKey eşleşmesi — rozet) | TRUSTED (güvenilen CIDR — rozet + hız/kuyruk ayrıcalığı).
    ADD CONSTRAINT `support_requests_network_match_chk` CHECK (CAST(`network_match` AS BINARY) IN ('NONE', 'PREFIX', 'IP', 'TRUSTED')),
    -- Biçimler.
    ADD CONSTRAINT `support_requests_code_fmt_chk` CHECK (REGEXP_LIKE(`request_code`, '^[0-9]{6}$', 'c')),
    ADD CONSTRAINT `support_requests_secret_hash_fmt_chk` CHECK (REGEXP_LIKE(`secret_hash`, '^[0-9a-f]{64}$', 'c')),
    ADD CONSTRAINT `support_requests_device_hash_fmt_chk` CHECK (`device_hash` IS NULL OR REGEXP_LIKE(`device_hash`, '^[0-9a-f]{64}$', 'c')),
    ADD CONSTRAINT `support_requests_client_instance_fmt_chk` CHECK (REGEXP_LIKE(`client_instance`, '^[A-Za-z0-9_-]{22}$', 'c')),
    ADD CONSTRAINT `support_requests_client_version_fmt_chk` CHECK (REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$', 'c')),
    ADD CONSTRAINT `support_requests_phone_fmt_chk` CHECK (`customer_phone` IS NULL OR REGEXP_LIKE(`customer_phone`, '^[+][1-9][0-9]{7,14}$', 'c')),
    -- E-posta yalnız iskelet (tam doğrulama zod); P8 support_sessions_customer_email_chk ile aynı.
    ADD CONSTRAINT `support_requests_email_fmt_chk` CHECK (`customer_email` IS NULL
        OR REGEXP_LIKE(`customer_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c')),
    -- Metinler (AC-134, AC-157; mimari-api customerNameSchema / descriptionSchema / rejectMessageSchema).
    ADD CONSTRAINT `support_requests_customer_name_chk` CHECK (`customer_name` IS NULL
        OR (CHAR_LENGTH(`customer_name`) BETWEEN 2 AND 80
            AND CHAR_LENGTH(`customer_name`) = CHAR_LENGTH(TRIM(`customer_name`))
            AND NOT REGEXP_LIKE(`customer_name`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    ADD CONSTRAINT `support_requests_description_chk` CHECK (`description` IS NULL
        OR (CHAR_LENGTH(`description`) BETWEEN 10 AND 500
            AND CHAR_LENGTH(`description`) = CHAR_LENGTH(TRIM(`description`))
            AND NOT REGEXP_LIKE(`description`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]| {2}', 'c'))),
    ADD CONSTRAINT `support_requests_reject_message_chk` CHECK (`reject_message` IS NULL
        OR (CHAR_LENGTH(`reject_message`) BETWEEN 5 AND 200
            AND CHAR_LENGTH(`reject_message`) = CHAR_LENGTH(TRIM(`reject_message`))
            AND NOT REGEXP_LIKE(`reject_message`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    -- Durum ↔ alan tutarlılığı (§3.4). CANCELLED ⇔ neden; PENDING ⇔ closed_at boş.
    ADD CONSTRAINT `support_requests_cancel_status_chk` CHECK ((`status` = 'CANCELLED') = (`cancel_reason` IS NOT NULL)),
    ADD CONSTRAINT `support_requests_closed_status_chk` CHECK ((`status` = 'PENDING') = (`closed_at` IS NULL)),
    -- Kabul: accepted_by ⇔ accepted_at; ACCEPTED/CONNECT_FAILED kabul edilmiştir; PENDING/EXPIRED/REJECTED edilmemiştir;
    -- CANCELLED yalnız müşteri vazgeçmesinde (§13.3 ACCEPTED → CANCELLED(CUSTOMER)) kabulcü taşır.
    ADD CONSTRAINT `support_requests_accepted_chk` CHECK (
        (`accepted_by` IS NULL) = (`accepted_at` IS NULL)
        AND (`status` NOT IN ('ACCEPTED', 'CONNECT_FAILED') OR `accepted_by` IS NOT NULL)
        AND (`status` NOT IN ('PENDING', 'EXPIRED', 'REJECTED') OR `accepted_by` IS NULL)
        AND (`status` <> 'CANCELLED' OR `accepted_by` IS NULL OR `cancel_reason` = 'CUSTOMER')),
    -- Ret: REJECTED ⇔ reddeden ⇔ mesaj (AC-157).
    ADD CONSTRAINT `support_requests_rejected_chk` CHECK (
        (`status` = 'REJECTED') = (`rejected_by` IS NOT NULL)
        AND (`status` = 'REJECTED') = (`reject_message` IS NOT NULL)),
    -- Zaman: bekleme 10..120 dk (±1 dk saat toleransı, P2 TTL kalıbı); kabul süre dolmadan; onay = talep anı (±1 dk).
    ADD CONSTRAINT `support_requests_expires_chk` CHECK (`expires_at` BETWEEN `created_at` + INTERVAL 9 MINUTE AND `created_at` + INTERVAL 121 MINUTE),
    ADD CONSTRAINT `support_requests_times_chk` CHECK (
        (`accepted_at` IS NULL OR (`accepted_at` >= `created_at` AND `accepted_at` <= `expires_at`))
        AND (`closed_at` IS NULL OR `closed_at` >= `created_at`)
        AND (`anonymized_at` IS NULL OR `anonymized_at` >= `created_at`)
        AND `consented_at` BETWEEN `created_at` - INTERVAL 1 MINUTE AND `created_at` + INTERVAL 1 MINUTE),
    -- Kişisel veri ↔ anonimleştirme (§3.6, AC-159; P5 notundaki CHECK–anonimleştirme çelişkisi baştan çözüldü):
    -- anonimleşmemiş kayıtta zorunlu alanlar dolu; anonimleşmiş kayıtta TÜM kişisel/izlenebilir alanlar NULL (yarım
    -- anonimleştirme DB'de reddedilir). request_code, network_match, known_device, consent_*, client_* kişisel değil, korunur.
    ADD CONSTRAINT `support_requests_pii_chk` CHECK (
        (`anonymized_at` IS NULL
            AND `customer_name` IS NOT NULL AND `customer_phone` IS NOT NULL AND `description` IS NOT NULL
            AND `ip` IS NOT NULL AND `ip_key` IS NOT NULL AND `net_key` IS NOT NULL)
        OR (`anonymized_at` IS NOT NULL
            AND `customer_name` IS NULL AND `customer_phone` IS NULL AND `customer_email` IS NULL AND `description` IS NULL
            AND `ip` IS NULL AND `ip_key` IS NULL AND `net_key` IS NULL AND `device_hash` IS NULL)),
    -- known_device yalnız cihaz özeti varken hesaplanabilir (anonimleştirmeden sonra bayrak korunur).
    ADD CONSTRAINT `support_requests_known_device_chk` CHECK (NOT `known_device` OR `device_hash` IS NOT NULL OR `anonymized_at` IS NOT NULL);

-- §13.1: requestCode tenant'ın BEKLEYEN talepleri arasında tekil. Fonksiyonel UQ (MySQL ≥ 8.0.13): bekleyen olmayan satırda
-- ifade NULL → UQ'ya girmez. tenant_id sabit 26 karakter → CONCAT belirsizsiz. Tek parçalı yazıldı: iki parçalı fonksiyonel
-- indeksi Prisma 7.10 içgözlemi yanlış eşliyor (UQ(id, tenant_id) için sahte drift — test edildi).
-- Çakışmada INSERT/UPDATE ER_DUP_ENTRY (Prisma P2002, index `support_requests_pending_code_uq`) → servis yeni kodla
-- yeniden dener (5 deneme; P2 active_code kalıbı).
CREATE UNIQUE INDEX `support_requests_pending_code_uq` ON `support_requests`
    ((IF(`status` = 'PENDING', CONCAT(`tenant_id`, `request_code`), NULL)));

-- support_sessions: P2 kod ve TTL CHECK'leri request_id'ye göre ayrılır (mimari-e9 §3.3); P8 müşteri adı CHECK'i talep
-- oturumunda kabul TX'indeki INSERT'e (customer_name/email talepten, §3.4 adım 3) izin verecek şekilde genişler.
-- Aynı ad tek ALTER'da DROP + ADD → kısıtsız ara an yok (ADR-0014 kalıbı).
ALTER TABLE `support_sessions`
    DROP CHECK `support_sessions_code_pending_chk`,
    DROP CHECK `support_sessions_ttl_chk`,
    DROP CHECK `support_sessions_customer_consumed_chk`,
    -- Talep oturumunun 8 haneli kodu YOK (kod/link yolu kapalı); kod yolunda P2 kuralı aynen.
    ADD CONSTRAINT `support_sessions_code_pending_chk` CHECK (
        (`request_id` IS NOT NULL AND `active_code` IS NULL)
        OR (`request_id` IS NULL AND (`status` = 'PENDING') = (`active_code` IS NOT NULL))),
    -- Kod yolu TTL 15..30 dk (±1 dk, P2); talep oturumu 60 sn bağlanma penceresi (AC-155) ±5 sn.
    ADD CONSTRAINT `support_sessions_ttl_chk` CHECK (
        (`request_id` IS NULL AND `expires_at` BETWEEN `created_at` + INTERVAL 14 MINUTE AND `created_at` + INTERVAL 31 MINUTE)
        OR (`request_id` IS NOT NULL AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) BETWEEN 55 AND 65)),
    -- Kod yolunda müşteri adı admit'te yazılır (P8); talep oturumunda kabul INSERT'inde (PENDING iken) talepten gelir.
    ADD CONSTRAINT `support_sessions_customer_consumed_chk` CHECK (`customer_name` IS NULL OR `consumed_at` IS NOT NULL OR `request_id` IS NOT NULL),
    -- Talep yalnız Windows istemcisinden gelir (ADR-0016): talep oturumu BROWSER modunda admit edilemez.
    ADD CONSTRAINT `support_sessions_request_mode_chk` CHECK (`request_id` IS NULL OR `mode` IS NULL OR `mode` = 'AGENT'),
    -- Misafir ağ anahtarları admit UPDATE'inde birlikte yazılır, retention'da birlikte NULL'lanır (§13.1, G-E9-15).
    ADD CONSTRAINT `support_sessions_guest_keys_chk` CHECK (
        (`guest_net_key` IS NULL) = (`guest_ip_key` IS NULL)
        AND (`guest_net_key` IS NULL OR `consumed_at` IS NOT NULL));

-- session_consents.request_id (§13.3): talep oturumunun "Ekranımı paylaş" onayı — yalnız görüntüleme izninin verilmesi.
ALTER TABLE `session_consents`
    ADD CONSTRAINT `session_consents_request_scope_chk` CHECK (`request_id` IS NULL OR (`level` = 'VIEW' AND `decision` = 'GRANTED'));
