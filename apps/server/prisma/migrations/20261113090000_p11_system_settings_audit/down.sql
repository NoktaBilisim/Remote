-- GERİ ALMA (elle, dba) — 20261113090000_p11_system_settings_audit. Prisma bu dosyayı ÇALIŞTIRMAZ.
-- Uyarı: system_settings tablosunu VE VERİSİNİ (MySQL/TURN ayarları, şifreli gizli değerler) siler; audit_logs
-- tetikleyicilerini kaldırır → DB düzeyinde audit UPDATE/DELETE koruması P10 durumuna döner (yalnız app yetki sınırı kalır).
-- İndeksler P10 durumuna döner (IX(tenant_id, user_id, created_at) geri gelir). P11 sunucu kodu önce geri alınmalıdır.
-- Koruma: system_settings'te kayıt varsa geri alma Super Admin'in girdiği ayarları kalıcı olarak yok eder → geçici tablo
-- CHECK'i 3819 (`p11_down_guard_chk`) ile HİÇBİR ŞEY DEĞİŞMEDEN durur. Bilinçli karar verilirse: önce yedek
-- (runbook), ayarlar not edilir (TURN için env TURN_URLS/TURN_SECRET dolu olmalı), sonra migrator ile
-- `DELETE FROM system_settings;` ve bu dosya tekrar çalıştırılır.
-- Çalıştırma (migrator):
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261113090000_p11_system_settings_audit/down.sql
CREATE TEMPORARY TABLE `p11_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p11_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p11_down_guard` (`n`) SELECT COUNT(*) FROM `system_settings`;
DROP TEMPORARY TABLE `p11_down_guard`;

-- Yetkiler (MySQL tablo düşünce tablo yetkisini silmez).
REVOKE IF EXISTS ALL PRIVILEGES ON `system_settings` FROM 'app'@'%';

DROP TRIGGER IF EXISTS `audit_logs_no_update`;
DROP TRIGGER IF EXISTS `audit_logs_retention_only_delete`;

DROP TABLE `system_settings`;

-- Önce eski indeks geri gelir (çevrimiçi), sonra P11 indeksleri düşer (metadata).
ALTER TABLE `audit_logs`
    ADD INDEX `audit_logs_tenant_id_user_id_created_at_idx`(`tenant_id`, `user_id`, `created_at`),
    ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE `audit_logs`
    DROP INDEX `audit_logs_user_id_created_at_idx`,
    DROP INDEX `audit_logs_action_created_at_idx`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261113090000_p11_system_settings_audit';
