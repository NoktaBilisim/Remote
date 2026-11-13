-- GERİ ALMA (elle, dba) — 20261114090000_whatsapp_service_setting. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- CHECK'leri P12 durumuna döndürür; tablo/veri/yetki değişmez (bu migration grant eklemedi).
-- Koruma: system_settings'te `whatsapp` satırı varsa P12 key CHECK'i geri eklenemez (3819) → `wa_down_guard_chk`
-- (3819) ile HİÇBİR ŞEY DEĞİŞMEDEN durur. Bilinçli karar verilirse: önce yedek (runbook), satır migrator ile silinir
-- (`DELETE FROM system_settings WHERE `key` = 'whatsapp';` — servis adresi env WHATSAPP_SERVICE_URL/varsayılana döner),
-- sonra bu dosya tekrar çalıştırılır. Sunucu kodu önce geri alınmalıdır.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261114090000_whatsapp_service_setting/down.sql
CREATE TEMPORARY TABLE `wa_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `wa_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `wa_down_guard` (`n`) SELECT COUNT(*) FROM `system_settings` WHERE CAST(`key` AS BINARY) = 'whatsapp';
DROP TEMPORARY TABLE `wa_down_guard`;

ALTER TABLE `system_settings`
    DROP CHECK `system_settings_whatsapp_chk`,
    DROP CHECK `system_settings_key_chk`,
    ADD CONSTRAINT `system_settings_key_chk` CHECK (CAST(`key` AS BINARY) IN ('mysql', 'turn', 'system_logo'));

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261114090000_whatsapp_service_setting';
