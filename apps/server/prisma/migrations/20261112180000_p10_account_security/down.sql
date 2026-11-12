-- GERİ ALMA (elle, dba) — 20261112180000_p10_account_security. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: recovery_codes ve password_reset_tokens tablolarını VE VERİSİNİ, users.totp_last_step'i siler; SMTP/TOTP
-- CHECK'lerini kaldırır. Açık sıfırlama linkleri geçersizleşir (zararsız). P10 sunucu kodu önce geri alınmalıdır.
-- Koruma: 2FA'yı etkinleştirmiş kullanıcı veya kurtarma kodu varsa geri alma bu kullanıcıların kurtarma kodlarını kalıcı
-- olarak yok eder (yeniden uygulamada kodsuz kalırlar) ve P9 kodu TOTP'yi yok sayar → geçici tablo CHECK'i 3819
-- (`p10_down_guard_chk`) ile HİÇBİR ŞEY DEĞİŞMEDEN durur. Bu durumda önce mimara bildirin; bilinçli karar verilirse
-- kullanıcıların MFA'sı uygulama üzerinden sıfırlanır (POST /users/:id/reset-mfa, audit'li), sonra tekrar çalıştırılır.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261112180000_p10_account_security/down.sql
CREATE TEMPORARY TABLE `p10_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p10_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p10_down_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `recovery_codes`)
    + (SELECT COUNT(*) FROM `users` WHERE `totp_enabled`);
DROP TEMPORARY TABLE `p10_down_guard`;

-- Yetkiler (MySQL tablo düşünce tablo/sütun yetkisini silmez).
REVOKE IF EXISTS ALL PRIVILEGES ON `recovery_codes` FROM 'app'@'%';
REVOKE IF EXISTS ALL PRIVILEGES ON `password_reset_tokens` FROM 'app'@'%';

ALTER TABLE `tenant_settings`
    DROP CHECK `tenant_settings_smtp_complete_chk`,
    DROP CHECK `tenant_settings_smtp_auth_chk`,
    DROP CHECK `tenant_settings_smtp_pass_enc_chk`,
    DROP CHECK `tenant_settings_smtp_port_chk`,
    DROP CHECK `tenant_settings_smtp_host_chk`,
    DROP CHECK `tenant_settings_smtp_user_chk`,
    DROP CHECK `tenant_settings_smtp_from_name_chk`,
    DROP CHECK `tenant_settings_smtp_from_email_chk`;

ALTER TABLE `users`
    DROP CHECK `users_totp_enabled_chk`,
    DROP CHECK `users_totp_secret_enc_chk`,
    DROP CHECK `users_totp_last_step_chk`,
    DROP COLUMN `totp_last_step`;

DROP TABLE `password_reset_tokens`;
DROP TABLE `recovery_codes`;

-- Not: tenant_settings.smtp_* ve users.totp_secret_enc değerleri (P1 sütunları) korunur; P9 kodu bunları okumaz.
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261112180000_p10_account_security';
