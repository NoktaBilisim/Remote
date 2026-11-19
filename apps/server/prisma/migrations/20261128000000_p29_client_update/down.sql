-- GERİ ALMA (elle, dba) — 20261128000000_p29_client_update. Prisma bu dosyayı ÇALIŞTIRMAZ. Asıl geri alma önceki server/web
-- imajıdır (mimari §9.5): yeni sütunlar eski kodca okunmaz, zarar yok → şema genelde kalabilir (expand). Şema geri alınacaksa
-- önce P29 sunucu/web kodu geri alınır, sonra (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261128000000_p29_client_update/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur): p29_down_guard_chk — otomatik güncellemeyi KAPATMIŞ firma var
-- (client_auto_update = 0). Bu bir firma kararıdır ve türetilemez: down + yeniden up sütunu DEFAULT TRUE ile geri getirir →
-- güncelleme o firmalarda sessizce yeniden açılırdı. Bilinçli geri alma: firmaların listesi kaydedilir (audit
-- `settings.client_update` izi 730 g kalır; `SELECT tenant_id FROM tenant_settings WHERE client_auto_update = 0`), karar
-- kaydıyla migrator `UPDATE tenant_settings SET client_auto_update = 1 WHERE client_auto_update = 0;` çalıştırır, yeniden
-- up sonrası aynı liste için 0'a çekilir. (Mimari §3.3 "ön denetimsiz" diyor — dba sapması, db-notlari "P29".)
-- Kalıcı kayıp (guard'sız, bilinçli): unattended_devices.update_* (son güncelleme olayı — yalnız rozet durumu; yeniden up
-- sonrası ilk olay/device.auth ile yeniden oluşur; olayların kopyası audit_logs'ta 730 gün).
-- Kilit: unattended_devices CHECK DROP + sütun DROP tek ALTER (DROP COLUMN INSTANT'tır ama CHECK DROP ile aynı ALTER'da tek
-- yeniden yazım en fazla; tablo küçük). tenant_settings DROP COLUMN INSTANT.
CREATE TEMPORARY TABLE `p29_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p29_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p29_down_guard` (`n`) SELECT COUNT(*) FROM `tenant_settings` WHERE `client_auto_update` = 0;
DROP TEMPORARY TABLE `p29_down_guard`;

ALTER TABLE `unattended_devices`
    DROP CHECK `unattended_devices_update_state_chk`,
    DROP CHECK `unattended_devices_update_version_chk`,
    DROP CHECK `unattended_devices_update_reason_chk`,
    DROP CHECK `unattended_devices_update_set_chk`,
    DROP COLUMN `update_at`,
    DROP COLUMN `update_reason`,
    DROP COLUMN `update_state`,
    DROP COLUMN `update_version`;

ALTER TABLE `tenant_settings` DROP COLUMN `client_auto_update`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261128000000_p29_client_update';
