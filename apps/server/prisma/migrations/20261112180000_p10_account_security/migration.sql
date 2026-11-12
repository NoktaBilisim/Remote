-- P10 hesap güvenliği + SMTP (docs/mimari.md §3.1, §5.1, §10 P10; AC-10, 65, 66, 67, 68, 78, 79, 80, 115, 122, 151).
-- Expand-only: 2 yeni tablo (recovery_codes, password_reset_tokens); users += totp_last_step; tenant_settings SMTP
-- alanları ve users TOTP alanları (P1'den beri var, P10'a kadar yazılmadı) için CHECK'ler. Veri taşıma YOK.
-- Mevcut alanlar yeterli olduğu için eklenmeyenler: users.totp_secret_enc/totp_enabled/locked_until/failed_*,
-- auth_sessions.last_seen_at/expires_at/revoked_at/mfa_passed, tenant_settings.smtp_*/require_tech_2fa,
-- tenant_request_settings.email_enabled/email_recipients (AC-151) — docs/db-notlari.md P10.
--
-- Kilitleme notu (MySQL 8.4):
--  * CREATE TABLE (boş) + FK → kilit yok (yeni tablo).
--  * users ADD COLUMN (NULL, varsayılansız) → INSTANT.
--  * users / tenant_settings ADD CHECK → ALGORITHM=COPY (tablo yeniden yazılır, süresince yazma bekler). İki tablo
--    küçük (tenant ve kullanıcı sayısı kadar satır), prod henüz kapalı (prod açılışı P10 sonrası) → kabul.
--
-- Ön kontrol (ELLE EKLENDİ — Prisma CHECK üretmez): yeni CHECK'leri ihlal eden mevcut satır varsa geçici tablo CHECK'i
-- 3819 (`p10_up_guard_chk`) ile HİÇBİR ŞEY DEĞİŞMEDEN durur (MySQL DDL transaction'sız; kısmi uygulama olmasın diye
-- ilk ifade). P10 öncesi kod smtp_* / totp_* alanlarını hiç yazmadığından beklenen sayı 0'dır.
CREATE TEMPORARY TABLE `p10_up_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p10_up_guard_chk` CHECK (`n` = 0));
INSERT INTO `p10_up_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `tenant_settings` WHERE `smtp_host` IS NOT NULL OR `smtp_port` IS NOT NULL
            OR `smtp_security` IS NOT NULL OR `smtp_user` IS NOT NULL OR `smtp_pass_enc` IS NOT NULL
            OR `smtp_from_name` IS NOT NULL OR `smtp_from_email` IS NOT NULL)
    + (SELECT COUNT(*) FROM `users` WHERE `totp_enabled` OR `totp_secret_enc` IS NOT NULL);
DROP TEMPORARY TABLE `p10_up_guard`;

-- PRISMA ÜRETTİ (migrate diff --from-config-datasource --to-schema) ↓ — değiştirilmedi.

-- AlterTable
ALTER TABLE `users` ADD COLUMN `totp_last_step` BIGINT NULL;

-- CreateTable
CREATE TABLE `recovery_codes` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recovery_codes_user_id_code_hash_key`(`user_id`, `code_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `password_reset_tokens_token_hash_key`(`token_hash`),
    INDEX `password_reset_tokens_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `password_reset_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recovery_codes` ADD CONSTRAINT `recovery_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ELLE EKLENDİ ↓ (Prisma CHECK kısıtı üretmez; zod'a ek DB savunması, mimari §3 dba notu P1 (3)).

-- recovery_codes: düz kod saklanmasın (yalnız SHA-256 hex, küçük harf).
ALTER TABLE `recovery_codes`
    ADD CONSTRAINT `recovery_codes_code_hash_fmt_chk` CHECK (REGEXP_LIKE(`code_hash`, '^[0-9a-f]{64}$', 'c'));

-- password_reset_tokens: yalnız hash; geçerlilik 30 dk (AC-66) — üst sınır +1 dk tolerans (P2 TTL kalıbı), daha kısa serbest.
ALTER TABLE `password_reset_tokens`
    ADD CONSTRAINT `password_reset_tokens_token_hash_fmt_chk` CHECK (REGEXP_LIKE(`token_hash`, '^[0-9a-f]{64}$', 'c')),
    ADD CONSTRAINT `password_reset_tokens_ttl_chk` CHECK (`expires_at` > `created_at` AND `expires_at` <= `created_at` + INTERVAL 31 MINUTE);

-- users TOTP (AC-67, mimari §5.1): etkin 2FA'nın sırrı olmalı; sır şifreli biçimde (ver 1 + iv 12 + tag 16 + ≥ 1 bayt;
-- düz base32 sır 30 bayt altı değildir ama boş/kırpık şifreli değer reddedilir); son adım yalnız sır varken.
-- MFA sıfırlama: totp_secret_enc, totp_last_step NULL + totp_enabled=false tek UPDATE'te.
ALTER TABLE `users`
    ADD CONSTRAINT `users_totp_enabled_chk` CHECK (NOT `totp_enabled` OR `totp_secret_enc` IS NOT NULL),
    ADD CONSTRAINT `users_totp_secret_enc_chk` CHECK (`totp_secret_enc` IS NULL OR LENGTH(`totp_secret_enc`) >= 30),
    ADD CONSTRAINT `users_totp_last_step_chk` CHECK (`totp_last_step` IS NULL OR (`totp_last_step` > 0 AND `totp_secret_enc` IS NOT NULL));

-- tenant_settings SMTP (AC-78, 79, 122): ya tamamen boş (yapılandırılmamış) ya zorunlu alanlar dolu; şifre yalnız
-- kullanıcıyla; şifreli değer biçimi; port aralığı; başlığa giden alanlarda kontrol karakteri yok (CRLF başlık enjeksiyonu
-- savunması); host yalnız ASCII ad / IPv4 / [IPv6] (IDN → punycode, servis `domainToASCII`); e-posta iskeleti (P8 kalıbı).
-- Host desen sonu `\z`: ICU'da `$` sondaki satır sonunu da kabul eder ("host\n" geçerdi) — docs/db-notlari.md P10.
ALTER TABLE `tenant_settings`
    ADD CONSTRAINT `tenant_settings_smtp_complete_chk` CHECK (
        (`smtp_host` IS NULL AND `smtp_port` IS NULL AND `smtp_security` IS NULL AND `smtp_user` IS NULL
            AND `smtp_pass_enc` IS NULL AND `smtp_from_name` IS NULL AND `smtp_from_email` IS NULL)
        OR (`smtp_host` IS NOT NULL AND `smtp_port` IS NOT NULL AND `smtp_security` IS NOT NULL AND `smtp_from_email` IS NOT NULL)),
    ADD CONSTRAINT `tenant_settings_smtp_auth_chk` CHECK (`smtp_pass_enc` IS NULL OR `smtp_user` IS NOT NULL),
    ADD CONSTRAINT `tenant_settings_smtp_pass_enc_chk` CHECK (`smtp_pass_enc` IS NULL OR LENGTH(`smtp_pass_enc`) >= 30),
    ADD CONSTRAINT `tenant_settings_smtp_port_chk` CHECK (`smtp_port` IS NULL OR `smtp_port` BETWEEN 1 AND 65535),
    ADD CONSTRAINT `tenant_settings_smtp_host_chk` CHECK (`smtp_host` IS NULL
        OR (CHAR_LENGTH(`smtp_host`) BETWEEN 1 AND 253 AND REGEXP_LIKE(`smtp_host`, '^([A-Za-z0-9.-]+|\\[[0-9A-Fa-f:.]+\\])\\z', 'c'))),
    ADD CONSTRAINT `tenant_settings_smtp_user_chk` CHECK (`smtp_user` IS NULL
        OR (CHAR_LENGTH(`smtp_user`) >= 1 AND NOT REGEXP_LIKE(`smtp_user`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    ADD CONSTRAINT `tenant_settings_smtp_from_name_chk` CHECK (`smtp_from_name` IS NULL
        OR (CHAR_LENGTH(`smtp_from_name`) >= 1
            AND CHAR_LENGTH(`smtp_from_name`) = CHAR_LENGTH(TRIM(`smtp_from_name`))
            AND NOT REGEXP_LIKE(`smtp_from_name`, '[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]', 'c'))),
    ADD CONSTRAINT `tenant_settings_smtp_from_email_chk` CHECK (`smtp_from_email` IS NULL
        OR REGEXP_LIKE(`smtp_from_email`, '^[^@\\s\\p{Cc}\\p{Cf}]+@[^@\\s\\p{Cc}\\p{Cf}]+$', 'c'));
