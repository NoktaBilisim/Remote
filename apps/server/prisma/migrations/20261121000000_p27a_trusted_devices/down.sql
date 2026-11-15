-- GERİ ALMA (elle, dba) — 20261121000000_p27a_trusted_devices. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce P27a sunucu kodu geri
-- alınmalı (trusted-device repo/rotalar, login/verify dalı, geçersiz kılma noktaları, saklama/firma silme/erasure/purgeTx
-- satırları) ve prisma/sql/grants.sql P27a öncesi hâline döndürülmeli (trusted_devices yokken GRANT hata verir; yetki aşağıda
-- REVOKE edilir).
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261121000000_p27a_trusted_devices/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur):
--   * p27a_down_guard_chk: anahtarı KAPATMIŞ firma var (mfa_remember_device = 0). Sütun düşerse bu bilinçli seçim kaybolur ve
--     migration yeniden uygulanınca firma sessizce TRUE'ya döner (KVKK/denetim gereği kapatan müşteri). Önce listeyi alın:
--       SELECT tenant_id FROM tenant_settings WHERE mfa_remember_device = 0;
--     sonra (migrator) `UPDATE tenant_settings SET mfa_remember_device = 1 WHERE mfa_remember_device = 0;` ile geçin; yeniden
--     uygulamadan sonra aynı firmalarda 0'a geri çekin (ayar ekranından, audit'li).
-- Kalıcı kayıp (guard'sız): hatırlanan cihaz satırları — zararsız, kullanıcılar bir sonraki girişte bir kez TOTP girer.
CREATE TEMPORARY TABLE `p27a_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p27a_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p27a_down_guard` (`n`) SELECT COUNT(*) FROM `tenant_settings` WHERE NOT `mfa_remember_device`;
DROP TEMPORARY TABLE `p27a_down_guard`;

-- P27a yetkisi (grants.sql). DROP TABLE tables_priv satırını SİLMEZ → önce REVOKE. IF EXISTS: grants.sql hiç çalışmamışsa
-- uyarı verir, durmaz.
REVOKE IF EXISTS SELECT, INSERT, UPDATE, DELETE ON `trusted_devices` FROM 'app'@'%';

DROP TABLE IF EXISTS `trusted_devices`;

ALTER TABLE `tenant_settings` DROP COLUMN `mfa_remember_device`, ALGORITHM=INSTANT;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261121000000_p27a_trusted_devices';
