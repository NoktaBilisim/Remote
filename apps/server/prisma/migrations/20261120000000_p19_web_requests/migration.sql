-- P19 G6-b web talep formu, SMS ayarı, müşteri durum bildirimi kuyruğu (docs/mimari-e11.md §8c.1; AC-259, 260, 261;
-- S-P19-12, S-P19-T5, B2). Ayrıntı ve gerekçeler: docs/db-notlari.md "P19". Veri taşıma YOK: eski talepler `source='AGENT'`
-- (client_version dolu kalır), bildirim bayrakları 0; firma ayarlarında web formu ve bildirim kanalları kapalı; SMS ayarı boş.
-- Yeni tablo `notification_outbox` → prisma/sql/grants.sql (SELECT/INSERT/UPDATE/DELETE).
--
-- ELLE YAZILDI / ELLE EKLENDİ (dba): Prisma CHECK ve ALGORITHM yan tümcesi üretmez. Prisma'nın ürettiği kısımlar (sütunlar,
-- CREATE TABLE, FK'ler, indeksler) `migrate diff` çıktısıyla aynı ad/tiple yazıldı; support_requests'te Prisma'nın tek
-- ALTER'ı (ADD COLUMN + MODIFY) ikiye bölündü: ADD COLUMN → INSTANT, MODIFY client_version NULL → CHECK'lerle aynı ALTER.
-- Sonrasında `migrate diff --exit-code` = 0 (drift yok).
--
-- Sapmalar (db-notlari "P19"; mimari §8c.1'e not düşüldü):
--  * UQ(request_id, tenant_id, kind, channel) — mimarideki UQ(request_id, kind, channel) bileşik FK (request_id, tenant_id)'yi
--    karşılamaz (MySQL FK sütunlarının indeksin İLK sütunları olmasını ister; aksi hâlde gizli ek indeks açar). request_id
--    zaten tekil olduğundan tekillik anlamı aynıdır.
--  * client_version NULL'a çevirme mimaride "INPLACE, ayrı ALTER"; ancak CHECK eklemek MySQL 8.4'te yalnız COPY'dir (ölçüldü:
--    INPLACE/INSTANT → 1845). Ayrı INPLACE + COPY iki yeniden yazım olurdu → MODIFY, CHECK'lerle TEK COPY ALTER'da.
--  * Ek CHECK'ler (mimaride yok, daraltma): outbox SENT ⇔ sent_at, FAILED ⇒ last_reason, last_reason sınıflandırılmış kod
--    biçimi (ham hata metni yazılamaz), attempts 0..3, şifreli alanların en az başlık uzunluğu; sms_url'de kontrol karakteri.
--
-- Kilit (MySQL 8.4):
--  * ADD COLUMN (sonda; NOT NULL DEFAULT sabit / NULL) → INSTANT (3 tablo).
--  * CHECK eklemeleri → COPY: support_requests (MODIFY + 2 CHECK tek ALTER, tek yeniden yazım; talep tablosu retention'lı ve
--    küçük — süre db-notlari'nda), tenant_settings (küçük). Migrate, server'dan önce `migrate` servisinde çalışır.
--  * notification_outbox yeni (boş) tablo → kilit yok.
--  * Tetikleyici / saklı yordam YOK → toplam 23 kalır (deploy/backup/lib.sh REMOTE_EXPECTED_TRIGGERS=23 değişmez); firma
--    silme adım listesi değişmez (outbox MESSAGES adımına parça) → ön kontrol gerekmez.

-- 1) support_requests: kaynak + müşterinin seçtiği bildirim kanalları (AC-259, 261). PRISMA ÜRETTİ + ALGORITHM ELLE.
ALTER TABLE `support_requests` ADD COLUMN `notify_email` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notify_sms` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notify_whatsapp` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'AGENT',
    ALGORITHM=INSTANT;
