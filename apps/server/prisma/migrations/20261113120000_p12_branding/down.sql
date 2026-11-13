-- GERİ ALMA (elle, dba) — 20261113120000_p12_branding. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Yalnız CHECK'leri P11 durumuna döndürür; tablo/sütun/veri silinmez, yetki değişmez (P12 grant eklemedi).
-- Koruma: system_settings'te `system_logo` satırı varsa P11 key CHECK'i geri eklenemez (3819) ve yarım kalırdı →
-- `p12_down_guard_chk` (3819) ile HİÇBİR ŞEY DEĞİŞMEDEN durur. Bilinçli karar verilirse: önce yedek (runbook),
-- sistem logosu Super Admin panelinden kaldırılır (veya migrator ile
-- `DELETE FROM system_settings WHERE `key` = 'system_logo';` — dosya `uploads/system/` altında kalır, elle silinir),
-- sonra bu dosya tekrar çalıştırılır. Login/e-posta varsayılan Nokta logosuna döner (AC-82).
-- tenants.logo_path / users.avatar_path değerleri korunur (P11 kodu bu sütunları okumaz/yazmaz).
-- P12 sunucu kodu önce geri alınmalıdır.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261113120000_p12_branding/down.sql
CREATE TEMPORARY TABLE `p12_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p12_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p12_down_guard` (`n`) SELECT COUNT(*) FROM `system_settings` WHERE CAST(`key` AS BINARY) = 'system_logo';
DROP TEMPORARY TABLE `p12_down_guard`;

ALTER TABLE `users` DROP CHECK `users_avatar_path_chk`;
ALTER TABLE `tenants` DROP CHECK `tenants_logo_path_chk`;
ALTER TABLE `system_settings`
    DROP CHECK `system_settings_system_logo_chk`,
    DROP CHECK `system_settings_key_chk`,
    ADD CONSTRAINT `system_settings_key_chk` CHECK (CAST(`key` AS BINARY) IN ('mysql', 'turn'));

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261113120000_p12_branding';
