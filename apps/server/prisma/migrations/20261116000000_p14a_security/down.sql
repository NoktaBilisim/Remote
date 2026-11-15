-- GERİ ALMA (elle, dba) — 20261116000000_p14a_security. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Önce P14a sunucu kodu geri alınmalıdır (users.version / auth_sessions.step_up_at okunur/yazılır).
-- Koruma (guard) gerekmez: 6 CHECK eski `$` desenine GEVŞER (mevcut her satır uyar); düşürülen iki sütunun verisi
-- yeniden üretilebilir (version sayacı sıfırdan başlar, step-up yeniden istenir) → kalıcı kayıp yok.
-- Kilit: 4 tablo COPY ile yeniden yazılır; sütun düşürme INSTANT.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261116000000_p14a_security/down.sql
-- Ön kontrol başarısız bir denemeden kalmış olabilecek yordam (yoksa uyarı, durmaz).
DROP PROCEDURE IF EXISTS `p14a_precheck`;

ALTER TABLE `auth_sessions` DROP COLUMN `step_up_at`, ALGORITHM=INSTANT;
ALTER TABLE `users` DROP COLUMN `version`, ALGORITHM=INSTANT;

ALTER TABLE `tenant_request_settings`
    DROP CHECK `tenant_request_settings_file_label_chk`,
    ADD CONSTRAINT `tenant_request_settings_file_label_chk` CHECK (REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}$', 'c'));

ALTER TABLE `device_bindings`
    DROP CHECK `device_bindings_client_version_fmt_chk`,
    ADD CONSTRAINT `device_bindings_client_version_fmt_chk` CHECK (REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$', 'c'));

ALTER TABLE `support_requests`
    DROP CHECK `support_requests_client_version_fmt_chk`,
    DROP CHECK `support_requests_phone_fmt_chk`,
    ADD CONSTRAINT `support_requests_client_version_fmt_chk` CHECK (REGEXP_LIKE(`client_version`, '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$', 'c')),
    ADD CONSTRAINT `support_requests_phone_fmt_chk` CHECK (`customer_phone` IS NULL OR REGEXP_LIKE(`customer_phone`, '^[+][1-9][0-9]{7,14}$', 'c'));

ALTER TABLE `customers`
    DROP CHECK `customers_file_label_chk`,
    DROP CHECK `customers_phone_fmt_chk`,
    ADD CONSTRAINT `customers_file_label_chk` CHECK (REGEXP_LIKE(`file_label`, '^[A-Za-z0-9]{1,20}$', 'c')),
    ADD CONSTRAINT `customers_phone_fmt_chk` CHECK (`phone` IS NULL OR REGEXP_LIKE(`phone`, '^[+][1-9][0-9]{7,14}$', 'c'));

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261116000000_p14a_security';