-- PRISMA ÜRETTİ (MODIFY) + ELLE CHECK'ler, tek ALTER (COPY bir kez). source ikili enum (ADR-0014); WEB ⇔ client_version NULL
-- (S-P19-13: sürüm kuralı source'a bağlı; mevcut biçim CHECK'i NULL'da geçer). Eski satırlar AGENT + dolu sürüm → geçer.
ALTER TABLE `support_requests`
    MODIFY `client_version` VARCHAR(20) NULL,
    ADD CONSTRAINT `support_requests_source_chk` CHECK (CAST(`source` AS BINARY) IN ('AGENT', 'WEB')),
    ADD CONSTRAINT `support_requests_source_version_chk` CHECK ((CAST(`source` AS BINARY) = 'WEB') = (`client_version` IS NULL)),
    ALGORITHM=COPY;

-- 2) tenant_request_settings: web formu anahtarı + firma bildirim kanalları (AC-259, 261). PRISMA ÜRETTİ + ALGORITHM ELLE.
ALTER TABLE `tenant_request_settings` ADD COLUMN `notify_email_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notify_sms_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notify_whatsapp_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `web_form_enabled` BOOLEAN NOT NULL DEFAULT false,
    ALGORITHM=INSTANT;

-- 3) tenant_settings: smsportal ayarı (AC-260; ortak standart §2.3). PRISMA ÜRETTİ + ALGORITHM ELLE.
ALTER TABLE `tenant_settings` ADD COLUMN `sms_api_key_enc` VARBINARY(512) NULL,
    ADD COLUMN `sms_header` VARCHAR(11) NULL,
    ADD COLUMN `sms_url` VARCHAR(255) NULL,
    ALGORITHM=INSTANT;
-- ELLE: S-P19-T5 — sms_url yalnız köken + yol: userinfo (`@`), sorgu (`?`), parça (`#`), boşluk ve kontrol karakteri reddedilir
-- (anahtar URL'ye gömülüp loglara/ekrana düşmesin; zod `serviceUrlSchema` birinci hat). Şema harfi büyük/küçük serbest ('i').
-- sms_header NetGSM başlığı (≤ 11). Şifreli anahtar en az lib/crypto başlığı (ver 1 + iv 12 + tag 16) + 1 bayt.
ALTER TABLE `tenant_settings`
    ADD CONSTRAINT `tenant_settings_sms_url_chk` CHECK (`sms_url` IS NULL
        OR REGEXP_LIKE(`sms_url`, '^https?://[^\\s/?#@\\p{Cc}]{1,253}(/[^\\s?#@\\p{Cc}]*)?\\z', 'i')),
    ADD CONSTRAINT `tenant_settings_sms_header_chk` CHECK (`sms_header` IS NULL
        OR REGEXP_LIKE(`sms_header`, '^[A-Za-z0-9 .-]{1,11}\\z', 'c')),
    ADD CONSTRAINT `tenant_settings_sms_api_key_enc_chk` CHECK (`sms_api_key_enc` IS NULL OR LENGTH(`sms_api_key_enc`) > 29);

-- 4) notification_outbox (AC-261; S-P19-12). PRISMA ÜRETTİ (CREATE + FK + indeksler).
CREATE TABLE `notification_outbox` (
    `id` CHAR(26) NOT NULL,
    `tenant_id` CHAR(26) NOT NULL,
    `request_id` CHAR(26) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `recipient_enc` VARBINARY(600) NULL,
    `recipient_mask` VARCHAR(64) NOT NULL,
    `recipient_hash` CHAR(64) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `next_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_reason` VARCHAR(30) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_outbox_state_next_at_idx`(`state`, `next_at`),
    INDEX `notification_outbox_recipient_hash_created_at_idx`(`recipient_hash`, `created_at`),
    INDEX `notification_outbox_tenant_id_channel_created_at_idx`(`tenant_id`, `channel`, `created_at`),
    UNIQUE INDEX `notification_outbox_request_id_tenant_id_kind_channel_key`(`request_id`, `tenant_id`, `kind`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notification_outbox` ADD CONSTRAINT `notification_outbox_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `notification_outbox` ADD CONSTRAINT `notification_outbox_request_id_tenant_id_fkey` FOREIGN KEY (`request_id`, `tenant_id`) REFERENCES `support_requests`(`id`, `tenant_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE: CHECK'ler. Enum'lar ikili (ADR-0014). recipient_hash küçük harf hex (HMAC-SHA256; NULL'lanmaz, NOT NULL). Son durumda
-- (SENT/FAILED) alıcı şifreli metni NULL, aksi hâlde dolu (gönderilecek alıcı yoksa satır PENDING olamaz). SENT ⇔ sent_at;
-- FAILED ⇒ sınıflandırılmış neden. last_reason yalnız kod (`rate_limited`, `unconfigured`, `unreachable` …); ham hata metni
-- (boşluk, büyük harf, noktalama) DB'ye yazılamaz.
ALTER TABLE `notification_outbox`
    ADD CONSTRAINT `notification_outbox_kind_chk` CHECK (CAST(`kind` AS BINARY) IN ('REQ_ACCEPTED', 'REQ_REJECTED', 'REQ_EXPIRED')),
    ADD CONSTRAINT `notification_outbox_channel_chk` CHECK (CAST(`channel` AS BINARY) IN ('SMS', 'WHATSAPP', 'EMAIL')),
    ADD CONSTRAINT `notification_outbox_state_chk` CHECK (CAST(`state` AS BINARY) IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
    ADD CONSTRAINT `notification_outbox_attempts_chk` CHECK (`attempts` <= 3),
    ADD CONSTRAINT `notification_outbox_recipient_hash_chk` CHECK (REGEXP_LIKE(`recipient_hash`, '^[0-9a-f]{64}\\z', 'c')),
    ADD CONSTRAINT `notification_outbox_recipient_enc_chk` CHECK (
        (CAST(`state` AS BINARY) IN ('SENT', 'FAILED')) = (`recipient_enc` IS NULL)
        AND (`recipient_enc` IS NULL OR LENGTH(`recipient_enc`) > 29)),
    ADD CONSTRAINT `notification_outbox_sent_chk` CHECK ((CAST(`state` AS BINARY) = 'SENT') = (`sent_at` IS NOT NULL)),
    ADD CONSTRAINT `notification_outbox_last_reason_chk` CHECK (
        (`last_reason` IS NULL OR REGEXP_LIKE(`last_reason`, '^[a-z][a-z0-9_]{0,29}\\z', 'c'))
        AND (CAST(`state` AS BINARY) <> 'FAILED' OR `last_reason` IS NOT NULL)),
    ADD CONSTRAINT `notification_outbox_recipient_mask_chk` CHECK (CHAR_LENGTH(`recipient_mask`) >= 1
        AND NOT REGEXP_LIKE(`recipient_mask`, '[\\p{Cc}\\p{Cf}]'));
