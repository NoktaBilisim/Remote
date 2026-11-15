-- P27-K0 gözetimsiz erişim veri modeli (docs/mimari-p27.md §3 r2/r3, §9 K0, §15; AC-273, 275, 293, 296, 297, 336, 337;
-- K-P27-9/10/14/17; R-P27-5). Ayrıntı ve gerekçeler: docs/db-notlari.md "P27". Veri taşıma YOK: yeni tablolar boş; mevcut
-- oturum/onay/outbox satırları yeni CHECK'leri olduğu gibi geçer (device_id/session_id/event_id NULL, request_id dolu).
-- Yeni tablolar → prisma/sql/grants.sql. Tetikleyici / saklı yordam YOK → toplam 23 kalır (REMOTE_EXPECTED_TRIGGERS değişmez).
--
-- AD: mimari `20261121000000_p27_unattended` diyor; bu damga P27a'da kullanıldı → `20261121010000` (implementation.md "P27-K0").
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK ve ALGORITHM yan tümcesi üretmez. Prisma'nın ürettiği kısımlar (sütunlar,
-- CREATE TABLE, indeksler, FK'ler) `migrate diff` çıktısıyla aynı ad/tiple yazıldı. Yeni tabloların CHECK'leri CREATE'e gömüldü
-- (boş tabloda ayrı ALTER gereksiz). Mevcut üç tabloda Prisma'nın ayrı ALTER/CREATE INDEX/ADD FK ifadeleri R-P27-5 gereği
-- tablo başına TEK COPY ALTER'da birleştirildi (her biri ayrı yeniden yazım olurdu). Sonrasında `migrate diff --exit-code` = 0.
--
-- Sapmalar / daraltmalar (db-notlari "P27"):
--  * grants UQ(device_id, tenant_id, user_id) (mimari UQ(device_id, user_id)): bileşik device FK'nin öneki olmalı; device_id
--    tenant'ı belirlediğinden tekillik anlamı aynı. user FK bileşik (user_id, tenant_id) → users(id, tenant_id): grant alan
--    kullanıcı cihazın firmasında; Super Admin (tenant NULL) grant alamaz (K-P27-9 DB'de). IX(user_id, tenant_id) + IX(tenant_id).
--  * contacts UQ(tenant_id, customer_id, email) ve codes IX(tenant_id, customer_id): customers bileşik hedefi (tenant_id, id)
--    sırasında (P8c karar 1). codes'a UQ(device_id, tenant_id) (bir cihaz tek kodla kaydolur + device FK).
--  * registered_by / revoked_by / codes.created_by / grants.created_by tekil FK users(id): Super Admin tenant geçişiyle
--    `manage` yapabilir (users.tenant_id NULL) → bileşik FK onu reddederdi.
--  * support_sessions: P8b'nin talep yolu kuralları cihaz oturumuna genişletildi (kod yok, 60 sn ±5 penceresi, customer_name
--    PENDING INSERT'te = cihaz adı, adın en az uzunluğu cihazda 1 — deviceTextSchema 1..64). Anonimleşmiş oturumda device_id
--    NULL (anonymized_chk += device_id; §3.5 "anonimleştirme device_id = NULL yazar"); bu yüzden TTL CHECK anonim satırda
--    device_id'siz 60 sn penceresini kabul eder.
--  * outbox: kind ↔ çapa CHECK'i (REQ_* ⇔ request_id, UNATTENDED_STARTED ⇔ session_id, UN_* ⇔ event_id); event_id ULID biçimi.
--  * Ek CHECK'ler: cihaz metinleri, public_key 32 bayt, semver, sha hex, revoke üçlüsü, iptalde last_ip NULL; kod hash'i hex,
--    TTL ≤ 24 sa + 1 dk; e-posta iskeleti `\z`, telefon E.164.
--
-- Kilit (MySQL 8.4):
--  * 4 yeni (boş) tablo → kilit yok.
--  * support_sessions: ADD COLUMN device_id (sonda, NULL) INSTANT; sonra TEK COPY ALTER (indeks + FK + 3 DROP/ADD + 4 yeni
--    CHECK + mode/anonymized/customer_name CHECK'leri) — tablo yeniden yazılır, süresince oturum yazımı bekler.
--  * session_consents: source_chk DROP+ADD → COPY (tek ALTER).
--  * notification_outbox: MODIFY request_id NULL + 2 sütun + 2 UQ + FK + CHECK'ler → TEK COPY ALTER (7 gün temizlikle küçük).
--  * Bakım penceresi + süre ölçümü: db-notlari "P27" (R-P27-5). Ön kontrol gerekmez (CHECK'ler yalnız genişler ya da yeni
--    NULL sütunlara bakar; mevcut satırlar geçer — temiz kurulumda ve P19 fikstürüyle doğrulandı).
-- Geri alma: down.sql (elle; Prisma çalıştırmaz).

-- 1) unattended_devices (§3.1 + r2). PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `unattended_devices` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `customer_id` CHAR(26) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `public_key` VARBINARY(32) NOT NULL,
    `os_version` VARCHAR(64) NOT NULL,
    `agent_version` VARCHAR(20) NOT NULL,
    `binary_sha256` CHAR(64) NOT NULL,
    `signed` BOOLEAN NOT NULL,
    `local_enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_seen_at` DATETIME(3) NULL,
    `last_ip` VARCHAR(45) NULL,
    `registered_ip` VARCHAR(45) NOT NULL,
    `registered_by` CHAR(26) NULL,
    `verified_at` DATETIME(3) NULL,
    `notify_failed_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by` CHAR(26) NULL,
    `revoke_reason` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `unattended_devices_public_key_key`(`public_key`),
    INDEX `unattended_devices_tenant_id_revoked_at_name_idx`(`tenant_id`, `revoked_at`, `name`),
    INDEX `unattended_devices_tenant_id_customer_id_revoked_at_idx`(`tenant_id`, `customer_id`, `revoked_at`),
    INDEX `unattended_devices_revoked_at_idx`(`revoked_at`),
    INDEX `unattended_devices_registered_by_idx`(`registered_by`),
    INDEX `unattended_devices_revoked_by_idx`(`revoked_by`),
    UNIQUE INDEX `unattended_devices_id_tenant_id_key`(`id`, `tenant_id`),
    PRIMARY KEY (`id`),
    -- ELLE: contracts deviceTextSchema (1..64, kırpılmış, UNSAFE_NAME_CHARS = Cc/Cf/Zl/Zp/U+034F/U+180E yok). PAD SPACE
    -- harmanlaması yüzünden kırpılmışlık CHAR_LENGTH ile (P8 notu 2).
    CONSTRAINT `unattended_devices_name_chk` CHECK (CHAR_LENGTH(`name`) BETWEEN 1 AND 64
        AND CHAR_LENGTH(`name`) = CHAR_LENGTH(TRIM(`name`))
        AND NOT REGEXP_LIKE(`name`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\x{034F}\\x{180E}]', 'c')),
    CONSTRAINT `unattended_devices_os_version_chk` CHECK (CHAR_LENGTH(`os_version`) BETWEEN 1 AND 64
        AND CHAR_LENGTH(`os_version`) = CHAR_LENGTH(TRIM(`os_version`))
        AND NOT REGEXP_LIKE(`os_version`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\x{034F}\\x{180E}]', 'c')),
    CONSTRAINT `unattended_devices_public_key_chk` CHECK (LENGTH(`public_key`) = 32),
    CONSTRAINT `unattended_devices_agent_version_chk` CHECK (REGEXP_LIKE(`agent_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}\\z', 'c')),
    CONSTRAINT `unattended_devices_binary_sha256_chk` CHECK (REGEXP_LIKE(`binary_sha256`, '^[0-9a-f]{64}\\z', 'c')),
    CONSTRAINT `unattended_devices_revoke_reason_chk` CHECK (`revoke_reason` IS NULL
        OR CAST(`revoke_reason` AS BINARY) IN ('ADMIN', 'UNINSTALLED', 'CUSTOMER_PASSIVE')),
    -- ELLE: iptal üçlüsü — revoked_at ⇔ reason; revoked_by yalnız ADMIN'de (kullanıcı silmede NULL'lanabilir → zorunlu değil);
    -- iptalde son IP anonimleşir (§3.1).
    CONSTRAINT `unattended_devices_revoked_chk` CHECK ((`revoked_at` IS NULL) = (`revoke_reason` IS NULL)
        AND (`revoked_by` IS NULL OR CAST(`revoke_reason` AS BINARY) = 'ADMIN')
        AND (`revoked_at` IS NULL OR `last_ip` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) unattended_device_grants (§3.2). PRISMA ÜRETTİ (append/delete; updated_at yok).
CREATE TABLE `unattended_device_grants` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `device_id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `created_by` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `unattended_device_grants_user_id_tenant_id_idx`(`user_id`, `tenant_id`),
    INDEX `unattended_device_grants_tenant_id_idx`(`tenant_id`),
    INDEX `unattended_device_grants_created_by_idx`(`created_by`),
    UNIQUE INDEX `unattended_device_grants_device_id_tenant_id_user_id_key`(`device_id`, `tenant_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3) unattended_registration_codes (§3.3). PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `unattended_registration_codes` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `customer_id` CHAR(26) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `created_by` CHAR(26) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `device_id` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `unattended_registration_codes_code_hash_key`(`code_hash`),
    INDEX `unattended_registration_codes_tenant_id_used_at_expires_at_idx`(`tenant_id`, `used_at`, `expires_at`),
    INDEX `unattended_registration_codes_tenant_id_customer_id_idx`(`tenant_id`, `customer_id`),
    INDEX `unattended_registration_codes_expires_at_idx`(`expires_at`),
    INDEX `unattended_registration_codes_created_by_idx`(`created_by`),
    UNIQUE INDEX `unattended_registration_codes_device_id_tenant_id_key`(`device_id`, `tenant_id`),
    PRIMARY KEY (`id`),
    -- ELLE: düz kod yazılamasın (yalnız HMAC hex, küçük harf).
    CONSTRAINT `unattended_registration_codes_code_hash_chk` CHECK (REGEXP_LIKE(`code_hash`, '^[0-9a-f]{64}\\z', 'c')),
    -- ELLE (§3.3): tüketim = used_at + device_id birlikte.
    CONSTRAINT `unattended_registration_codes_used_chk` CHECK ((`used_at` IS NULL) = (`device_id` IS NULL)),
    -- ELLE: 24 sa sabit (+1 dk uygulama/DB saat farkı; password_reset_tokens kalıbı); süre uzatılamaz.
    CONSTRAINT `unattended_registration_codes_ttl_chk` CHECK (`expires_at` > `created_at`
        AND `expires_at` <= `created_at` + INTERVAL 24 HOUR + INTERVAL 1 MINUTE)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4) customer_notify_contacts (§3.4). PRISMA ÜRETTİ + CHECK'ler ELLE.
CREATE TABLE `customer_notify_contacts` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `customer_id` CHAR(26) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `phone` VARCHAR(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_notify_contacts_tenant_id_customer_id_email_key`(`tenant_id`, `customer_id`, `email`),
    PRIMARY KEY (`id`),
    -- ELLE: P15 e-posta iskeleti (`\z`; tam doğrulama zod) ve E.164 (customers_phone_fmt_chk ile aynı).
    CONSTRAINT `customer_notify_contacts_email_chk` CHECK (
        REGEXP_LIKE(`email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+\\z', 'c')),
    CONSTRAINT `customer_notify_contacts_phone_chk` CHECK (`phone` IS NULL OR REGEXP_LIKE(`phone`, '^[+][1-9][0-9]{7,14}\\z', 'c'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (PRISMA ÜRETTİ) — yeni tablolar (boş; kilit yok).
ALTER TABLE `unattended_devices` ADD CONSTRAINT `unattended_devices_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_devices` ADD CONSTRAINT `unattended_devices_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_devices` ADD CONSTRAINT `unattended_devices_registered_by_fkey` FOREIGN KEY (`registered_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_devices` ADD CONSTRAINT `unattended_devices_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_device_grants` ADD CONSTRAINT `unattended_device_grants_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_device_grants` ADD CONSTRAINT `unattended_device_grants_device_id_tenant_id_fkey` FOREIGN KEY (`device_id`, `tenant_id`) REFERENCES `unattended_devices`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_device_grants` ADD CONSTRAINT `unattended_device_grants_user_id_tenant_id_fkey` FOREIGN KEY (`user_id`, `tenant_id`) REFERENCES `users`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_device_grants` ADD CONSTRAINT `unattended_device_grants_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_registration_codes` ADD CONSTRAINT `unattended_registration_codes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_registration_codes` ADD CONSTRAINT `unattended_registration_codes_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_registration_codes` ADD CONSTRAINT `unattended_registration_codes_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `unattended_registration_codes` ADD CONSTRAINT `unattended_registration_codes_device_id_tenant_id_fkey` FOREIGN KEY (`device_id`, `tenant_id`) REFERENCES `unattended_devices`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `customer_notify_contacts` ADD CONSTRAINT `customer_notify_contacts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `customer_notify_contacts` ADD CONSTRAINT `customer_notify_contacts_tenant_id_customer_id_fkey` FOREIGN KEY (`tenant_id`, `customer_id`) REFERENCES `customers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 5) support_sessions (§3.5). PRISMA ÜRETTİ (sütun) + ALGORITHM ELLE.
ALTER TABLE `support_sessions` ADD COLUMN `device_id` CHAR(26) NULL, ALGORITHM=INSTANT;
-- PRISMA ÜRETTİ (CREATE INDEX + ADD FK) + ELLE CHECK'ler — TEK COPY ALTER (R-P27-5). Aynı ad DROP + ADD aynı ALTER'da →
-- kısıtsız ara an yok (ADR-0014 kalıbı). status/mode değerleri kendi ikili CHECK'leriyle kanonik → burada CAST gerekmez.
ALTER TABLE `support_sessions`
    ADD INDEX `support_sessions_device_id_tenant_id_idx`(`device_id`, `tenant_id`),
    ADD CONSTRAINT `support_sessions_device_id_tenant_id_fkey` FOREIGN KEY (`device_id`, `tenant_id`) REFERENCES `unattended_devices`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
    DROP CHECK `support_sessions_mode_chk`,
    DROP CHECK `support_sessions_code_pending_chk`,
    DROP CHECK `support_sessions_ttl_chk`,
    DROP CHECK `support_sessions_customer_consumed_chk`,
    DROP CHECK `support_sessions_customer_name_chk`,
    DROP CHECK `support_sessions_anonymized_chk`,
    ADD CONSTRAINT `support_sessions_mode_chk` CHECK (`mode` IS NULL OR CAST(`mode` AS BINARY) IN ('AGENT', 'BROWSER', 'UNATTENDED')),
    -- Talep ve cihaz oturumunun 8 haneli kodu YOK; kod yolunda P2 kuralı aynen.
    ADD CONSTRAINT `support_sessions_code_pending_chk` CHECK (
        ((`request_id` IS NOT NULL OR `device_id` IS NOT NULL) AND `active_code` IS NULL)
        OR (`request_id` IS NULL AND `device_id` IS NULL AND (`status` = 'PENDING') = (`active_code` IS NOT NULL))),
    -- Kod yolu 15..30 dk (±1 dk); talep/cihaz oturumu 60 sn (±5). Anonimleşmiş cihaz oturumunda device_id NULL'dır → 60 sn
    -- penceresi anonim satırda da geçerli (expires_at anonimleştirmede değişmez).
    ADD CONSTRAINT `support_sessions_ttl_chk` CHECK (
        (`request_id` IS NULL AND `device_id` IS NULL
            AND `expires_at` BETWEEN `created_at` + INTERVAL 14 MINUTE AND `created_at` + INTERVAL 31 MINUTE)
        OR ((`request_id` IS NOT NULL OR `device_id` IS NOT NULL OR `anonymized_at` IS NOT NULL)
            AND TIMESTAMPDIFF(SECOND, `created_at`, `expires_at`) BETWEEN 55 AND 65)),
    -- Cihaz oturumunda customer_name = cihaz adı, PENDING INSERT'inde yazılır (§3.5).
    ADD CONSTRAINT `support_sessions_customer_consumed_chk` CHECK (`customer_name` IS NULL OR `consumed_at` IS NOT NULL
        OR `request_id` IS NOT NULL OR `device_id` IS NOT NULL),
    -- P8 kuralı; cihaz adı 1 karakter olabilir (deviceTextSchema 1..64) → cihaz oturumunda alt sınır 1.
    ADD CONSTRAINT `support_sessions_customer_name_chk` CHECK (
        `customer_name` IS NULL
        OR (CHAR_LENGTH(`customer_name`) BETWEEN IF(`device_id` IS NULL, 2, 1) AND 100
            AND CHAR_LENGTH(`customer_name`) = CHAR_LENGTH(TRIM(`customer_name`))
            AND NOT REGEXP_LIKE(`customer_name`, '[\\p{Cc}\\p{Cf}]', 'c'))),
    -- P13a kuralı + anonim oturum cihaza bağlı kalmaz (device_id NULL → cihaz satırı silinebilir).
    ADD CONSTRAINT `support_sessions_anonymized_chk` CHECK (`anonymized_at` IS NULL
        OR (`status` IN ('ENDED', 'EXPIRED', 'CANCELLED')
            AND `customer_name` IS NULL AND `customer_email` IS NULL AND `note` IS NULL
            AND `guest_net_key` IS NULL AND `guest_ip_key` IS NULL AND `device_id` IS NULL)),
    -- §3.5 yeni CHECK'ler: oturum ya talepten ya cihazdan; cihaz oturumu yalnız UNATTENDED admit edilir; UNATTENDED modu
    -- cihaz ister (anonimleşmiş satır hariç).
    ADD CONSTRAINT `support_sessions_device_request_chk` CHECK (`device_id` IS NULL OR `request_id` IS NULL),
    ADD CONSTRAINT `support_sessions_device_mode_chk` CHECK (`device_id` IS NULL OR `mode` IS NULL OR `mode` = 'UNATTENDED'),
    ADD CONSTRAINT `support_sessions_unattended_device_chk` CHECK (`mode` IS NULL OR `mode` <> 'UNATTENDED'
        OR `device_id` IS NOT NULL OR `anonymized_at` IS NOT NULL),
    ALGORITHM=COPY;

-- 6) session_consents.source += UNATTENDED (§3.5). ELLE — COPY.
ALTER TABLE `session_consents`
    DROP CHECK `session_consents_source_chk`,
    ADD CONSTRAINT `session_consents_source_chk` CHECK (CAST(`source` AS BINARY) IN ('UI', 'HOTKEY', 'RECONNECT', 'SYSTEM', 'TECH', 'UNATTENDED')),
    ALGORITHM=COPY;

-- 7) notification_outbox (§3.5 r2, K-P27-14). PRISMA ÜRETTİ (sütunlar, MODIFY, 2 UQ, FK) + ELLE CHECK'ler — TEK COPY ALTER.
ALTER TABLE `notification_outbox`
    ADD COLUMN `event_id` CHAR(26) NULL,
    ADD COLUMN `session_id` CHAR(26) NULL,
    MODIFY `request_id` CHAR(26) NULL,
    ADD UNIQUE INDEX `notification_outbox_session_id_tenant_id_kind_channel_recipi_key`(`session_id`, `tenant_id`, `kind`, `channel`, `recipient_hash`),
    ADD UNIQUE INDEX `notification_outbox_event_id_tenant_id_kind_channel_recipien_key`(`event_id`, `tenant_id`, `kind`, `channel`, `recipient_hash`),
    ADD CONSTRAINT `notification_outbox_session_id_tenant_id_fkey` FOREIGN KEY (`session_id`, `tenant_id`) REFERENCES `support_sessions`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
    DROP CHECK `notification_outbox_kind_chk`,
    ADD CONSTRAINT `notification_outbox_kind_chk` CHECK (CAST(`kind` AS BINARY) IN ('REQ_ACCEPTED', 'REQ_REJECTED', 'REQ_EXPIRED',
        'UNATTENDED_STARTED', 'UN_CONTACTS_CHANGED', 'UN_DEVICE_REGISTERED')),
    -- §3.5: tam olarak bir çapa.
    ADD CONSTRAINT `notification_outbox_anchor_chk` CHECK (
        (`request_id` IS NOT NULL) + (`session_id` IS NOT NULL) + (`event_id` IS NOT NULL) = 1),
    -- ELLE (daraltma): tür ↔ çapa. Talep türü talebe, UNATTENDED_STARTED oturuma, UN_* olaya bağlı. Kümede olmayan tür bu
    -- CHECK'ten muaf (yalnız kind_chk adıyla reddedilsin — hata adı tutarlı).
    ADD CONSTRAINT `notification_outbox_kind_anchor_chk` CHECK (
        CAST(`kind` AS BINARY) NOT IN ('REQ_ACCEPTED', 'REQ_REJECTED', 'REQ_EXPIRED',
            'UNATTENDED_STARTED', 'UN_CONTACTS_CHANGED', 'UN_DEVICE_REGISTERED')
        OR ((CAST(`kind` AS BINARY) IN ('REQ_ACCEPTED', 'REQ_REJECTED', 'REQ_EXPIRED')) = (`request_id` IS NOT NULL)
            AND (CAST(`kind` AS BINARY) = 'UNATTENDED_STARTED') = (`session_id` IS NOT NULL)
            AND (CAST(`kind` AS BINARY) IN ('UN_CONTACTS_CHANGED', 'UN_DEVICE_REGISTERED')) = (`event_id` IS NOT NULL))),
    ADD CONSTRAINT `notification_outbox_event_id_chk` CHECK (`event_id` IS NULL
        OR REGEXP_LIKE(`event_id`, '^[0-9A-HJKMNP-TV-Z]{26}\\z', 'c')),
    ALGORITHM=COPY;
