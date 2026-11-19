-- GERİ ALMA (elle, dba) — 20261127000000_p21_customer_portal. Prisma bu dosyayı ÇALIŞTIRMAZ. Önce: P21 sunucu/web kodu ve
-- prisma/sql/grants.sql P21 öncesine döner. Asıl geri alma önceki imajdır; tablolar kalabilir (expand — eski kod onları okumaz).
-- Şema yalnız tablolar BOŞKEN geri alınır:
--   pnpm --filter @remote/server exec prisma db execute --file prisma/migrations/20261127000000_p21_customer_portal/down.sql
-- Koruma (hiçbir şey değişmeden 3819 ile durur): p21_down_guard_chk — portal hesabı ya da portal oturumu var. Hesaplar müşteriye
-- ait kişisel veri + erişim hakkıdır; sessizce silinmez. Bilinçli kaldırma: Admin hesapları pasife alır, saklama işi / müşteri
-- anonimleştirme siler ya da (karar kaydıyla) migrator `DELETE FROM portal_sessions; DELETE FROM portal_users;` — audit izi
-- (portal.*, entity=portal_users) audit_logs'ta 730 gün kalır.
-- Kilit: yalnız iki P21 tablosu DROP (boş — guard); tenants/customers'a FK hedefi olarak dokunulur, yeniden yazım yok.
CREATE TEMPORARY TABLE `p21_down_guard` (`n` BIGINT NOT NULL, CONSTRAINT `p21_down_guard_chk` CHECK (`n` = 0));
INSERT INTO `p21_down_guard` (`n`) SELECT
      (SELECT COUNT(*) FROM `portal_sessions`)
    + (SELECT COUNT(*) FROM `portal_users`);
DROP TEMPORARY TABLE `p21_down_guard`;

-- Yetkiler (grants.sql). DROP TABLE tables_priv/columns_priv satırını SİLMEZ → önce REVOKE (sütun yetkileri dahil).
REVOKE IF EXISTS SELECT, INSERT, DELETE ON `portal_sessions` FROM 'app'@'%';
REVOKE IF EXISTS UPDATE (`last_seen_at`, `revoked_at`, `updated_at`) ON `portal_sessions` FROM 'app'@'%';
REVOKE IF EXISTS SELECT, INSERT, DELETE ON `portal_users` FROM 'app'@'%';
REVOKE IF EXISTS UPDATE (`full_name`, `temp_password_expires_at`, `password_hash`, `must_change_password`, `failed_login_count`,
    `failed_window_at`, `locked_until`, `totp_secret_enc`, `totp_enabled`, `totp_last_step`, `theme`, `status`, `passive_at`,
    `last_login_at`, `updated_at`) ON `portal_users` FROM 'app'@'%';

-- FK sırası: oturumlar (portal_users'a bileşik FK) → hesaplar. FK'ler tabloyla birlikte düşer.
DROP TABLE `portal_sessions`;
DROP TABLE `portal_users`;

DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261127000000_p21_customer_portal';
